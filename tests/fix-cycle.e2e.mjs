import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { serve } from '../scripts/serve.mjs';
import { rows } from '../src/course.ts';
import { SAVE, LEGACY, RECOVERY, JOURNAL, defaults, prepareImport, commitImport } from '../src/backup.ts';

const directory = '.saikan/execution/offline-language-paths/fix-cycle-1';
const label = process.env.EVIDENCE_LABEL || 'browser-final';
const filter = process.argv[2] || '';
await mkdir(`${directory}/screenshots`, { recursive: true });
const { server, base, origin } = await serve();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const report = { origin, browser: browser.version(), checks: [], errors: [], screenshots: [] };
const synthetic = { ...defaults(), name: 'Synthetic Original', didSetup: true, hash: 'a'.repeat(64) };
async function fresh() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__writes = 0; window.__spoken = [];
    for (const method of ['setItem', 'removeItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) { window.__writes++; return original.apply(this, args); };
    }
    speechSynthesis.getVoices = () => [{ lang: 'pt-BR', localService: true, name: 'Synthetic BR' }];
    speechSynthesis.speak = u => window.__spoken.push(u.lang);
  });
  const page = await context.newPage(); page.setDefaultTimeout(4000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(base + '/backup');
  await page.evaluate(({ SAVE, synthetic }) => { localStorage.setItem(SAVE, JSON.stringify(synthetic)); window.__writes = 0; }, { SAVE, synthetic });
  return { context, page };
}
async function check(name, fn) {
  if (filter && !name.startsWith(filter)) return;
  const start = Date.now();
  try { await fn(); report.checks.push({ name, result: 'PASS', ms: Date.now() - start }); console.log('PASS ' + name); }
  catch (e) { report.checks.push({ name, result: 'FAIL', error: e.stack }); console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
async function shot(page, name) {
  const file = `${directory}/screenshots/${label}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file);
}
const stored = page => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
try {
  for (const route of ['/BACKUP', '/bAcKuP/', '/backup///', '/%62AcK%75P//', '/YOU']) {
    await check('F1 direct ' + route, async () => {
      const { context, page } = await fresh();
      try {
        await page.goto(base + route + '?keep=MiXeD#ExactHash');
        await page.getByRole('heading', { name: route === '/YOU' ? 'You & this device' : 'Safe backup & restore', exact: true }).waitFor();
        assert.equal(new URL(page.url()).search, '?keep=MiXeD'); assert.equal(new URL(page.url()).hash, '#ExactHash');
        assert.equal(await page.locator('#root').count(), 1);
        if (route !== '/YOU') {
          const before = await stored(page);
          await page.locator('#backup-json').fill('{"foreign":true}'); await page.locator('#preview').click(); assert.deepEqual(await stored(page), before);
          await page.locator('#backup-json').fill(JSON.stringify({ ...synthetic, name: 'Incoming' })); await page.locator('#preview').click();
          await page.getByText('Replacement preview', { exact: true }).waitFor(); assert.deepEqual(await stored(page), before);
          await page.locator('#cancel-import').click(); assert.deepEqual(await stored(page), before);
          assert.equal(await page.evaluate(() => window.__writes), 0);
          await page.locator('#preview').click(); await page.locator('#confirm-import').click();
          assert.equal(JSON.parse((await stored(page))[SAVE]).name, 'Incoming'); assert.ok((await stored(page))[RECOVERY]);
        }
        await shot(page, 'alias-' + route.replace(/\W/g, ''));
      } finally { await context.close(); }
    });
  }
  for (const method of ['pushState', 'replaceState', 'anchor', 'back-forward']) {
    await check('F1 legacy transition ' + method, async () => {
      const { context, page } = await fresh();
      try {
        await page.goto(base + '/calendar');
        const destination = '/SPRECHEN/%62AcKuP///?value=MiXeD#Unchanged';
        if (method === 'anchor') await page.evaluate(destination => { const a = document.createElement('a'); a.href = destination; a.textContent = 'Alias test'; document.body.append(a); a.click(); }, destination);
        else if (method === 'back-forward') {
          await page.goto(base + '/bAcKuP/'); await page.goto(base + '/calendar'); await page.goBack();
        } else await page.evaluate(({ method, destination }) => history[method]({}, '', destination), { method, destination });
        await page.getByRole('heading', { name: 'Safe backup & restore', exact: true }).waitFor();
        assert.equal(await page.locator('input[type=file]').count(), 1); assert.equal(await page.locator('#root').count(), 1);
        if (method !== 'back-forward') { assert.equal(new URL(page.url()).search, '?value=MiXeD'); assert.equal(new URL(page.url()).hash, '#Unchanged'); }
        if (method === 'back-forward') { await page.goForward(); await page.getByRole('link', { name: 'Languages ↗' }).waitFor(); }
      } finally { await context.close(); }
    });
  }
  await check('F1 new-tab alias navigation and reload cannot mount original importer', async () => {
    const { context, page } = await fresh();
    try {
      await page.goto(base + '/calendar');
      await page.evaluate(() => { const a = document.createElement('a'); a.href = '/sprechen/%62AcKuP///?v=Exact#Keep'; a.target = '_blank'; a.id = 'new-tab-alias'; a.textContent = 'Open backup in new tab'; document.body.append(a); });
      const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('#new-tab-alias').click()]);
      await tab.getByRole('heading', { name: 'Safe backup & restore', exact: true }).waitFor(); await tab.reload();
      await tab.locator('#backup-file').waitFor(); assert.equal(await tab.locator('input[type=file]').count(), 1);
      await tab.close();
    } finally { await context.close(); }
  });
  for (const scene of ['rp1', 'rp2', 'fd2']) {
    await check('F1 mixed-case actual scene controls ' + scene, async () => {
      const { context, page } = await fresh();
      try {
        await page.goto(base + `/pLaY/flirt/${scene}///`);
        await page.getByRole('heading', { name: 'Preserved social scene', exact: true }).waitFor();
        await page.goto(base + '/calendar');
        await page.evaluate(scene => history.pushState({}, '', `/SpReChEn/pLaY/%66lirt/${scene}///?data=CaSe#Keep`), scene);
        await page.getByRole('heading', { name: 'Preserved social scene', exact: true }).waitFor();
        const collection = rows(JSON.parse(await readFile('dist/course.json', 'utf8'))).filter(r => r.track === 'flirt' && r.lesson === scene);
        for (const row of collection) {
          await page.locator('#reveal').click(); assert.equal(await page.locator('.utterance').innerText(), row.item.say);
          const before = await stored(page);
          await page.locator('#hear').click();
          // Exercise every reachable playback/slow control; the maintained scene currently exposes one.
          for (const slow of await page.getByRole('button', { name: /slow/i }).all()) await slow.click();
          assert.deepEqual(await stored(page), before, row.key + ' blocked speech writes');
          assert.deepEqual(await page.evaluate(() => window.__spoken), []);
          await page.locator('#answer').fill(row.item.say); await page.locator('#check').click();
          const save = JSON.parse((await stored(page))[SAVE]);
          assert.equal(save.mastery[row.key].passive, 0); assert.equal(save.mastery[row.key].active, 1);
          assert.equal(save.localPaths.reviews[row.key].correct, true);
          await page.locator('#next').click();
        }
        await shot(page, scene);
      } finally { await context.close(); }
    });
  }
  await check('F6 malformed current JSON keeps recovery and exact raw export reachable', async () => {
    const { context, page } = await fresh();
    try {
      const before = { [SAVE]: JSON.stringify(synthetic), ...Object.fromEntries(LEGACY.map(k => [k, null])) };
      await page.evaluate(({ SAVE, RECOVERY, before }) => { localStorage.setItem(RECOVERY, JSON.stringify({ format: 'sprechen-recovery', version: 1, before })); localStorage.setItem(SAVE, '{'); }, { SAVE, RECOVERY, before });
      await page.reload(); const state = await stored(page);
      await page.getByRole('heading', { name: 'Safe backup & restore', exact: true }).waitFor();
      await page.locator('#undo-preview').click(); await page.locator('#undo-cancel').click(); assert.deepEqual(await stored(page), state);
      const [rawDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#raw-export').click()]);
      const rawFile = `${directory}/synthetic-raw-current.json`; await rawDownload.saveAs(rawFile);
      assert.equal(JSON.parse(await readFile(rawFile, 'utf8')).documents[SAVE], '{');
      const [recoveryDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#recovery-export').click()]);
      await recoveryDownload.saveAs(`${directory}/synthetic-recovery.json`);
      await page.locator('#export').click(); assert.match(await page.locator('#backup-error').innerText(), /JSON|malformed/i);
      assert.deepEqual(await stored(page), state); assert.equal(await page.evaluate(() => window.__writes), 0);
      await shot(page, 'corrupt-save');
      await page.locator('#undo-preview').click(); await page.locator('#undo-confirm').click(); assert.equal((await stored(page))[SAVE], before[SAVE]);
    } finally { await context.close(); }
  });
  await check('F2 actual second-tab writes after recovery preview reject with zero confirmation writes', async () => {
    const { context, page } = await fresh();
    try {
      await page.locator('#backup-json').fill(JSON.stringify({ ...synthetic, name: 'Incoming' })); await page.locator('#preview').click(); await page.locator('#confirm-import').click();
      const other = await context.newPage(); await other.goto(base + '/backup');
      for (const key of [SAVE, ...LEGACY, RECOVERY, JOURNAL]) {
        await page.locator('#undo-preview').click();
        await other.evaluate(key => localStorage.setItem(key, (localStorage.getItem(key) || '') + ' '), key);
        const before = await stored(page); await page.evaluate(() => window.__writes = 0);
        await page.locator('#undo-confirm').click(); assert.match(await page.locator('#backup-error').innerText(), /changed|preview/i);
        assert.deepEqual(await stored(page), before); assert.equal(await page.evaluate(() => window.__writes), 0);
        await other.evaluate(key => { const raw = localStorage.getItem(key); if (raw === ' ') localStorage.removeItem(key); else localStorage.setItem(key, raw.slice(0, -1)); }, key);
      }
      await other.close();
    } finally { await context.close(); }
  });
  await check('F3 pending journal intercepts legacy bootstrap before any getters write', async () => {
    const { context, page } = await fresh();
    try {
      const map = new Map([[SAVE, JSON.stringify(synthetic)], ...LEGACY.map(k => [k, JSON.stringify({ xp: 9999, sit: { 'de.old': { stars: 3 } }, ui: 'es' })])]);
      let dead = false;
      const s = { getItem: k => map.get(k) ?? null, setItem: (k, v) => { if (dead) throw Error('terminated'); map.set(k, v); if (k === LEGACY[0]) { dead = true; throw Error('terminated'); } }, removeItem: k => { if (dead) throw Error('terminated'); map.delete(k); } };
      assert.throws(() => commitImport(prepareImport(JSON.stringify(defaults()), s), s, true));
      await page.evaluate(entries => { for (const [k, v] of entries) localStorage.setItem(k, v); }, [...map]);
      await page.goto(base + '/play/de/m1'); const state = await stored(page);
      await page.getByRole('heading', { name: 'Safe backup & restore', exact: true }).waitFor();
      assert.match(await page.locator('#notice').innerText(), /incomplete|uncertain/i);
      await page.locator('#undo-preview').click(); await page.locator('#undo-cancel').click();
      assert.deepEqual(await stored(page), state); assert.equal(await page.evaluate(() => window.__writes), 0);
      await shot(page, 'pending-journal');
      await page.locator('#undo-preview').click(); await page.locator('#undo-confirm').click();
      assert.equal((await stored(page))[LEGACY[0]], JSON.stringify({ xp: 9999, sit: { 'de.old': { stars: 3 } }, ui: 'es' }));
    } finally { await context.close(); }
  });
  assert.deepEqual(report.errors, [], 'no browser page errors');
} finally {
  await writeFile(`${directory}/${label}-results.json`, JSON.stringify(report, null, 2));
  await browser.close(); server.close();
}
