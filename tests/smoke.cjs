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

  async function reset() {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('exercise-count').textContent !== '0');
  }
  async function setFormat(format) {
    await page.locator(`.format-card[data-format="${format}"]`).click();
  }
  async function setRange(id, value) {
    await page.locator(`#${id}`).evaluate((el, next) => {
      el.value = String(next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  async function generate() {
    await page.click('#generate-btn');
    await page.waitForSelector('#results:not(.hidden)');
  }

  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('exercise-count').textContent !== '0');

  await check('page loads without JS errors', async () => {
    await page.waitForTimeout(150);
    assert.deepEqual(pageErrors, []);
    assert.ok(await page.locator('#generate-btn').isVisible());
    assert.ok((await page.locator('#exercise-count').innerText()) !== '0');
    assert.ok((await page.locator('#warmup-count').innerText()) !== '0');
  });

  await check('assets are local and rendered', async () => {
    const result = await page.evaluate(() => ({
      external: [...document.querySelectorAll('link[href], script[src]')]
        .map(el => el.href || el.src)
        .filter(url => /^https?:/i.test(url)),
      styles: getComputedStyle(document.body).backgroundColor,
      icons: document.querySelectorAll('svg.lucide').length,
    }));
    assert.deepEqual(result.external, []);
    assert.notEqual(result.styles, 'rgba(0, 0, 0, 0)');
    assert.ok(result.icons > 0);
  });

  await check('sorting edits the row that was clicked', async () => {
    await page.click('.tab-btn[data-tab="database"]');
    await page.locator('#subtab-exercises .sort-btn[data-sort="Nom"]').click();
    const firstName = await page.locator('#exercise-table-body tr').first().locator('td').first().innerText();
    await page.locator('#exercise-table-body tr').first().locator('button[title="Modifier"]').click();
    assert.equal(await page.inputValue('#ex-name'), firstName);
    assert.equal(await page.getAttribute('#exercise-modal', 'aria-hidden'), 'false');
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#exercise-modal').evaluate(el => el.classList.contains('hidden')));
    assert.equal(await page.getAttribute('#exercise-modal', 'aria-hidden'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.title), 'Modifier');
  });

  await check('saving and deleting sorted rows use the original indexes', async () => {
    await page.locator('.sub-tab-btn[data-subtab="exercises"]').click();
    const firstName = await page.locator('#exercise-table-body tr').first().locator('td').first().innerText();
    await page.locator('#exercise-table-body tr').first().locator('button[title="Modifier"]').click();
    await page.fill('#ex-name', 'ZZ Smoke Test');
    await page.click('#modal-save');
    const afterEdit = await page.evaluate(name => ({
      oldName: exercises.filter(ex => ex.Nom === name).length,
      newName: exercises.filter(ex => ex.Nom === 'ZZ Smoke Test').length,
      arrow: document.querySelector('#subtab-exercises .sort-btn[data-sort="Nom"]').classList.contains('sort-asc'),
    }), firstName);
    assert.equal(afterEdit.oldName, 0);
    assert.equal(afterEdit.newName, 1);
    assert.equal(afterEdit.arrow, true);
    const countBefore = await page.evaluate(() => exercises.length);
    const deletedName = await page.locator('#exercise-table-body tr').first().locator('td').first().innerText();
    await page.locator('#exercise-table-body tr').first().locator('button[title="Supprimer"]').click();
    const afterDelete = await page.evaluate(name => ({
      count: exercises.length,
      name: exercises.filter(ex => ex.Nom === name).length,
    }), deletedName);
    assert.equal(afterDelete.count, countBefore - 1);
    assert.equal(afterDelete.name, 0);
    await reset();
  });

  await check('sort arrows stay on their own table', async () => {
    await page.click('.tab-btn[data-tab="database"]');
    await page.locator('#subtab-exercises .sort-btn[data-sort="Nom"]').click();
    await page.locator('.sub-tab-btn[data-subtab="warmup"]').click();
    assert.equal(await page.locator('#subtab-warmup .sort-btn[data-sort="Nom"]').evaluate(el => el.classList.contains('sort-asc')), false);
    await page.locator('#subtab-warmup .sort-btn[data-sort="Nom"]').click();
    const firstName = await page.locator('#warmup-table-body tr').first().locator('td').first().innerText();
    await page.locator('#warmup-table-body tr').first().locator('button[title="Modifier"]').click();
    assert.equal(await page.inputValue('#ex-name'), firstName);
    await page.keyboard.press('Escape');
  });

  await check('CSV handles commas, missing equipment and bad values', async () => {
    const result = await page.evaluate(() => {
      const csv = 'Nom,Objectif,Difficulté,Équipement,Intensité,Muscles\r\n"Test, virgule",Push,Débutant,Aucun,3,"Pectoraux, Épaules"\r\nSans matériel,Pull,Intermédiaire,,2,Dorsaux';
      const parsed = parseCSV(csv);
      const roundtrip = parseCSV(toCSV(parsed));
      const invalid = parseCSV('Nom,Objectif,Difficulté,Intensité\nMauvais,Push,Avance,99');
      return { parsed, roundtrip, invalid };
    });
    assert.equal(result.parsed.length, 2);
    assert.equal(result.parsed[0].Nom, 'Test, virgule');
    assert.equal(result.parsed[0].Muscles, 'Pectoraux, Épaules');
    assert.equal(result.parsed[1].Équipement, 'Aucun');
    assert.equal(result.roundtrip[0].Nom, 'Test, virgule');
    assert.equal(result.roundtrip[0].Muscles, 'Pectoraux, Épaules');
    assert.equal(result.invalid, null);
  });

  await check('notification and favorite names are escaped', async () => {
    await page.evaluate(() => {
      window.__xssNotify = 0;
      window.__xssFavorite = 0;
      notify('<img src=x onerror="window.__xssNotify=1">');
      favorites.unshift({
        id: 'xss',
        name: '<img src=x onerror="window.__xssFavorite=1">',
        workout: JSON.parse(JSON.stringify(currentWorkout || { main: [], warmup: [], cooldown: [], blocks: [], duration: 30, format: 'classic' })),
        createdAt: new Date().toISOString(),
      });
      saveFavorites();
    });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__xssNotify), 0);
    assert.equal(await page.evaluate(() => window.__xssFavorite), 0);
    assert.match(await page.locator('#notification-container .notification span').last().innerText(), /<img/);
    assert.match(await page.locator('#favorites-list .text-sm').first().innerText(), /<img/);
  });

  await check('Full-body includes Cardio in the generated session', async () => {
    await reset();
    await page.evaluate(() => {
      document.getElementById('goal-fullbody').checked = true;
      document.querySelectorAll('#goal-group .goal-cb').forEach(cb => { if (cb.value !== 'Full-body') cb.checked = false; });
    });
    await setFormat('classic');
    await setRange('duration', 30);
    await generate();
    const result = await page.evaluate(() => ({
      goals: currentWorkout.goal,
      main: currentWorkout.main.map(ex => ex.Objectif),
    }));
    assert.ok(result.goals.includes('Cardio'));
    assert.ok(result.main.includes('Cardio'));
  });

  await reset();
  await check('AMRAP summary matches the displayed circuit', async () => {
    await setFormat('amrap');
    await setRange('duration', 60);
    await generate();
    const result = await page.evaluate(() => ({
      main: currentWorkout.main.length,
      circuit: currentWorkout.blocks[0].exercises.length,
      cap: currentWorkout.blocks[0].timeCap,
      summary: document.getElementById('session-summary').innerText,
    }));
    assert.equal(result.main, result.circuit);
    assert.equal(result.cap, 20);
    assert.match(result.summary, /cible 60 min/);
    assert.match(result.summary, /Cap 20/);
  });

  await check('EMOM 60 shows a 20-minute block and the requested target', async () => {
    await setFormat('emom');
    await setRange('duration', 60);
    await generate();
    const result = await page.evaluate(() => ({
      emom: currentWorkout.blocks[0].emomDuration,
      summary: document.getElementById('session-summary').innerText,
    }));
    assert.equal(result.emom, 20);
    assert.match(result.summary, /EMOM 20/);
    assert.match(result.summary, /cible 60 min/);
  });

  await check('print output is dark on light and hides controls', async () => {
    await page.emulateMedia({ media: 'print' });
    const result = await page.evaluate(() => ({
      title: getComputedStyle(document.querySelector('#main-section h4')).color,
      summary: getComputedStyle(document.querySelector('#session-summary .text-white')).color,
      config: getComputedStyle(document.querySelector('#tab-config-session > .card')).display,
      favorites: getComputedStyle(document.getElementById('favorites-section')).display,
    }));
    await page.emulateMedia({ media: 'screen' });
    assert.equal(result.title, 'rgb(17, 17, 17)');
    assert.equal(result.summary, 'rgb(17, 17, 17)');
    assert.equal(result.config, 'none');
    assert.equal(result.favorites, 'none');
  });

  await reset();
  await check('reroll uses the generated level and equipment', async () => {
    await setRange('level', 0);
    await setFormat('classic');
    await generate();
    await page.evaluate(() => {
      document.querySelectorAll('#equipment-group input').forEach(cb => { cb.checked = cb.value === 'Barre de traction'; });
      const level = document.getElementById('level');
      level.value = '2';
      level.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#main-section button[title="Remplacer"]').first().click();
    const result = await page.evaluate(() => ({
      levelIdx: currentWorkout.levelIdx,
      level: currentWorkout.level,
      equipment: currentWorkout.equipment,
      difficulties: currentWorkout.main.map(ex => ex.Difficulté),
      equipments: currentWorkout.main.map(ex => ex.Équipement || 'Aucun'),
    }));
    assert.equal(result.levelIdx, 0);
    assert.equal(result.level, 'Débutant');
    assert.deepEqual(result.equipment, ['Aucun']);
    assert.ok(result.difficulties.every(d => d === 'Débutant'));
    assert.ok(result.equipments.every(e => e === 'Aucun'));
  });

  await check('prehab ignores cooldown items and cooldown stays on goal', async () => {
    const result = await page.evaluate(() => {
      const original = warmupExercises;
      warmupExercises = [
        { Nom: 'Étirement des poignets', Type: 'Retour au calme', Objectif: 'Push', Difficulté: 'Débutant', Intensité: 1, Muscles: 'Général' },
        { Nom: 'Mobilité des poignets', Type: 'Échauffement', Objectif: 'Push', Difficulté: 'Débutant', Intensité: 1, Muscles: 'Général' },
        { Nom: 'Étirement générique', Type: 'Retour au calme', Objectif: 'Pull', Difficulté: 'Débutant', Intensité: 1, Muscles: 'Général' },
        { Nom: 'Suspension barre', Type: 'Retour au calme', Objectif: 'Legs', Difficulté: 'Débutant', Intensité: 1, Muscles: 'Général' },
      ];
      const warm = getWarmupForGoal(['Push'], 30).map(e => e.Nom);
      const cool = getCooldownForGoal(['Pull'], 30).map(e => e.Nom);
      warmupExercises = original;
      return { warm, cool };
    });
    assert.ok(result.warm.includes('Mobilité des poignets'));
    assert.ok(!result.warm.includes('Étirement des poignets'));
    assert.ok(result.cool.includes('Étirement générique'));
    assert.ok(!result.cool.includes('Suspension barre'));
  });

  await check('session CSV has a BOM, fixed header and commas quoted', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => exportCSV()),
    ]);
    const file = await download.path();
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.charCodeAt(0), 0xFEFF);
    const header = content.slice(1).split(/\r?\n/)[0];
    assert.match(header, /Répétitions/);
    assert.equal(header.split(',').length, 11);
  });

  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
