import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { serve } from '../scripts/serve.mjs';

const executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { server, base, origin } = await serve();
const browser = await chromium.launch({ executablePath, headless: true });
const report = { origin, browser: await browser.version(), checks: [], errors: [], screenshots: [] };
const artifactRoot = process.env.SPRECHEN_TEST_ARTIFACTS || 'artifacts';
await mkdir(`${artifactRoot}/screenshots`, { recursive: true });
const SAVE = 'sprechen.local.v1', OLD = ['sprechen.v4', 'sprechen.v3', 'sprechen.v2', 'sprechen.accts.v1'];
const synthetic = { name: 'Synthetic Ada', didSetup: true, ui: 'en', theme: 'night', goal: 10, xp: 120, streak: 2, last: '', sit: { 'de.m1': { stars: 3 } }, days: {}, eggs: {}, srs: {}, hlr: {}, hash: 'a'.repeat(64), unknownPreference: { keep: true } };
const storage = page => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
const go = (page, path) => page.goto(base + path, { waitUntil: 'networkidle' });
const text = async (page, expected) => assert.ok((await page.locator('body').innerText()).includes(expected), `Missing text: ${expected}`);
async function screenshot(page, name) { const file = `${artifactRoot}/screenshots/${name}.png`; await page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); report.screenshots.push(file); }
function monitor(page) {
  page.on('pageerror', error => report.errors.push('pageerror: ' + error.message));
  page.on('console', msg => { if (msg.type() === 'error') report.errors.push('console: ' + msg.text() + ' ' + msg.location().url); });
}
async function check(name, callback) {
  const start = Date.now(); await callback(); report.checks.push({ name, result: 'PASS', ms: Date.now() - start }); console.log('PASS ' + name);
}
let context;
try {
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'allow' });
  const page = await context.newPage(); monitor(page);
  await go(page, '/today');
  // Only a fresh isolated browser context and random local origin receive synthetic data.
  await page.evaluate(({ SAVE, OLD, synthetic }) => {
    localStorage.setItem(SAVE, JSON.stringify(synthetic));
    for (const k of OLD) localStorage.setItem(k, JSON.stringify({ ui: 'es', theme: 'jade', accounts: [{ id: 'synthetic-only' }], sit: { 'de.archived': { stars: 2 } }, seen: { 'de.ancient': 1 }, xp: 9000, streak: 99, custom: 'keep' }));
    localStorage.setItem('test.unrelated', 'retained');
  }, { SAVE, OLD, synthetic });

  await check('picker → all five language scopes, no language locks', async () => {
    for (const [id, label, expected] of [['de','Deutsch','647 locally'], ['fr','Français','A programmer’s introduction'], ['pt','Português · Portugal','5 locally'], ['it','Italiano','11 locally'], ['tn','Tunisian / Arabic context','No assessed course']]) {
      await go(page, '/today'); await page.getByRole('link', { name: label + ' →', exact: true }).click();
      await page.getByRole('heading', { name: label, exact: true }).waitFor(); await text(page, expected);
    }
    await go(page, '/today'); await screenshot(page, 'desktop-picker');
  });

  await check('French complete integrated unit: attempt → help → production → negative/repair → success → review', async () => {
    await go(page, '/language/fr'); await page.getByRole('link', { name: 'Start French unit', exact: true }).click();
    await page.getByRole('button', { name: 'Listen to scene · system TTS', exact: true }).click();
    await page.getByRole('button', { name: 'Try understanding', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal translation and help', exact: true }).click(); await text(page, 'Make an understanding attempt');
    await page.getByRole('button', { name: 'It runs a restaurant', exact: true }).click(); await text(page, 'That is not the company described');
    await page.getByRole('button', { name: 'It develops systems and AI tools', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal translation and help', exact: true }).click(); await text(page, 'I work at a company');
    await page.getByRole('button', { name: 'Read and produce', exact: true }).click();
    await page.locator('#production').fill('Bonjour, je m’appelle Alex. Je suis programmeur. Je travaille dans une entreprise de systèmes informatiques et d’intelligence artificielle.');
    await page.getByRole('button', { name: 'Check introduction and save', exact: true }).click(); await text(page, 'Key ideas found');
    await page.getByRole('button', { name: 'Join the conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Je voudrais un café.', exact: true }).click(); await text(page, 'does not explain your work');
    await page.getByRole('button', { name: 'Pouvez-vous répéter plus lentement, s’il vous plaît ?', exact: true }).click(); await text(page, 'Repair branch');
    await screenshot(page, 'desktop-french-repair');
    await page.locator('#good').click(); await text(page, 'vous vendez des ordinateurs');
    await page.locator('#negative').click(); await text(page, 'Misunderstanding'); await page.locator('#repair').click();
    await page.locator('#good').click(); await page.locator('#good').click(); await text(page, 'Six French lines');
    await page.getByRole('link', { name: 'Review French now', exact: true }).click(); await text(page, 'Local review');
    await page.locator('#answer').fill('Bonjour, je m’appelle Alex.'); await page.locator('#check').click(); await text(page, 'Matched · saved');
    const current = JSON.parse((await storage(page))[SAVE]); assert.equal(current.sit['de.m1'].stars, 3); assert.deepEqual(current.unknownPreference, { keep: true });
  });

  await check('real original German engine and legacy history navigation to guarded You/Backup', async () => {
    await go(page, '/play/de/m1'); await text(page, "Hi, I'm Oliver."); await screenshot(page, 'desktop-original-german');
    await page.getByPlaceholder('Type it in the language').fill('Hallo, ich heiße Oliver.'); await page.getByRole('button', { name: /Check/ }).click(); await text(page, 'Yes.');
    const before = JSON.parse((await storage(page))[SAVE]); assert.equal(before.sit['de.m1'].stars, 3);
    await go(page, '/calendar'); await page.getByRole('link', { name: /You/, exact: false }).click();
    await page.getByRole('heading', { name: 'You & this device', exact: true }).waitFor();
    assert.equal(await page.locator('input[type=file]').count(), 0);
    await page.getByRole('link', { name: 'Safe export / import / recovery', exact: true }).click();
    await page.getByRole('heading', { name: 'Safe backup & restore', exact: true }).waitFor();
    await go(page, '/backup'); await text(page, 'Safe backup & restore'); assert.equal(await page.locator('#confirm-import').count(), 0);
    await go(page, '/themes'); await page.evaluate(() => history.pushState({}, '', '/sprechen/backup'));
    await page.getByRole('heading', { name: 'Safe backup & restore', exact: true }).waitFor();
  });

  await check('original sign-in/secret and setup remain reachable; preserved mixed scene keeps original language order', async () => {
    await go(page, '/'); await page.locator('input[type=password]').fill('synthetic-wrong-secret');
    await page.getByRole('button', { name: 'Enter Sprechen', exact: false }).click(); await text(page, 'Wrong secret for this browser.');
    await go(page, '/setup'); await text(page, 'Setup · Once');
    await go(page, '/play/flirt/fd2'); await text(page, 'Preserved social scene');
    await page.locator('#reveal').click(); await text(page, 'Bom dia. Ainda estás acordada?');
    await page.locator('#answer').fill('Bom dia. Ainda estás acordada?'); await page.locator('#check').click(); await page.locator('#next').click();
    await page.locator('#reveal').click(); await text(page, "Ciao. Ce l'hai fatta.");
    await go(page, '/play/flirt/rp1'); await page.locator('#reveal').click(); await text(page, 'Boa noite. Posso anotar o pedido?');
    assert.ok(!(await page.locator('body').innerText()).includes('boa NOY-te'));
  });

  await check('backup export/import full roundtrip: invalid + preview + cancel + confirm + recovery; stale migration stays quarantined', async () => {
    await go(page, '/backup'); const before = await storage(page);
    await page.locator('#backup-json').fill('{"foreign":true}'); await page.locator('#preview').click(); await text(page, 'Not a complete Sprechen'); assert.deepEqual(await storage(page), before);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
    const output = `${artifactRoot}/synthetic-roundtrip.json`; await download.saveAs(output); const exported = await readFile(output, 'utf8');
    const envelope = JSON.parse(exported); assert.equal(envelope.format, 'sprechen-backup'); assert.equal(envelope.version, 1); assert.deepEqual(envelope.data.unknownPreference, { keep: true });
    await page.locator('#backup-file').setInputFiles(output); await page.locator('#preview').click(); await text(page, 'Replacement preview'); assert.deepEqual(await storage(page), before);
    await page.locator('#cancel-import').click(); assert.deepEqual(await storage(page), before);
    await page.locator('#preview').click(); await page.locator('#confirm-import').click(); await text(page, 'Import complete');
    assert.deepEqual(JSON.parse((await storage(page))[SAVE]), envelope.data);
    // Then use a valid raw legacy export with less progress; ensure old max/merge cannot resurrect it.
    const confirmedBefore = await storage(page);
    await page.locator('#backup-json').fill(JSON.stringify({ ...synthetic, name: 'Incoming synthetic', xp: 1, streak: 0, sit: {}, hash: 'b'.repeat(64) }));
    await page.locator('#preview').click(); await screenshot(page, 'desktop-backup-preview'); await page.locator('#confirm-import').click();
    let current = JSON.parse((await storage(page))[SAVE]); assert.equal(current.xp, 1); assert.equal(current.hash, 'a'.repeat(64));
    for (const k of OLD) { const v = JSON.parse((await storage(page))[k]); assert.equal(v.xp, undefined); assert.equal(v.sit, undefined); assert.equal(v.ui, 'es'); assert.equal(v.accounts[0].id, 'synthetic-only'); }
    await go(page, '/calendar'); // execute original Q() migration reader
    current = JSON.parse((await storage(page))[SAVE]); assert.equal(current.xp, 1); assert.deepEqual(current.sit, {});
    await go(page, '/backup'); const beforeUndo = await storage(page); await page.locator('#undo-preview').click(); await page.locator('#undo-cancel').click(); assert.deepEqual(await storage(page), beforeUndo);
    await page.locator('#undo-preview').click(); await page.locator('#undo-confirm').click();
    const restored = await storage(page); for (const k of [SAVE, ...OLD]) assert.equal(restored[k], confirmedBefore[k]); assert.equal(restored['test.unrelated'], 'retained');
  });

  await check('offline cache readiness, full reload + deep route + practice/save/review + original route + online recovery', async () => {
    await go(page, '/language/pt');
    await page.waitForFunction(() => document.getElementById('offline-status')?.textContent.includes('Offline ready'), null, { timeout: 45000 });
    await context.setOffline(true); await page.reload({ waitUntil: 'networkidle' }); await text(page, 'Português · Portugal'); await text(page, 'Offline now');
    await page.getByRole('link', { name: 'Start text practice', exact: true }).click(); await page.reload({ waitUntil: 'networkidle' });
    await text(page, 'A red to start?'); await page.locator('#answer').fill('Um vinho tinto para começar?'); await page.locator('#check').click(); await text(page, 'Matched · saved');
    await page.getByRole('link', { name: 'Review', exact: true }).click(); await text(page, 'Local review');
    await go(page, '/review-local?language=pt'); await page.reload({ waitUntil: 'networkidle' }); await text(page, 'Local review');
    await page.locator('#reveal').click(); const reviewLine = await page.locator('.utterance').innerText();
    await page.locator('#answer').fill(reviewLine); await page.locator('#check').click(); await text(page, 'Matched · saved'); await screenshot(page, 'desktop-offline-review');
    await go(page, '/series/fr/intro'); await text(page, 'A programmer’s introduction');
    await go(page, '/play/de/m1'); await text(page, "Hi, I'm Oliver.");
    await context.setOffline(false); await go(page, '/today'); await text(page, 'Where will you go today?');
    const data = JSON.parse((await storage(page))[SAVE]); assert.ok(data.localPaths.reviews['flirt::rp1::2']); assert.equal(data.sit['de.m1'].stars, 3);
  });

  await check('missing pt-PT voice and unavailable system audio retain working text; legacy speech cannot choose pt-BR', async () => {
    const voices = await browser.newContext({ serviceWorkers: 'allow' });
    await voices.addInitScript(() => {
      window.__spoken = [];
      speechSynthesis.getVoices = () => [{ lang: 'pt-BR', localService: true, name: 'Synthetic Brazilian' }];
      speechSynthesis.speak = u => window.__spoken.push(u.lang);
    });
    const v = await voices.newPage(); monitor(v); await go(v, '/practice/pt'); await v.locator('#hear').click(); await text(v, 'local system voice unavailable');
    await v.locator('#answer').fill('Um vinho tinto para começar?'); await v.locator('#check').click(); await text(v, 'Matched · saved');
    await go(v, '/play/de/m1'); await v.evaluate(() => { const u = new SpeechSynthesisUtterance('teste'); u.lang = 'pt-PT'; speechSynthesis.speak(u); });
    await text(v, 'Portugal voice unavailable'); assert.deepEqual(await v.evaluate(() => window.__spoken), []);
    await voices.close();
  });

  await check('unavailable optional video shows useful fallback without blocking text practice', async () => {
    const unavailable = await browser.newContext({ serviceWorkers: 'block' });
    await unavailable.route('**/video/ubahn.mp4', route => route.fulfill({ status: 200, contentType: 'video/mp4', body: 'Synthetic unavailable media' }));
    const v = await unavailable.newPage(); monitor(v); await go(v, '/language/de');
    await v.locator('#load-context-video').click(); await v.getByText('Optional video unavailable. Continue with local text practice.', { exact: true }).waitFor();
    await v.getByRole('link', { name: 'Start text practice', exact: true }).click(); await v.locator('#answer').fill('Hallo, ich heiße Oliver.'); await v.locator('#check').click(); await text(v, 'Matched · saved');
    await unavailable.close();
  });

  await check('390×844 responsive flows, stable screenshots and no horizontal overflow', async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
    const m = await mobile.newPage(); monitor(m);
    for (const [path, name] of [['/today','mobile-picker'], ['/language/pt','mobile-portugal'], ['/series/fr/intro','mobile-french'], ['/backup','mobile-backup']]) {
      await go(m, path); await screenshot(m, name); assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow: ${path}`);
    }
    await m.locator('#backup-json').fill(JSON.stringify(synthetic)); await m.locator('#preview').click(); await text(m, 'Replacement preview'); await m.locator('#cancel-import').click(); await text(m, 'No data was written');
    await mobile.close();
  });
  assert.deepEqual(report.errors, []); console.log('PASS no browser console/page errors');
} catch (error) {
  report.failure = error.stack; console.error(error); process.exitCode = 1;
  for (const page of context?.pages() || []) await screenshot(page, 'failure').catch(() => {});
} finally {
  await writeFile(`${artifactRoot}/e2e-results.json`, JSON.stringify(report, null, 2));
  await browser.close(); server.close();
}
