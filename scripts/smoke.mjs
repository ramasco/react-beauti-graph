// Smoke test in a real browser: builds nothing, serves examples/dist and checks that the graph is
// really drawn (node sizes are computed and the arrows are painted on the canvas).
// Needs Chrome or Edge: set CHROME_PATH if it is not in a usual place. Run: npm run smoke
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 4173;
const URL = `http://localhost:${PORT}`;

const browserCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const executablePath = browserCandidates.find((candidate) => candidate && existsSync(candidate));
if (!executablePath) {
  console.error('smoke: no Chrome or Edge found; set CHROME_PATH');
  process.exit(1);
}

const viteBin = path.join(root, 'examples', 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: path.join(root, 'examples'),
  stdio: 'ignore',
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(URL)).ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('the preview server did not start');
}

const failures = [];
const browser = await chromium.launch({ executablePath, headless: true });
try {
  await waitForServer();
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(URL);
  await page.waitForSelector('.cy-container canvas');
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const cy = document.querySelector('.cy-container')._cyreg.cy;
    const reports = cy.nodes('[class = "macromolecule"]');
    const edges = cy.edges();
    // Is anything painted in a 7x7 square around the middle of each arrow?
    const painted = edges.map((edge) => {
      const mid = edge.renderedMidpoint();
      const ratio = window.devicePixelRatio;
      return [...document.querySelectorAll('.cy-container canvas')].some((canvas) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return false;
        }
        const data = ctx.getImageData(
          Math.round(mid.x * ratio) - 3,
          Math.round(mid.y * ratio) - 3,
          7,
          7
        ).data;
        return data.some((value, index) => index % 4 === 3 && value > 0);
      });
    });
    return {
      reportCount: reports.length,
      edgeCount: edges.length,
      badSizes: reports.filter((n) => !/^\d+(\.\d+)?px$/.test(n.style('width'))).length,
      unpaintedEdges: painted.filter((ok) => !ok).length,
    };
  });

  if (result.reportCount === 0) {
    failures.push('no report nodes in the graph');
  }
  if (result.edgeCount === 0) {
    failures.push('no arrows in the graph');
  }
  if (result.badSizes > 0) {
    failures.push(`${result.badSizes} report boxes have no computed size`);
  }
  if (result.unpaintedEdges > 0) {
    failures.push(`${result.unpaintedEdges} arrows are not painted on the canvas`);
  }
  failures.push(...pageErrors.map((message) => `page error: ${message}`));
  console.log('smoke:', JSON.stringify(result));
} catch (error) {
  failures.push(String(error));
} finally {
  await browser.close();
  server.kill();
}

if (failures.length > 0) {
  console.error(`smoke: FAILED\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('smoke: OK');
