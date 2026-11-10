import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';

const directory = '.saikan/execution/offline-language-paths/fix-cycle-1';
const label = process.env.EVIDENCE_LABEL || 'offline-final';
const only = process.argv[2] || '';
await mkdir(`${directory}/screenshots`, { recursive: true });
const aRoot = path.resolve(directory, 'build-a'), bRoot = path.resolve('dist');
const a = JSON.parse(await readFile(path.join(aRoot, 'build-info.json'), 'utf8'));
const b = JSON.parse(await readFile(path.join(bRoot, 'build-info.json'), 'utf8'));
assert.notEqual(a.version, b.version, 'A and B must be distinct actual build outputs');
let current = aRoot, failure = false, hold = false, release, requests = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push({ url: url.pathname, build: current === aRoot ? a.version : b.version, worker: req.headers['service-worker'] });
  const relative = url.pathname.replace(/^\/sprechen\//i, '');
  let file = path.resolve(current, relative || 'index.html');
  if (!file.startsWith(current + path.sep)) { res.writeHead(403); res.end(); return; }
  if (current === bRoot && relative === 'course.json') {
    if (hold) await new Promise(resolve => { release = resolve; });
    if (failure) { res.writeHead(503); res.end('Synthetic candidate resource failure'); return; }
  }
  try {
    try { if (!(await stat(file)).isFile()) throw Error(); }
    catch { if (req.headers.accept?.includes('text/html') && !path.extname(relative)) file = path.join(current, 'index.html'); else { res.writeHead(404); res.end(); return; } }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/sprechen/' }); res.end(await readFile(file));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, base = origin + '/sprechen';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const report = { origin, browser: browser.version(), a: a.version, b: b.version, checks: [], screenshots: [], transitions: [], requests, errors: [] };
async function shot(page, name) { const file = `${directory}/screenshots/${label}-${name}.png`; await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); }
async function status(page) {
  return page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return new Promise(resolve => { const c = new MessageChannel(); c.port1.onmessage = e => resolve(e.data); r.active.postMessage('STATUS', [c.port2]); });
  });
}
async function waitText(page, pattern, timeout = 20000) {
  await page.waitForFunction(pattern => new RegExp(pattern, 'i').test(document.getElementById('offline-status')?.textContent || ''), pattern, { timeout });
}
async function check(name, fn) {
  if (only && !name.startsWith(only)) return;
  current = aRoot; failure = hold = false; requests.length = 0;
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  try { await fn(context, page); report.checks.push({ name, result: 'PASS', requests: [...requests] }); console.log('PASS ' + name); }
  catch (e) {
    const diagnostics = [];
    for (const w of context.serviceWorkers()) diagnostics.push(await w.evaluate(() => ({ workerCache: CACHE, ready: self.registration.active?.state, waiting: self.registration.waiting?.state })).catch(e => ({ workerError: e.message })));
    for (const [i, p] of context.pages().entries()) {
      await shot(p, 'failure-' + name.slice(0, 2) + '-' + i).catch(() => {});
      diagnostics.push(await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { url: location.href, text: document.getElementById('offline-status')?.textContent, build: document.getElementById('root')?.dataset.build, active: r?.active?.state, waiting: r?.waiting?.state, installing: r?.installing?.state, transitions: window.__transitions }; }).catch(() => ({})));
      diagnostics.push(await status(p).catch(e => ({ statusError: e.message })));
    }
    report.checks.push({ name, result: 'FAIL', error: e.stack, diagnostics }); console.error(e, diagnostics); process.exitCode = 1;
  }
  finally { release?.(); release = undefined; await context.close(); }
}
async function prepareA(page) {
  await page.goto(base + '/today'); await waitText(page, 'Offline ready');
  assert.equal((await status(page)).version, 'sprechen-core-' + a.version);
  await page.evaluate(async () => {
    await (await caches.open('unrelated-cache')).put('/unrelated', new Response('retain'));
    window.__transitions = [];
    const registration = await navigator.serviceWorker.getRegistration();
    registration.addEventListener('updatefound', () => { const worker = registration.installing; window.__transitions.push(worker.state); worker.addEventListener('statechange', () => window.__transitions.push(worker.state)); });
  });
}
try {
  await check('F1 direct mixed-case basename canonicalizes before legacy mount', async (context, page) => {
    current = bRoot; await page.goto(origin + '/SpReChEn/%62AcKuP///?v=MiXeD#Keep');
    await page.getByRole('heading', { name: 'Safe backup & restore', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/sprechen/backup'); assert.equal(new URL(page.url()).search, '?v=MiXeD'); assert.equal(new URL(page.url()).hash, '#Keep');
  });
  await check('F4 failed real B install cannot borrow A readiness; retry succeeds and preserves input/open A', async (context, pageA) => {
    await prepareA(pageA);
    const pageB = await context.newPage(); pageB.setDefaultTimeout(6000);
    current = bRoot; failure = hold = true;
    await pageB.goto(base + '/backup-safe');
    await pageB.locator('#backup-json').fill('unfinished synthetic input');
    await pageB.waitForFunction(version => document.getElementById('root')?.dataset.build === version, b.version);
    await pageA.waitForFunction(() => window.__transitions.includes('installing'));
    assert.ok(!/Offline ready/i.test(await pageB.locator('#offline-status').innerText()), 'B cannot announce ready while A is active and B installing');
    hold = false; release?.(); release = undefined;
    await pageA.waitForFunction(() => window.__transitions.includes('redundant'));
    await waitText(pageB, 'previous version.*(failed|incomplete)|failed.*previous version');
    assert.equal((await status(pageB)).version, 'sprechen-core-' + a.version);
    assert.ok(await pageB.evaluate(async name => (await caches.keys()).includes(name), 'sprechen-core-' + a.version));
    assert.equal(await pageB.locator('#backup-json').inputValue(), 'unfinished synthetic input');
    await shot(pageB, 'b-install-failed');
    failure = false;
    await pageB.locator('#offline-retry').click(); await waitText(pageB, 'Offline ready');
    assert.equal((await status(pageB)).version, 'sprechen-core-' + b.version);
    assert.equal(await pageB.locator('#backup-json').inputValue(), 'unfinished synthetic input');
    report.transitions.push(...await pageA.evaluate(() => window.__transitions));
    assert.equal(await pageA.evaluate(() => document.getElementById('root')?.dataset.build), undefined); // A is the pre-cycle actual output.
    await context.setOffline(true);
    const oldResource = await pageA.evaluate(async url => { const r = await fetch(url); return { status: r.status, type: r.headers.get('content-type') }; }, base + '/' + a.bootstrap);
    assert.equal(oldResource.status, 200); assert.match(oldResource.type, /javascript/);
    assert.ok(await pageB.evaluate(async () => (await caches.keys()).includes('unrelated-cache')));
    await shot(pageB, 'b-retry-ready');
    await context.setOffline(false); await pageB.close();
  });
  await check('F4 same-origin real A to B successful candidate install retains working A cache', async (context, pageA) => {
    await prepareA(pageA); current = bRoot;
    const pageB = await context.newPage(); await pageB.goto(base + '/backup-safe');
    await waitText(pageB, 'Offline ready'); assert.equal((await status(pageB)).version, 'sprechen-core-' + b.version);
    assert.equal(await pageB.locator('#root').getAttribute('data-build'), b.version);
    assert.ok(await pageB.evaluate(async name => (await caches.keys()).includes(name), 'sprechen-core-' + a.version));
    report.transitions.push(...await pageA.evaluate(() => window.__transitions));
    await shot(pageB, 'a-to-b-ready'); await pageB.close();
  });
  await check('F5 actual core deletion invalidates STATUS/UI; offline action explains; retry repairs core', async (context, page) => {
    current = bRoot; await page.goto(base + '/backup-safe'); await waitText(page, 'Offline ready');
    for (const resource of ['/sprechen/course.json', '/sprechen/' + b.bootstrap, '/sprechen/video/ubahn.mp4']) {
      assert.ok(await page.evaluate(async ({ version, resource }) => (await caches.open('sprechen-core-' + version)).delete(resource), { version: b.version, resource }));
      const result = await status(page); assert.equal(result.ready, false, resource);
      await waitText(page, 'incomplete');
      await page.locator('#offline-retry').click(); await waitText(page, 'Offline ready');
      assert.equal((await status(page)).ready, true);
    }
    await page.evaluate(async version => { await (await caches.open('sprechen-core-' + version)).delete('/sprechen/course.json'); }, b.version);
    await context.setOffline(true);
    await page.evaluate(() => dispatchEvent(new Event('offline'))); await waitText(page, 'incomplete');
    await shot(page, 'missing-core');
    // Missing resources return explicit errors, never the shell (including direct navigation).
    const misses = await page.evaluate(async () => {
      const out = [];
      for (const url of ['/sprechen/course.json', '/sprechen/assets/missing.js', '/sprechen/audio/missing.mp3']) {
        const r = await fetch(url); out.push({ status: r.status, type: r.headers.get('content-type'), body: await r.text() });
      } return out;
    });
    for (const miss of misses) { assert.equal(miss.status, 503); assert.doesNotMatch(miss.type || '', /html/i); assert.doesNotMatch(miss.body, /<!doctype/i); }
    const resourceTab = await context.newPage();
    const resourceNavigation = await resourceTab.goto(base + '/audio/missing.mp3');
    assert.equal(resourceNavigation.status(), 503); assert.doesNotMatch(resourceNavigation.headers()['content-type'], /html/i);
    await resourceTab.close();
    await page.goto(base + '/practice/pt'); await page.getByRole('heading', { name: 'Unable to open this path', exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /course unavailable|offline.*incomplete|prepare offline/i);
    await context.setOffline(false); await page.locator('#offline-retry').click(); await waitText(page, 'Offline ready');
    await page.goto(base + '/practice/pt'); await page.locator('#answer').fill('Um vinho tinto para começar?'); await page.locator('#check').click();
    assert.match(await page.locator('#result').innerText(), /Matched/); await shot(page, 'core-repaired');
  });
  assert.deepEqual(report.errors, [], 'no browser page errors');
} finally {
  await writeFile(`${directory}/${label}-results.json`, JSON.stringify(report, null, 2));
  await browser.close(); server.close();
}
