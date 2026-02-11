import fs from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";

async function capture(url, outDir) {
  const browser = await chromium.launch();
  const desktop = await browser.newContext({
    viewport: { width: 1728, height: 1117 },
    deviceScaleFactor: 1,
  });
  const mobile = await browser.newContext({
    ...devices["iPhone 13"],
  });

  const dp = await desktop.newPage();
  const mp = await mobile.newPage();
  const consoleMsgs = [];
  dp.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleMsgs.push(`[desktop][${msg.type()}] ${msg.text()}`);
    }
  });
  mp.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleMsgs.push(`[mobile][${msg.type()}] ${msg.text()}`);
    }
  });

  await dp.goto(url, { waitUntil: "domcontentloaded" });
  await mp.goto(url, { waitUntil: "domcontentloaded" });
  await dp.waitForTimeout(1800);
  await mp.waitForTimeout(1800);

  const desktopPath = path.join(outDir, "artist-desktop.png");
  const mobilePath = path.join(outDir, "artist-mobile.png");
  const mobileFoldPath = path.join(outDir, "artist-mobile-fold.png");
  await dp.screenshot({ path: desktopPath, fullPage: false });
  await mp.screenshot({ path: mobilePath, fullPage: true });
  await mp.screenshot({ path: mobileFoldPath, fullPage: false });

  const metrics = await dp.evaluate(() => {
    const header = document.querySelector("header");
    const banner = document.querySelector("section > div");
    const masonry = document.querySelector("[data-masonry]");
    const firstTile = document.querySelector("[data-masonry] > div");
    const footer = Array.from(document.querySelectorAll("footer"))[0];

    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };

    return {
      header: rect(header),
      banner: rect(banner),
      masonry: rect(masonry),
      firstTile: rect(firstTile),
      footer: rect(footer),
      fonts: Array.from(new Set(Array.from(document.querySelectorAll("h1, h2, p, a")).map((el) => getComputedStyle(el).fontFamily))).slice(0, 6),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });

  await browser.close();
  return { desktopPath, mobilePath, mobileFoldPath, consoleMsgs, metrics };
}

async function main() {
  const base = process.env.URL ?? "http://127.0.0.1:3000";
  const handle = process.env.HANDLE ?? "ileogivel";
  const url = `${base}/u/${encodeURIComponent(handle)}`;
  const outDir = process.env.OUT_DIR ?? "output/playwright";
  await fs.mkdir(outDir, { recursive: true });

  const report = await capture(url, outDir);
  const reportPath = path.join(outDir, "artist-analyze.json");
  await fs.writeFile(reportPath, JSON.stringify({ url, ...report }, null, 2), "utf8");

  console.log(`wrote: ${report.desktopPath}`);
  console.log(`wrote: ${report.mobilePath}`);
  console.log(`wrote: ${report.mobileFoldPath}`);
  console.log(`wrote: ${reportPath}`);
  console.log(JSON.stringify(report.metrics, null, 2));
  if (report.consoleMsgs.length > 0) {
    console.log(report.consoleMsgs.join("\n"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
