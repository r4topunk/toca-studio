import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(host, port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (value) => {
        socket.removeAllListeners();
        socket.end();
        socket.destroy();
        resolve(value);
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
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const outDir = process.env.OUT_DIR ?? "output/playwright";
  await fs.mkdir(outDir, { recursive: true });

  const ok = await waitForPort(host, port);
  if (!ok) {
    throw new Error(`Dev server not reachable at ${url}. Start with: pnpm dev --port 3010`);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-masonry] button");

  await page.locator("[data-masonry] button").first().click();
  await page.waitForSelector('[role="dialog"]');

  const usernameLink = page.locator('[role="dialog"] a[href^="/u/"]').first();
  await usernameLink.waitFor();
  const href = await usernameLink.getAttribute("href");
  if (!href) throw new Error("Username link not found in modal");

  const expectedPath = href.startsWith("/") ? href : `/${href}`;
  await Promise.all([
    page.waitForURL(`**${expectedPath}`),
    usernameLink.click(),
  ]);

  await page.waitForLoadState("domcontentloaded");
  await page.screenshot({ path: path.join(outDir, "artist-flow-success.png"), fullPage: false });

  const nonexistent = `/u/__no_such_handle__${Date.now()}`;
  const notFoundResponse = await page.goto(new URL(nonexistent, url).toString(), {
    waitUntil: "domcontentloaded",
  });
  const status = notFoundResponse?.status();
  if (status !== 404) {
    throw new Error(`Expected 404 for ${nonexistent}, got ${status ?? "no response"}`);
  }
  await page.screenshot({ path: path.join(outDir, "artist-flow-404.png"), fullPage: false });

  await browser.close();
  console.log(`PASS flow: / -> modal -> ${expectedPath}`);
  console.log(`PASS 404: ${nonexistent}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
