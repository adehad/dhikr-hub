import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = resolve(here, "live.html");
const out = resolve(here, "../../site/static/og/live.png");

const candidates = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "google-chrome",
  "chromium",
].filter(Boolean);

function runnable(bin) {
  if (existsSync(bin)) return true;
  return spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
}

const chrome = candidates.find(runnable);
if (!chrome) {
  console.error(`No Chromium binary found. Set CHROME to its path. Tried: ${candidates.join(", ")}`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
const result = spawnSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1200,630",
    `--screenshot=${out}`,
    pathToFileURL(page).href,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0 || !existsSync(out)) {
  console.error(`${chrome} exited with ${result.status ?? result.error}`);
  process.exit(1);
}
console.log(`Wrote ${out}`);
