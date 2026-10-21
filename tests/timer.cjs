const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const pageUrl = pathToFileURL(path.join(root, 'index.html')).href;
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Users\\lucas\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe',
].filter(Boolean);
const executablePath = chromeCandidates.find(p => fs.existsSync(p));

let failures = 0;
let passes = 0;

async function check(name, fn) {
  try {
    await fn();
    passes++;
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL - ${name}\n${error.stack || error}`);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', msg => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  async function menu() {
    await page.evaluate(() => { window.ChronoWod.open(); });
    const back = page.locator('#timer-app [data-action="back"]');
    if (await back.count()) await back.first().click();
    const menuBtn = page.locator('#timer-app [data-action="menu"]');
    if (await menuBtn.count()) await menuBtn.first().click();
    await page.waitForSelector('#timer-app .timer-menu');
  }

  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.ChronoWod !== 'undefined');

  await check('chronometer shortcut opens a five-mode timer tab', async () => {
    await page.click('#timer-shortcut');
    await page.waitForSelector('#tab-timer:not(.hidden)');
    assert.equal(await page.locator('#timer-app .timer-mode-btn').count(), 5);
    assert.equal(await page.locator('#timer-shortcut').evaluate(el => el.classList.contains('active')), true);
    assert.ok(await page.locator('.timer-logo').isVisible());
  });

  await check('timeline totals and phases are exact', async () => {
    const data = await page.evaluate(() => {
      window.ChronoWod.setSettings({ intro: 0, sound: false, voice: false });
      const tabata = window.ChronoWod.buildTimeline({ mode: 'tabata', work: 20, rest: 10, rounds: 8, sets: 1, setRest: 60 });
      const emom = window.ChronoWod.buildTimeline({ mode: 'emom', duration: 600, interval: 60 });
      const amrap = window.ChronoWod.buildTimeline({ mode: 'amrap', duration: 600 });
      const fortime = window.ChronoWod.buildTimeline({ mode: 'fortime', cap: 0 });
      const mix = window.ChronoWod.buildTimeline({
        mode: 'mix', rounds: 2, blocks: [
          { type: 'amrap', duration: 60 },
          { type: 'work', duration: 30 },
        ],
      });
      return {
        tabata: { total: tabata.totalSeconds, phases: tabata.phases.length, work: tabata.phases.filter(p => p.kind === 'work').length },
        emom: { total: emom.totalSeconds, phases: emom.phases.length },
        amrap: { total: amrap.totalSeconds, phases: amrap.phases.length },
        fortime: { unknown: fortime.unknown, phases: fortime.phases.length },
        mix: { total: mix.totalSeconds, phases: mix.phases.length },
      };
    });
    assert.deepEqual(data.tabata, { total: 230, phases: 15, work: 8 });
    assert.deepEqual(data.emom, { total: 600, phases: 10 });
    assert.deepEqual(data.amrap, { total: 600, phases: 1 });
    assert.equal(data.fortime.unknown, true);
    assert.equal(data.fortime.phases, 1);
    assert.deepEqual(data.mix, { total: 180, phases: 4 });
  });

  await check('short tabata runs and logs itself', async () => {
    await page.evaluate(() => window.ChronoWod.start({ mode: 'tabata', work: 1, rest: 1, rounds: 2, sets: 1, setRest: 0, notes: 'auto' }));
    await page.waitForSelector('.timer-shell-run');
    await page.waitForFunction(() => window.ChronoWod.getState().view === 'done', null, { timeout: 8000 });
    assert.ok(await page.locator('.timer-done').isVisible());
    assert.match(await page.locator('.timer-done-kicker').innerText(), /TERMINÉE/);
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_timer_log')));
    assert.equal(log.length, 1);
    assert.equal(log[0].mode, 'tabata');
    assert.ok(log[0].duration >= 3);
  });

  await check('AMRAP laps, summary and average work', async () => {
    await page.evaluate(() => window.ChronoWod.start({ mode: 'amrap', duration: 600 }));
    await page.waitForSelector('#timer-lap');
    await page.waitForTimeout(550);
    await page.click('#timer-lap');
    await page.waitForTimeout(550);
    await page.click('#timer-lap');
    const state = await page.evaluate(() => window.ChronoWod.getState());
    assert.equal(state.rounds, 2);
    await page.evaluate(() => window.ChronoWod.finish());
    await page.waitForSelector('.timer-done');
    await page.click('#timer-app [data-action="summary"]');
    await page.waitForSelector('.timer-summary');
    assert.equal(await page.locator('.timer-split-row').count(), 2);
    assert.notEqual((await page.locator('.timer-stat').nth(2).innerText()).includes('—'), true);
  });

  await check('preset saves and starts from the library', async () => {
    await menu();
    await page.click('#timer-app [data-action="mode"][data-mode="amrap"]');
    await page.fill('#timer-min', '1');
    await page.click('#timer-app [data-action="save-preset"]');
    await page.fill('#timer-preset-name', 'AMRAP test');
    await page.click('[data-preset-save]');
    assert.equal(await page.locator('#timer-preset-modal').count(), 0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_timer_presets')));
    assert.equal(saved.length, 1);
    await page.click('#timer-app [data-action="presets"]');
    await page.waitForSelector('.timer-presets');
    assert.match(await page.locator('.timer-presets .timer-list-item').innerText(), /AMRAP test/);
    await page.click('#timer-app [data-action="start-preset"]');
    await page.waitForSelector('.timer-shell-run');
    assert.equal(await page.evaluate(() => window.ChronoWod.getState().mode), 'amrap');
    await page.evaluate(() => window.ChronoWod.finish());
    await page.waitForSelector('.timer-done');
  });

  await check('journal CSV is a BOM UTF-8 export', async () => {
    await menu();
    await page.click('#timer-app [data-action="log"]');
    const downloadPromise = page.waitForEvent('download');
    await page.click('#timer-app [data-action="export-log"]');
    const download = await downloadPromise;
    const file = await download.path();
    const buffer = fs.readFileSync(file);
    assert.equal(buffer[0], 0xEF);
    assert.equal(buffer[1], 0xBB);
    assert.equal(buffer[2], 0xBF);
    const text = buffer.toString('utf8');
    assert.match(text, /Date,Mode,Durée \(s\),Durée,Tours,Notes/);
    assert.match(download.suggestedFilename(), /^chrono-wod-journal-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  await check('settings contrast and persistence work', async () => {
    await menu();
    await page.click('#timer-app [data-action="settings"]');
    await page.waitForSelector('.timer-settings');
    await page.click('#timer-app [data-action="toggle-setting"][data-key="contrast"]');
    assert.equal(await page.locator('#timer-app').evaluate(el => el.classList.contains('timer-contrast')), true);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_timer_settings')));
    assert.equal(saved.contrast, true);
    await page.click('#timer-app [data-action="toggle-setting"][data-key="contrast"]');
    assert.equal(await page.locator('#timer-app').evaluate(el => el.classList.contains('timer-contrast')), false);
  });

  await check('MIX builder adds a block and starts', async () => {
    await menu();
    await page.click('#timer-app [data-action="mode"][data-mode="mix"]');
    await page.waitForSelector('.timer-mix');
    await page.click('#timer-app [data-action="mix-add"]');
    await page.fill('#mix-label', 'Bloc test');
    await page.fill('#mix-minutes', '1');
    await page.click('#timer-app [data-action="mix-save"]');
    assert.equal(await page.locator('.timer-mix-block').count(), 1);
    assert.match(await page.locator('.timer-mix-block').innerText(), /Bloc test/);
    await page.click('#timer-app [data-action="start"]');
    await page.waitForSelector('.timer-shell-run');
    assert.equal(await page.evaluate(() => window.ChronoWod.getState().mode), 'mix');
    await page.evaluate(() => window.ChronoWod.finish());
    await page.waitForSelector('.timer-done');
  });

  await check('stop confirmation keeps or ends the run', async () => {
    await page.evaluate(() => window.ChronoWod.start({ mode: 'amrap', duration: 600 }));
    await page.waitForSelector('.timer-shell-run');
    await page.click('#timer-app [data-action="back"]');
    await page.waitForSelector('#timer-app .timer-modal');
    await page.click('#timer-app .timer-modal-card [data-action="stop-cancel"]');
    assert.equal(await page.evaluate(() => window.ChronoWod.getState().view), 'run');
    await page.click('#timer-app [data-action="finish"]');
    await page.waitForSelector('#timer-app .timer-modal');
    await page.click('#timer-app [data-action="stop-confirm"]');
    await page.waitForSelector('.timer-done');
    assert.match(await page.locator('.timer-done-kicker').innerText(), /ARRÊTÉE/);
  });

  await check('timer UI produced no JavaScript errors', async () => {
    assert.deepEqual(pageErrors, []);
  });

  console.log(`\n${passes} passed, ${failures} failed`);
  await browser.close();
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
