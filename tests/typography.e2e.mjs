import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const directory = '.saikan/execution/typography';
await mkdir(`${directory}/screenshots`, { recursive: true });
const aRoot = path.resolve(directory, 'before-dist'), bRoot = path.resolve('dist');
const a = JSON.parse(await readFile(path.join(aRoot, 'build-info.json'), 'utf8'));
const b = JSON.parse(await readFile(path.join(bRoot, 'build-info.json'), 'utf8'));
assert.equal(a.version, '03d838211c5333bf', 'Use the preserved actual old build');
assert.notEqual(a.version, b.version);
const report = { a: a.version, b: b.version, coreResources: b.coreResources, checks: [], screens: [], fonts: [], layouts: [], requests: [], errors: [] };
let current = aRoot, holdWorker = false, releaseWorkers = [];
const server = http.createServer(async (req, res) => {
  const root = current;
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.replace(/^\/sprechen\//, ''));
  report.requests.push({ path: relative, build: root === aRoot ? a.version : b.version, worker: req.headers['service-worker'] || false });
  if (holdWorker && root === bRoot && relative === 'sw.js') await new Promise(resolve => releaseWorkers.push(resolve));
  let file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    try { if (!(await stat(file)).isFile()) throw Error(); }
    catch { if (req.headers.accept?.includes('text/html') && !path.extname(relative)) file = path.join(root, 'index.html'); else { res.writeHead(404); res.end(); return; } }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/sprechen/' });
    res.end(await readFile(file));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, base = origin + '/sprechen';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
report.browser = browser.version();
const synthetic = { name: 'Synthetic Typography', didSetup: true, ui: 'en', theme: 'night', goal: 10, xp: 120, streak: 2, last: '', sit: {}, days: {}, eggs: {}, srs: {}, hlr: {} };
async function contextFor(viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'allow' });
  await context.addInitScript(({ synthetic, origin }) => {
    if (location.origin === origin && window.top === window && !localStorage.getItem('sprechen.local.v1')) localStorage.setItem('sprechen.local.v1', JSON.stringify(synthetic));
  }, { synthetic, origin });
  context.on('request', req => { if (!req.url().startsWith(origin) && !req.url().startsWith('data:')) report.errors.push('External request: ' + req.url()); });
  context.on('page', page => page.on('pageerror', e => report.errors.push(e.message)));
  return context;
}
async function ready(page) {
  await page.waitForFunction(() => document.getElementById('offline-status')?.textContent.includes('Offline ready'), null, { timeout: 35000 });
}
async function workerStatus(page) {
  return page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return new Promise(resolve => { const c = new MessageChannel(); c.port1.onmessage = e => resolve(e.data); r.active.postMessage('STATUS', [c.port2]); });
  });
}
async function fontsFor(page, selector, expected = 'Nunito', allowNavigationArrow = false) {
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    assert.ok(nodeId, selector);
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    report.fonts.push({ url: page.url(), selector, fonts });
    assert.ok(fonts.length > 0, 'CDP must report rendered glyphs');
    const expectedFonts = fonts.filter(f => f.isCustomFont && f.familyName.includes(expected));
    const fallbackFonts = fonts.filter(f => !expectedFonts.includes(f));
    assert.ok(expectedFonts.length, JSON.stringify(fonts));
    const arrowCount = allowNavigationArrow ? (await page.locator(selector).first().innerText()).match(/[→↗]/g)?.length || 0 : 0;
    assert.ok(fallbackFonts.reduce((sum, f) => sum + f.glyphCount, 0) <= arrowCount, JSON.stringify(fonts));
    return fonts;
  } finally { await cdp.detach(); }
}
async function shot(page, name) {
  const file = `${directory}/screenshots/${name}.png`;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); report.screens.push(file);
  const viewportFile = `${directory}/screenshots/${name}-viewport.png`;
  await page.screenshot({ path: viewportFile, animations: 'disabled' }); report.screens.push(viewportFile);
}
async function layout(page, label, enforce) {
  const measurement = await page.evaluate(() => {
    const root = document.documentElement;
    const text = [...document.querySelectorAll('h1,h2,p,button,label,.eyebrow,.paths-header span,.text-label-caps')].filter(el => el.getClientRects().length && el.textContent.trim()).map(el => {
      const s = getComputedStyle(el); return { text: el.textContent.trim().slice(0, 100), size: s.fontSize, lineHeight: s.lineHeight, weight: s.fontWeight, family: s.fontFamily };
    });
    return { width: innerWidth, scrollWidth: root.scrollWidth, text };
  });
  const actions = [];
  for (const el of await page.locator('button,a,input,textarea,select,summary').all()) {
    if (!await el.isVisible()) continue;
    await el.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    actions.push(await el.evaluate(el => {
      const r = el.getBoundingClientRect(), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
      const top = document.elementFromPoint(x, y);
      return { text: (el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 90), x: r.x, width: r.width, height: r.height, reachable: top === el || el.contains(top), clipped: r.left < -1 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2 };
    }));
  }
  report.layouts.push({ label, ...measurement, actions });
  if (enforce) {
    assert.ok(measurement.scrollWidth <= measurement.width, `${label}: horizontal overflow`);
    assert.deepEqual(actions.filter(x => !x.reachable || x.clipped), [], `${label}: covered or clipped actions`);
    assert.ok(measurement.text.every(x => Number.parseFloat(x.size) >= 12), `${label}: tiny text`);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}
async function check(name, fn) {
  const start = Date.now();
  try { await fn(); report.checks.push({ name, result: 'PASS', ms: Date.now() - start }); console.log('PASS ' + name); }
  catch (e) { report.checks.push({ name, result: 'FAIL', error: e.stack }); throw e; }
}
const routes = [['picker', '/today'], ['french-unit', '/series/fr/intro'], ['original-german', '/play/de/m1'], ['backup', '/backup-safe']];
try {
  await check('unmodified real variable font axes and distinct normal/italic binaries', async () => {
    report.binaries = [];
    for (const file of ['Nunito-wght-8c6a9bb9.ttf', 'Nunito-Italic-wght-8c6a9bb9.ttf']) {
      const bytes = await readFile(`static/fonts/${file}`);
      let offset;
      for (let i = 0; i < bytes.readUInt16BE(4); i++) { const p = 12 + 16 * i; if (bytes.toString('ascii', p, p + 4) === 'fvar') offset = bytes.readUInt32BE(p + 8); }
      assert.ok(offset, 'Actual variable fvar table required');
      const axis = offset + bytes.readUInt16BE(offset + 4);
      assert.equal(bytes.toString('ascii', axis, axis + 4), 'wght');
      const min = bytes.readInt32BE(axis + 4) / 65536, max = bytes.readInt32BE(axis + 12) / 65536;
      assert.equal(min, 200); assert.equal(max, 1000);
      report.binaries.push({ file, min, max, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  });
  for (const [version, root] of [['before', aRoot], ['after', bRoot]]) {
    current = root;
    for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      await check(`${version} ${size}: four real screens, text and reachable actions`, async () => {
        const context = await contextFor(viewport);
        try {
          const page = await context.newPage();
          for (const [name, route] of routes) {
            await page.goto(base + route, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            await layout(page, `${version}-${size}-${name}`, version === 'after');
            await shot(page, `${version}-${size}-${name}`);
            if (version === 'after') {
              const target = name === 'original-german' ? 'input[placeholder="Type it in the language"]' : 'h1';
              // Inputs have no child text for CDP; inspect the original prompt itself.
              await fontsFor(page, name === 'original-german' ? 'h2.font-headline-lg-mobile' : target);
              if (name === 'picker') for (const selector of ['.lead', '.language-card', '.paths-header span', '#offline-retry']) await fontsFor(page, selector, 'Nunito', selector === '.language-card');
              if (name === 'backup') await fontsFor(page, '#export');
              if (name === 'original-german') {
                await fontsFor(page, '.material-symbols-outlined', 'Material Symbols Outlined');
                await fontsFor(page, '.legacy-return', 'Nunito', true);
              }
            }
          }
        } finally { await context.close(); }
      });
    }
  }
  current = bRoot;
  await check('floating original notice renders in bundled Nunito', async () => {
    const context = await contextFor({ width: 390, height: 844 });
    try {
      const page = await context.newPage(); await page.goto(base + '/play/de/m1', { waitUntil: 'networkidle' });
      await page.evaluate(() => { const u = new SpeechSynthesisUtterance('Synthetic notice only'); u.lang = 'ar'; speechSynthesis.speak(u); });
      await page.getByText('No verified Tunisian audio is included.', { exact: true }).waitFor();
      await fontsFor(page, '.legacy-notice');
      await shot(page, 'after-mobile-legacy-notice');
    } finally { await context.close(); }
  });
  await check('FontFaceSet, CDP accented glyphs and actual weight/italic raster variation', async () => {
    const context = await contextFor({ width: 1280, height: 900 });
    try {
      const page = await context.newPage(); await page.goto(base + '/today'); await ready(page);
      const sample = 'Deutsch: Grüße, heißen, schön. Français: élève, cœur, où. Italiano: città, perché. Português: ação, avó, maçã. Āăą Čč Ďď Ęę Łł Œœ Şş Źź ẞ';
      report.faceSet = await page.evaluate(async sample => {
        const result = [];
        for (const style of ['normal', 'italic']) for (const weight of [400, 500, 600, 700, 800, 900]) {
          const query = `${style} ${weight} 24px Nunito`;
          const loaded = await document.fonts.load(query, sample);
          result.push({ style, weight, check: document.fonts.check(query, sample), loaded: loaded.map(f => ({ family: f.family, style: f.style, weight: f.weight, status: f.status })) });
        }
        return result;
      }, sample);
      assert.ok(report.faceSet.every(x => x.check && x.loaded.some(f => f.family === 'Nunito' && f.status === 'loaded' && f.weight === '200 1000')));
      await page.evaluate(sample => {
        const probe = document.createElement('div'); probe.id = 'typography-probe'; probe.style.cssText = 'position:absolute;top:0;left:0;background:#10131a;width:800px;z-index:999;';
        for (const style of ['normal', 'italic']) for (const weight of [400, 500, 600, 700, 800, 900]) {
          const p = document.createElement('p'); p.id = `probe-${style}-${weight}`; p.textContent = sample; p.style.cssText = `font: ${style} ${weight} 24px/1.5 Nunito;`; probe.append(p);
        }
        document.body.append(probe);
      }, sample);
      report.rasters = [];
      for (const style of ['normal', 'italic']) for (const weight of [400, 500, 600, 700, 800, 900]) {
        const selector = `#probe-${style}-${weight}`;
        await fontsFor(page, selector);
        const png = await page.locator(selector).screenshot();
        report.rasters.push({ style, weight, sha256: createHash('sha256').update(png).digest('hex') });
      }
      assert.equal(new Set(report.rasters.map(x => x.sha256)).size, 12, 'Every requested real weight and italic must render differently');
      await shot(page, 'after-accent-weight-probes');
    } finally { await context.close(); }
  });
  await check('first B load under actual A controller and stale stable font CSS, then offline B', async () => {
    current = aRoot;
    const context = await contextFor({ width: 390, height: 844 });
    try {
      const pageA = await context.newPage(); await pageA.goto(base + '/today'); await ready(pageA);
      assert.equal((await workerStatus(pageA)).version, 'sprechen-core-' + a.version);
      const oldCSS = await pageA.evaluate(async () => (await fetch('/sprechen/fonts/fonts.css')).text());
      current = bRoot; holdWorker = true;
      const pageB = await context.newPage();
      const fontCSSResponses = [];
      pageB.on('response', response => { if (response.url().endsWith('/fonts/fonts.css')) fontCSSResponses.push({ fromServiceWorker: response.fromServiceWorker(), status: response.status() }); });
      await pageB.goto(base + '/backup-safe', { waitUntil: 'domcontentloaded' });
      await pageB.getByRole('heading', { name: 'Safe backup & restore' }).waitFor();
      await pageB.locator('#backup-json').fill('unfinished synthetic typography input');
      assert.equal(await pageB.locator('#root').getAttribute('data-build'), b.version);
      assert.equal((await workerStatus(pageB)).version, 'sprechen-core-' + a.version, 'Actual A still active at proof time');
      assert.equal(await pageB.evaluate(async () => (await fetch('/sprechen/fonts/fonts.css')).text()), oldCSS);
      assert.ok(!oldCSS.includes('Nunito'), 'Old stable declaration sheet has no Nunito');
      assert.ok(fontCSSResponses.length && fontCSSResponses.every(r => r.fromServiceWorker && r.status === 200), 'Actual cached stable font CSS response required');
      await fontsFor(pageB, 'h1');
      await shot(pageB, 'upgrade-first-b-under-a');
      report.upgrade = { firstBController: (await workerStatus(pageB)).version, staleFontsCSS: true, fontCSSResponses, loadedBuild: await pageB.locator('#root').getAttribute('data-build') };
      holdWorker = false; releaseWorkers.splice(0).forEach(resolve => resolve());
      await ready(pageB);
      assert.equal((await workerStatus(pageB)).version, 'sprechen-core-' + b.version);
      assert.equal(await pageB.locator('#backup-json').inputValue(), 'unfinished synthetic typography input');
      assert.equal(await pageA.locator('#root').getAttribute('data-build'), a.version, 'Open A kept its loaded build');
      const beforeStorage = await pageB.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
      await context.setOffline(true);
      for (const [name, route] of routes) {
        await pageB.goto(base + route, { waitUntil: 'networkidle' });
        await fontsFor(pageB, name === 'original-german' ? 'h2.font-headline-lg-mobile' : 'h1');
        await layout(pageB, `offline-mobile-${name}`, true);
        await shot(pageB, `offline-mobile-${name}`);
      }
      assert.equal(await pageB.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))), beforeStorage);
      report.upgrade.finalController = (await workerStatus(pageB)).version;
      report.upgrade.offlineFourRoutes = true;
    } finally { holdWorker = false; releaseWorkers.splice(0).forEach(resolve => resolve()); await context.close(); }
  });
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(`${directory}/typography-results.json`, JSON.stringify(report, null, 2));
  await browser.close(); server.close();
}

