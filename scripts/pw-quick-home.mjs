import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPort(host, port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (v) => {
        socket.removeAllListeners();
        socket.end();
        socket.destroy();
        resolve(v);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
      setTimeout(() => done(false), 300);
    });
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

async function main() {
  const url = process.env.URL ?? "http://127.0.0.1:3010/";
  const outDir = process.env.OUT_DIR ?? "output/playwright";
  const outPath =
    process.env.OUT_FILE ?? path.join(outDir, "home-quick.png");

  await fs.mkdir(outDir, { recursive: true });

  const ok = await waitForPort("127.0.0.1", 3010, 15000);
  if (!ok) {
    throw new Error(
      `Dev server not reachable at ${url}. Start it with: pnpm dev --port 3010`
    );
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.setDefaultTimeout(15000);

  // Keep the run fast: don't wait on long-hanging assets.
  page.on("requestfailed", (req) => {
    const err = req.failure()?.errorText ?? "";
    if (err.includes("TIMED_OUT") || err.includes("aborted")) return;
    if (req.resourceType() === "image" || req.resourceType() === "media") return;
    console.log("[requestfailed]", req.url(), err);
  });

  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(500);
    }
  }
  if (lastErr) throw lastErr;

  // Wait for masonry container and at least 10 tiles to exist.
  await page.waitForSelector("[data-masonry]", { timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelectorAll("[data-masonry] > div").length >= 10,
    { timeout: 5000 }
  );

  // Optional: wait a bit for above-the-fold images to decode so the screenshot is meaningful.
  // Keep it bounded to stay fast.
  await page
    .waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll("[data-masonry] img"));
        const loaded = imgs.filter((img) => img.complete && img.naturalWidth > 0);
        return loaded.length >= 6;
      },
      { timeout: 3000 }
    )
    .catch(() => {});
  await page.waitForTimeout(250);

  const sample = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll("[data-masonry] > div"))
      .slice(0, 12)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          t: (el).style?.transform ?? "",
        };
      });
    const nonTrivial = tiles.filter((t) => t.h >= 80).length;
    return { nonTrivial, tiles };
  });
  console.log("tile sample:", JSON.stringify(sample, null, 2));

  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();

  console.log("wrote:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
