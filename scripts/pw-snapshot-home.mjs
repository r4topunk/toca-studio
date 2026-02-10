import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

async function main() {
  const url = process.env.URL ?? "http://localhost:3010/";
  const outDir = process.env.OUT_DIR ?? "output/playwright";
  const outPath =
    process.env.OUT_FILE ?? path.join(outDir, "home-masonry.png");

  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    // Keep it short; useful for catching client errors.
    if (["error", "warning"].includes(msg.type())) {
      console.log(`[console.${msg.type()}] ${msg.text()}`);
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Try to let some images load so layout settles.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);

  await page.waitForSelector("[data-masonry] > div", { timeout: 15_000 });

  // Visual debug: show tile bounds (helps spot "8px tall strip" issues).
  await page.addStyleTag({
    content: `
      [data-masonry] > div { outline: 1px solid rgba(255,0,0,.35); }
    `,
  });

  // Dump a quick layout sample for the first few tiles.
  const sample = await page.evaluate(() => {
    const grid = document.querySelector("[data-masonry]");
    const gridRect = grid?.getBoundingClientRect();
    const tiles = Array.from(grid?.children ?? []).slice(0, 10);
    return {
      grid: gridRect
        ? {
            w: Math.round(gridRect.width),
            h: Math.round(gridRect.height),
            position: getComputedStyle(grid).position,
          }
        : null,
      tiles: tiles.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          transform: el.style?.transform ?? "",
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
    };
  });
  console.log("layout sample:", JSON.stringify(sample, null, 2));

  const vpPath = outPath.replace(/\.png$/, "-viewport.png");
  await page.screenshot({ path: vpPath, fullPage: false });
  await page.screenshot({
    path: outPath,
    fullPage: true,
  });
  await browser.close();

  console.log("wrote:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
