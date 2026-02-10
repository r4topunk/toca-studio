import fs from "node:fs";
import path from "node:path";

const IN_PATH = path.resolve("output/vvv/crawl.jsonl");
const OUT_PATH = path.resolve("output/vvv/report.md");

function readJsonl(p) {
  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function topN(arr, n, keyFn) {
  const copy = [...arr];
  copy.sort((a, b) => keyFn(b) - keyFn(a));
  return copy.slice(0, n);
}

function mdEscape(s) {
  return String(s).replaceAll("|", "\\|");
}

function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`Missing ${IN_PATH}. Run pnpm vvv:crawl first.`);
    process.exit(1);
  }

  const rows = readJsonl(IN_PATH);
  const ok = rows.filter((r) => r.status && r.status >= 200 && r.status < 400);
  const bad = rows.filter((r) => !r.status || r.status >= 400 || r.navError);
  const consoleErr = rows.filter((r) => (r.console || []).some((c) => c.type === "error"));
  const pageErr = rows.filter((r) => (r.pageErrors || []).length);
  const slow = topN(rows.filter((r) => typeof r.elapsedMs === "number"), 15, (r) => r.elapsedMs);

  const byPath = new Map();
  for (const r of rows) {
    try {
      const u = new URL(r.finalUrl || r.url);
      const key = u.pathname || "/";
      byPath.set(key, (byPath.get(key) || 0) + 1);
    } catch {
      // ignore
    }
  }
  const topPaths = [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  const lines = [];
  lines.push(`# vvv.so crawl report`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(`- Visited: ${rows.length}`);
  lines.push(`- OK (2xx/3xx): ${ok.length}`);
  lines.push(`- Errors/timeouts: ${bad.length}`);
  lines.push(`- Pages with console errors: ${consoleErr.length}`);
  lines.push(`- Pages with pageErrors: ${pageErr.length}`);
  lines.push(``);

  lines.push(`## Highest-latency pages`);
  lines.push(`| ms | status | url | screenshot |`);
  lines.push(`|---:|:------:|-----|------------|`);
  for (const r of slow) {
    lines.push(
      `| ${r.elapsedMs ?? ""} | ${r.status ?? ""} | ${mdEscape(r.finalUrl || r.url)} | ${mdEscape(r.screenshot || "")} |`
    );
  }
  lines.push(``);

  lines.push(`## Console error sample (first 20)`);
  for (const r of consoleErr.slice(0, 20)) {
    const first = (r.console || []).find((c) => c.type === "error");
    lines.push(`- ${r.finalUrl || r.url}: ${first ? mdEscape(first.text) : ""}`);
  }
  lines.push(``);

  lines.push(`## Page error sample (first 20)`);
  for (const r of pageErr.slice(0, 20)) {
    lines.push(`- ${r.finalUrl || r.url}: ${mdEscape(String((r.pageErrors || [])[0] || ""))}`);
  }
  lines.push(``);

  lines.push(`## Top repeated paths`);
  lines.push(`| path | count |`);
  lines.push(`|------|------:|`);
  for (const [p, c] of topPaths) {
    lines.push(`| ${mdEscape(p)} | ${c} |`);
  }
  lines.push(``);

  lines.push(`## Notes`);
  lines.push(`- HTML snapshots: output/vvv/pages/`);
  lines.push(`- Screenshots: output/vvv/screenshots/`);
  lines.push(`- Raw crawl log: output/vvv/crawl.log`);
  lines.push(``);

  fs.writeFileSync(OUT_PATH, lines.join("\n"));
  console.log(`Wrote ${OUT_PATH}`);
}

main();
