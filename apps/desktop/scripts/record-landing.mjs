/**
 * Records the looping demo GIFs shipped on the landing site
 * (apps/landing/public/media/aster-find.gif, aster-palette.gif).
 *
 * Boots the same mock DesktopApi as tests/renderer-smoke.spec.ts (extracted
 * from its source so the fixture never drifts), sets the dark theme, and
 * records two 1280×800 scenarios to webm in /tmp/aster-rec:
 *
 *   palette — open the command palette, filter contexts, switch to prod
 *   find    — type into the resource filter, 10k rows narrow live
 *
 * Run against the built renderer, like the capture suite:
 *
 *   pnpm build:renderer && pnpm vite preview --host 127.0.0.1 --port 4173 --strictPort
 *   pnpm record:landing
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT ?? "4173";
const BASE = `http://127.0.0.1:${PORT}/`;

const specSource = fs.readFileSync(path.resolve(import.meta.dirname, "../tests/renderer-smoke.spec.ts"), "utf8");
const match = specSource.match(/const MOCK_DESKTOP_API = `([\s\S]*?)`;\n/);
if (!match) throw new Error("MOCK_DESKTOP_API not found in renderer-smoke.spec.ts");
const MOCK_DESKTOP_API = new Function("TOTAL_DEPLOYMENTS", "PAGE_SIZE", `return \`${match[1]}\``)(10_000, 100);

const OUT = "/tmp/aster-rec";
fs.rmSync(OUT, { recursive: true, force: true });

async function boot(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  await page.addInitScript(MOCK_DESKTOP_API);
  await page.addInitScript(() => localStorage.setItem("aster.theme", "dark"));
  await page.goto(BASE);
  const option = page.getByTestId("context-option-dev");
  await option.click();
  await option.dblclick();
  await page.getByTestId("workbench-shell").waitFor();
  await page.getByRole("grid", { name: "Resources" }).waitFor();
  return { context, page };
}

async function save(context, name) {
  const page = context.pages()[0];
  const video = page.video();
  await context.close();
  const p = await video.path();
  fs.renameSync(p, path.join(OUT, `${name}.webm`));
  console.log("saved", path.join(OUT, `${name}.webm`));
}

const browser = await chromium.launch();

// Scenario A: command palette — open, filter contexts, switch to prod.
{
  const { context, page } = await boot(browser);
  await page.getByTestId("workbench-shell").waitFor();
  await page.keyboard.press("Meta+k");
  await page.locator(".command-palette-content").waitFor();
  await page.waitForTimeout(700);
  await page.keyboard.type("prod", { delay: 140 });
  await page.getByText("prod", { exact: true }).first().waitFor();
  await page.waitForTimeout(900);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1600);
  await save(context, "palette");
}

// Scenario B: filter — type into the resource filter, 10k rows narrow live.
{
  const { context, page } = await boot(browser);
  await page.getByPlaceholder("Filter current resources").click();
  await page.waitForTimeout(400);
  await page.keyboard.type("deployments-9", { delay: 120 });
  await page.getByText("deployments-9").first().waitFor();
  await page.waitForTimeout(1500);
  await save(context, "find");
}

await browser.close();
console.log("done");
