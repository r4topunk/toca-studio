import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";

const ORIGIN = "https://www.vvv.so";
const OUT_DIR = path.resolve("output/vvv");
const PAGES_DIR = path.join(OUT_DIR, "pages");
const SHOTS_DIR = path.join(OUT_DIR, "screenshots");
const JSONL_PATH = path.join(OUT_DIR, "crawl.jsonl");
const LOG_PATH = path.join(OUT_DIR, "crawl.log");

const MAX_PAGES = Number(process.env.MAX_PAGES || "220");
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || "45000");
const POST_LOAD_WAIT_MS = Number(process.env.POST_LOAD_WAIT_MS || "1800");
const SCROLL = process.env.SCROLL === "1";
const FULL_PAGE = process.env.FULL_PAGE === "1";

async function autoScroll(page, { maxScrolls = 12, pauseMs = 650 } = {}) {
  // Scroll in steps to trigger infinite lists/lazy content.
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => {
      const y = Math.floor(window.innerHeight * 0.9);
      window.scrollBy(0, y);
    });
    await page.waitForTimeout(pauseMs);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function appendLog(line) {
  fs.appendFileSync(LOG_PATH, `[${nowIso()}] ${line}\n`);
}

function isHttpUrl(u) {
  return u.protocol === "http:" || u.protocol === "https:";
}

function normalizeUrl(raw, base) {
  let u;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (!isHttpUrl(u)) return null;
  if (u.hostname !== "www.vvv.so" && u.hostname !== "vvv.so") return null;

  // Canonicalize host
  u.hostname = "www.vvv.so";

  // Drop hash
  u.hash = "";

  // Drop tracking params
  const drop = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "utm_reader",
    "utm_name",
    "utm_referrer",
    "gclid",
    "fbclid"
  ]);
  for (const k of [...u.searchParams.keys()]) {
    if (drop.has(k)) u.searchParams.delete(k);
  }

  // Keep query params stable order
  if ([...u.searchParams.keys()].length) {
    const entries = [...u.searchParams.entries()].sort((a, b) =>
      a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
    );
    u.search = "";
    for (const [k, v] of entries) u.searchParams.append(k, v);
  }

  // Avoid duplicate trailing slash variants, but preserve root.
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");

  return u.toString();
}

function safeFileNameForUrl(url) {
  const u = new URL(url);
  const p = u.pathname === "/" ? "root" : u.pathname.replaceAll("/", "_").replace(/^_+/, "");
  const q = u.search ? `_q_${sha1(u.search).slice(0, 10)}` : "";
  return `${p}${q}__${sha1(url).slice(0, 10)}`;
}

function writeJsonl(obj) {
  fs.appendFileSync(JSONL_PATH, `${JSON.stringify(obj)}\n`);
}

