// Smoke test in a real browser: builds nothing, serves examples/dist and checks that the graph is
// really drawn (report boxes on the canvas and as big as their text, arrows drawn).
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
  await page.waitForSelector('.react-flow__node-report');
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const reports = [...document.querySelectorAll('.react-flow__node-report')];
    const groups = [...document.querySelectorAll('.react-flow__node-group')];
    const arrows = [...document.querySelectorAll('.react-flow__edge')];
    const flow = document.querySelector('.react-flow')?.getBoundingClientRect();
    const sizeOf = (element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height, x: box.x, y: box.y };
    };
    // Is the box really on the canvas, with a size?
    const onCanvas = (box) =>
      flow !== undefined &&
      box.width > 0 &&
      box.height > 0 &&
      box.x + box.width > flow.x &&
      box.x < flow.x + flow.width &&
      box.y + box.height > flow.y &&
      box.y < flow.y + flow.height;
    // Does the report box fit its text (no clipped label)?
    const clippedLabels = reports.filter((node) => {
      const box = node.querySelector('.rbg-report');
      return box !== null && box.scrollWidth > box.clientWidth + 1;
    }).length;
    // An arrow is drawn when it has a line with a length (or a loop curve) and arrowhead
    const drawnArrows = arrows.filter((arrow) => {
      const line = arrow.querySelector('line');
      const loop = arrow.querySelector('path');
      if (line !== null) {
        const box = line.getBoundingClientRect();
        return box.width + box.height > 1 && arrow.querySelectorAll('path').length >= 1;
      }
      return loop !== null && sizeOf(loop).width > 0;
    }).length;
    return {
      reportCount: reports.length,
      groupCount: groups.length,
      arrowCount: arrows.length,
      offCanvasReports: reports.filter((node) => !onCanvas(sizeOf(node))).length,
      clippedLabels,
      undrawnArrows: arrows.length - drawnArrows,
    };
  });

  if (result.reportCount === 0) {
    failures.push('no report boxes in the graph');
  }
  if (result.arrowCount === 0) {
    failures.push('no arrows in the graph');
  }
  if (result.offCanvasReports > 0) {
    failures.push(`${result.offCanvasReports} report boxes are not on the canvas`);
  }
  if (result.clippedLabels > 0) {
    failures.push(`${result.clippedLabels} report boxes are smaller than their text`);
  }
  if (result.undrawnArrows > 0) {
    failures.push(`${result.undrawnArrows} arrows are not drawn`);
  }
  // Dragging a report moves it (and the group box and arrows follow); Reset layout puts it back
  const report = page.locator('.rbg-report').first();
  const before = await report.boundingBox();
  if (before === null) {
    failures.push('cannot find a report box to drag');
  } else {
    const startX = before.x + before.width / 2;
    const startY = before.y + before.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY + 40, { steps: 4 });
    await page.mouse.move(startX + 80, startY + 80, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await report.boundingBox();
    if (after === null || Math.abs(after.x - before.x) < 40 || Math.abs(after.y - before.y) < 40) {
      failures.push('a report box did not move when dragged');
    }
    const arrowsAfter = await page.locator('.react-flow__edge line, .react-flow__edge path').count();
    if (arrowsAfter === 0) {
      failures.push('the arrows disappeared after a report was dragged');
    }
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await page.waitForTimeout(300);
    const reset = await report.boundingBox();
    if (reset === null || Math.abs(reset.x - before.x) > 2 || Math.abs(reset.y - before.y) > 2) {
      failures.push('Reset layout did not put the report back');
    }
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
