import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { extract, hash } from './course.mjs';
import path from 'node:path';

const root = path.resolve('dist');
if (root !== path.join(process.cwd(), 'dist')) throw Error('Unexpected output directory');
await rm(root, { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
for (const dir of ['assets', 'audio', 'corpus', 'img', 'video']) await cp(dir, `dist/${dir}`, { recursive: true });
await cp('static/fonts', 'dist/fonts', { recursive: true });
for (const file of ['favicon.svg', 'icons.svg', 'icon-192.png', 'apple-touch-icon.png', '.nojekyll']) await cp(file, `dist/${file}`);
const { original, course, patched, source, node, replacement } = extract();
const legacy = `assets/legacy-${hash(patched)}.js`;
await writeFile(`dist/${legacy}`, patched);
await writeFile('dist/course.json', JSON.stringify(course));
const css = await readFile('src/style.css', 'utf8');
const cssName = `assets/paths-${hash(css)}.css`;
await writeFile(`dist/${cssName}`, css);
// Hash a template build with a fixed identity slot, then fill it once. This avoids
// a self-referential app-content-hash / worker-version loop.
const identitySlot = '__SPRECHEN_BUILD_ID__';
const result = await build({ entryPoints: ['src/app.ts'], bundle: true, format: 'esm', target: 'es2022', write: false, external: ['/sprechen/*'], define: { LEGACY_MODULE: JSON.stringify('/sprechen/' + legacy), EXPECTED_BUILD: JSON.stringify(identitySlot) } });
const js = result.outputFiles[0].text, bootstrap = `assets/paths-${hash(js)}.js`;
await writeFile(`dist/${bootstrap}`, js);
const baseline = await readFile('index.html', 'utf8');
const html = baseline.replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link href="https:\/\/fonts[^>]*>\s*/g, '')
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, `<script type="module" src="/sprechen/${bootstrap}"></script>`)
  .replace('</head>', `  <link rel="stylesheet" href="/sprechen/fonts/fonts.css">\n<link rel="stylesheet" href="/sprechen/${cssName}">\n<link rel="icon" href="/sprechen/favicon.svg" type="image/svg+xml">\n<link rel="manifest" href="/sprechen/manifest.json">\n</head>`);
await writeFile('dist/index.html', html);
await writeFile('dist/404.html', html);
await writeFile('dist/manifest.json', JSON.stringify({ name: 'Sprechen', short_name: 'Sprechen', start_url: '/sprechen/today', scope: '/sprechen/', display: 'standalone', background_color: '#10131a', theme_color: '#10131a', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] }));
async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await files(file)); else out.push(file.replace(/^dist\//, ''));
  }
  return out;
}
// Local course/shell plus existing local resources; never fetch/cache provider URLs.
let resources = (await files('dist')).filter(f => !f.startsWith('assets/') || [legacy, bootstrap, cssName, 'assets/index-CuFachSo.css'].includes(f));
const workerTemplate = await readFile('src/sw.js', 'utf8');
const resourceHashes = await Promise.all(resources.map(async f => [f, hash(await readFile(`dist/${f}`))]));
const version = hash(JSON.stringify(resourceHashes) + workerTemplate);
const finalJS = js.replaceAll(identitySlot, version), finalBootstrap = `assets/paths-${hash(finalJS)}.js`;
if (finalBootstrap !== bootstrap) {
  await writeFile(`dist/${finalBootstrap}`, finalJS);
  await rm(`dist/${bootstrap}`);
  await writeFile('dist/index.html', html.replaceAll(bootstrap, finalBootstrap));
  await writeFile('dist/404.html', html.replaceAll(bootstrap, finalBootstrap));
  resources = resources.map(f => f === bootstrap ? finalBootstrap : f);
}
const finalResourceHashes = await Promise.all(resources.map(async f => [f, hash(await readFile(`dist/${f}`))]));
const sw = workerTemplate.replace('__CACHE_VERSION__', version).replace('__RESOURCES__', JSON.stringify(resources.map(f => '/sprechen/' + f)));
await writeFile('dist/sw.js', sw);
await writeFile('dist/build-info.json', JSON.stringify({ version, legacy, bootstrap: finalBootstrap, identityAlgorithm: 'sha256-16 of ordered template resource hashes plus worker template; fixed app identity slot filled once', identityResourceHashes: resourceHashes, resourceHashes: finalResourceHashes, sourceHash: hash(source), dataStart: node.start, oldDataEnd: node.end, newDataEnd: node.start + replacement.length, sourceItems: original.tracks.map(t => ({ id: t.id, lessons: t.sections.flatMap(s => s.units.flatMap(u => u.lessons)).length })), semanticCorrections: ['de::a1::2: restore shifted Richtung Kreuzberg record'], coreResources: resources.length }, null, 2));
console.log(`Built dist for /sprechen/: ${version}; ${resources.length} offline resources; original executable prefix/suffix verified.`);