function extractPathsFromHtml(html) {
  // Heuristic: find quoted "/some-path" strings in the rendered HTML.
  // This helps discover routes when the UI uses onClick handlers instead of <a href>.
  const out = new Set();
  const re = /["'](\/[^"'?#]{1,140})["']/g;
  let m;
  while ((m = re.exec(html))) {
    const p = m[1];
    if (!p.startsWith("/")) continue;
    if (p.startsWith("/_next/")) continue;
    if (p.startsWith("/img/")) continue;
    if (p.startsWith("/favicon")) continue;
    if (p.startsWith("/api/")) continue;
    if (p.startsWith("/149e9513-")) continue; // bot mitigation assets
    if (p.includes("..")) continue;
    if (p.length < 2) continue;
    if (p.includes(" ")) continue;
    if (/\.(js|css|png|jpg|jpeg|webp|svg|ico|map|woff2?)$/i.test(p)) continue;
    // Most routes on the site seem to be either "/create-collection" or "/<slug>".
    out.add(p);
  }
  return [...out];
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(PAGES_DIR);
  ensureDir(SHOTS_DIR);
  fs.writeFileSync(LOG_PATH, "");
  fs.writeFileSync(JSONL_PATH, "");

  appendLog(`Start crawl origin=${ORIGIN} maxPages=${MAX_PAGES}`);

  const headed = process.env.HEADED ? true : false;
  const persistent = process.env.PERSISTENT === "1";
  const channel = process.env.CHANNEL || undefined; // e.g. "chrome"

  const launchOptions = {
    headless: headed ? false : true,
    channel,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage"
    ]
  };

  const context = persistent
    ? await chromium.launchPersistentContext(path.join(OUT_DIR, "profile"), {
        ...launchOptions,
        viewport: { width: 1380, height: 880 },
        locale: "en-US",
        timezoneId: "America/Los_Angeles",
        ignoreHTTPSErrors: true
      })
    : await (async () => {
        const browser = await chromium.launch(launchOptions);
        const ctx = await browser.newContext({
          viewport: { width: 1380, height: 880 },
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          locale: "en-US",
          timezoneId: "America/Los_Angeles",
          ignoreHTTPSErrors: true
        });
        // Stash browser handle so we can close it later.
        ctx._codexBrowser = browser;
        return ctx;
      })();

  // Common webdriver flag used for bot detection.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // Reduce noise: block heavy third-party media if it causes timeouts.
  if (process.env.BLOCK_MEDIA === "1") {
    await context.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") return route.abort();
      return route.continue();
    });
  }

  const queue = [];
  const seen = new Set();

  const seed = normalizeUrl(ORIGIN, ORIGIN);
  queue.push(seed);
  seen.add(seed);

  let visited = 0;

  while (queue.length && visited < MAX_PAGES) {
    const url = queue.shift();
    const page = await context.newPage();

    const consoleMessages = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error" || type === "warning") {
        consoleMessages.push({
          type,
          text: msg.text().slice(0, 2000)
        });
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(String(err).slice(0, 4000));
    });

    appendLog(`VISIT ${visited + 1}/${MAX_PAGES} ${url}`);

    let status = null;
    let finalUrl = url;
    let normalizedFinal = url;
    let title = "";
    let h1 = "";
    let metaDescription = "";
    let textSample = "";
    let extractedLinks = [];
    let navError = null;

    const startedAt = Date.now();
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      status = resp ? resp.status() : null;
      finalUrl = page.url();
      normalizedFinal = normalizeUrl(finalUrl, ORIGIN) || url;

      // Many web3 apps keep long-polling/websockets open; "networkidle" tends to cost ~15s/page.
      await page.waitForTimeout(POST_LOAD_WAIT_MS);

      title = (await page.title()).slice(0, 512);
      if (SCROLL && (normalizedFinal === ORIGIN + "/" || normalizedFinal === ORIGIN)) {
        await autoScroll(page, { maxScrolls: 16, pauseMs: 700 });
      } else if (SCROLL) {
        // Shorter scroll for detail pages to reveal related sections.
        await autoScroll(page, { maxScrolls: 6, pauseMs: 600 });
      }

      const data = await page.evaluate(() => {
        const h1El = document.querySelector("h1");
        const descEl = document.querySelector('meta[name="description"]');
        const anchors = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
        const sample = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200);
        return {
          h1: h1El ? h1El.textContent?.trim() || "" : "",
          metaDescription: descEl ? descEl.getAttribute("content") || "" : "",
          anchors,
          sample
        };
      });
      h1 = (data.h1 || "").slice(0, 512);
      metaDescription = (data.metaDescription || "").slice(0, 800);
      textSample = data.sample || "";

      extractedLinks = (data.anchors || []).filter(Boolean);
    } catch (e) {
      navError = String(e);
    }

    const elapsedMs = Date.now() - startedAt;

    const fileBase = safeFileNameForUrl(normalizedFinal);
    const shotPath = path.join(SHOTS_DIR, `${fileBase}.png`);
    const htmlPath = path.join(PAGES_DIR, `${fileBase}.html`);
    let htmlForDiscovery = "";

    // Best-effort artifacts even if navigation failed mid-way.
    try {
      await page.screenshot({ path: shotPath, fullPage: FULL_PAGE });
    } catch (e) {
      appendLog(`WARN screenshot failed ${normalizedFinal}: ${String(e).slice(0, 300)}`);
    }
    try {
      htmlForDiscovery = await page.content();
      fs.writeFileSync(htmlPath, htmlForDiscovery);
    } catch (e) {
      appendLog(`WARN html capture failed ${normalizedFinal}: ${String(e).slice(0, 300)}`);
    }

    // Link discovery (resolve relative URLs against the final URL if available).
    const discovered = [];
    for (const href of extractedLinks) {
      const n = normalizeUrl(href, normalizedFinal);
      if (!n) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      discovered.push(n);
      queue.push(n);
    }

    // Heuristic discovery from HTML content.
    if (htmlForDiscovery) {
      for (const p of extractPathsFromHtml(htmlForDiscovery)) {
        const n = normalizeUrl(p, normalizedFinal);
        if (!n) continue;
        if (seen.has(n)) continue;
        seen.add(n);
        discovered.push(n);
        queue.push(n);
      }
    }

    visited += 1;

    writeJsonl({
      ts: nowIso(),
      url,
      finalUrl: normalizedFinal,
      status,
      elapsedMs,
      title,
      h1,
      metaDescription,
      textSample,
      navError,
      console: consoleMessages,
      pageErrors,
      linkCount: extractedLinks.length,
      discoveredCount: discovered.length,
      screenshot: path.relative(process.cwd(), shotPath),
      html: path.relative(process.cwd(), htmlPath)
    });

    await page.close();
  }

  appendLog(`Done visited=${visited} queuedRemaining=${queue.length} seen=${seen.size}`);

  const browser = context._codexBrowser;
  await context.close();
  if (browser) await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
