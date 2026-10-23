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

  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#week-grid .week-day', { state: 'attached' });

  await check('weekly planner tab shows seven empty editable days', async () => {
    await page.click('.tab-btn[data-tab="week"]');
    await page.waitForSelector('#tab-week:not(.hidden)');
    assert.equal(await page.locator('#week-grid .week-day').count(), 7);
    assert.equal(await page.locator('#week-grid .week-note').count(), 7);
    const values = await page.locator('#week-grid .week-note').evaluateAll(els => els.map(el => el.value));
    assert.deepEqual(values, ['', '', '', '', '', '', '']);
    assert.match(await page.textContent('#week-range'), /^Du \d/);
  });

  await check('dates run Monday to Sunday and today is highlighted', async () => {
    const dates = await page.locator('.week-day').evaluateAll(els => els.map(el => el.dataset.date));
    const weekdays = dates.map(key => new Date(`${key}T12:00:00`).getDay());
    assert.deepEqual(weekdays, [1, 2, 3, 4, 5, 6, 0]);
    const todayKey = await page.evaluate(() => {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    });
    const today = page.locator(`.week-day[data-date="${todayKey}"]`);
    assert.equal(await today.count(), 1);
    assert.equal(await today.evaluate(el => el.classList.contains('is-today')), true);
  });

  let firstKey;
  await check('adding an exercise creates name, reps and load fields', async () => {
    assert.equal(await page.locator('#week-grid .week-add-exercise').count(), 7);
    const ordered = await page.locator('.week-day').evaluateAll(days => days.every(day => {
      const button = day.querySelector('.week-add-exercise');
      const exercises = day.querySelector('.week-exercises');
      const note = day.querySelector('.week-note');
      return button && exercises && note && button.nextElementSibling === exercises && exercises.nextElementSibling === note;
    }));
    assert.equal(ordered, true);

    firstKey = await page.locator('.week-day').first().getAttribute('data-date');
    const day = page.locator(`.week-day[data-date="${firstKey}"]`);
    const addButton = day.locator('.week-add-exercise');
    await addButton.click();
    assert.equal(await day.locator('.week-exercise').count(), 1);
    const placeholders = await day.locator('.week-exercise input').evaluateAll(els => els.map(el => el.placeholder));
    assert.deepEqual(placeholders, ['Nom', 'Reps', 'Lest']);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('week-exercise-name')), true);

    await day.locator('.week-exercise-name').fill('Pompes');
    await day.locator('.week-exercise-reps').fill('12');
    await day.locator('.week-exercise-load').fill('10 kg');
    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_week_exercises')));
    assert.deepEqual(stored[firstKey], [{ name: 'Pompes', reps: '12', load: '10 kg' }]);

    await addButton.click();
    assert.equal(await day.locator('.week-exercise').count(), 2);
    await day.locator('.week-exercise').nth(1).locator('.week-exercise-name').fill('Tractions');
    await day.locator('.week-exercise').nth(1).locator('.week-exercise-reps').fill('8');
    await day.locator('.week-exercise').nth(1).locator('.week-exercise-load').fill('5 kg');
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_week_exercises')));
    assert.deepEqual(stored[firstKey], [
      { name: 'Pompes', reps: '12', load: '10 kg' },
      { name: 'Tractions', reps: '8', load: '5 kg' },
    ]);
  });

  await check('typing in a day saves an entry in localStorage', async () => {
    firstKey = await page.locator('.week-day').first().getAttribute('data-date');
    await page.fill(`.week-note[data-date="${firstKey}"]`, 'Pompes 4×12\nTractions 5×5');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_week_plan')));
    assert.equal(stored[firstKey], 'Pompes 4×12\nTractions 5×5');
  });

  await check('saved notes and exercises survive a reload and reopening the tab', async () => {
    await page.reload({ waitUntil: 'load' });
    await page.click('.tab-btn[data-tab="week"]');
    await page.waitForSelector('#tab-week:not(.hidden)');
    assert.equal(await page.inputValue(`.week-note[data-date="${firstKey}"]`), 'Pompes 4×12\nTractions 5×5');
    const rows = page.locator(`.week-day[data-date="${firstKey}"] .week-exercise`);
    assert.equal(await rows.count(), 2);
    const exercises = await rows.evaluateAll(els => els.map(el => ({
      name: el.querySelector('.week-exercise-name').value,
      reps: el.querySelector('.week-exercise-reps').value,
      load: el.querySelector('.week-exercise-load').value,
    })));
    assert.deepEqual(exercises, [
      { name: 'Pompes', reps: '12', load: '10 kg' },
      { name: 'Tractions', reps: '8', load: '5 kg' },
    ]);
  });

  await check('week navigation keeps a separate note for each week', async () => {
    const currentDates = await page.locator('.week-day').evaluateAll(els => els.map(el => el.dataset.date));
    const rangeBefore = await page.textContent('#week-range');
    await page.click('#week-prev');
    const previousDates = await page.locator('.week-day').evaluateAll(els => els.map(el => el.dataset.date));
    assert.notEqual(await page.textContent('#week-range'), rangeBefore);
    assert.ok(previousDates[6] < currentDates[0]);
    await page.fill(`.week-note[data-date="${previousDates[0]}"]`, 'Semaine précédente');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_week_plan')));
    assert.equal(stored[previousDates[0]], 'Semaine précédente');
    assert.equal(stored[firstKey], 'Pompes 4×12\nTractions 5×5');
    await page.click('#week-today');
    const todayDates = await page.locator('.week-day').evaluateAll(els => els.map(el => el.dataset.date));
    assert.deepEqual(todayDates, currentDates);
  });

  await check('the week exports a Google Sheets-compatible CSV', async () => {
    const downloadPromise = page.waitForEvent('download');
    await page.click('#week-export');
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^semaine-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.ok(csv.startsWith('\uFEFFDate,Jour,Exercice,Répétitions,Lest,Notes\r\n'));
    assert.ok(csv.includes(`${firstKey},Lundi,Pompes,12,10 kg,"Pompes 4×12\nTractions 5×5"`));
    assert.ok(csv.includes(`${firstKey},Lundi,Tractions,8,5 kg,`));
  });

  await check('removing an exercise deletes its row and stored data', async () => {
    const day = page.locator(`.week-day[data-date="${firstKey}"]`);
    await day.locator('.week-exercise').first().locator('.week-exercise-remove').click();
    assert.equal(await day.locator('.week-exercise').count(), 1);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_week_exercises')));
    assert.deepEqual(stored[firstKey], [{ name: 'Tractions', reps: '8', load: '5 kg' }]);
  });

  await check('emptying a day removes its stored note', async () => {
    await page.fill(`.week-note[data-date="${firstKey}"]`, '');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('calisthenics_week_plan')));
    assert.equal(stored[firstKey], undefined);
  });

  await check('weekly planner is one column on a phone with no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('.tab-btn[data-tab="week"]');
    const layout = await page.evaluate(() => {
      const grid = document.getElementById('week-grid');
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    assert.equal(layout.columns, 1);
    assert.ok(layout.scrollWidth <= layout.innerWidth, `${layout.scrollWidth} > ${layout.innerWidth}`);
  });

  await check('page has no JavaScript errors', async () => {
    assert.deepEqual(pageErrors, []);
  });

  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
