// One-time, explicit maintenance task. Production build never downloads resources.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const target = 'static/fonts';
await mkdir(target, { recursive: true });
// Explicit Nunito maintenance only; never run as part of build. Preserve legacy fonts.
if (process.argv.includes('--nunito')) {
  const commit = '8c6a9bb9732545b9ed53f29ec5e1ab0ff53c4e6f';
  const upstream = `https://raw.githubusercontent.com/googlefonts/nunito/${commit}`;
  const records = [];
  for (const [local, source] of [
    ['Nunito-wght-8c6a9bb9.ttf', 'fonts/variable/Nunito[wght].ttf'],
    ['Nunito-Italic-wght-8c6a9bb9.ttf', 'fonts/variable/Nunito-Italic[wght].ttf'],
    ['OFL-Nunito.txt', 'OFL.txt']
  ]) {
    const url = `${upstream}/${source}`;
    const response = await fetch(url);
    if (!response.ok) throw Error(`Nunito download failed: ${response.status} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(`${target}/${local}`, bytes);
    records.push({ file: local, url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const marker = '\n## Nunito\n';
  const existing = (await readFile(`${target}/SOURCES.md`, 'utf8')).split(marker)[0];
  await writeFile(`${target}/SOURCES.md`, existing + marker + `\nUnmodified upstream variable normal and italic, wght 200–1000; Latin and Latin-ext coverage.\nCopyright 2014 The Nunito Project Authors. SIL Open Font License 1.1 (OFL-Nunito.txt).\nSource commit: ${commit}. Downloaded 2026-11-10. No runtime font network dependency.\nDeclarations live in the content-hashed maintained stylesheet so an older worker's stable fonts.css cannot hide them.\nMaintenance: node scripts/vendor-fonts.mjs --nunito\n\n` + records.map(r => `- ${r.file}: ${r.url} (${r.bytes} bytes); SHA-256 ${r.sha256}`).join('\n') + '\n');
  console.log(JSON.stringify(records, null, 2));
  process.exit(0);
}
const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const queries = [
  ['symbols', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@400&display=swap'],
  ['jakarta', 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap']
];
let css = '', credits = '# Bundled fonts\n\nDownloaded from official Google Fonts CSS, 2026-11-10. Build is network-independent.\n\n';
for (const [name, url] of queries) {
  const response = await fetch(url, { headers: { 'User-Agent': agent } });
  if (!response.ok) throw Error(`Font CSS failed: ${response.status}`);
  let sheet = await response.text(), n = 0;
  for (const font of new Set([...sheet.matchAll(/url\((https:[^)]+)\)/g)].map(x => x[1]))) {
    const res = await fetch(font); if (!res.ok) throw Error('Font download failed');
    const filename = `${name}-${n++}.${font.endsWith('.woff2') ? 'woff2' : 'ttf'}`;
    const bytes = new Uint8Array(await res.arrayBuffer()); await writeFile(`${target}/${filename}`, bytes);
    sheet = sheet.replaceAll(font, `/sprechen/fonts/${filename}`);
    credits += `- ${filename}: ${font} (${bytes.length} bytes)\n`;
  }
  css += sheet + '\n';
}
for (const [file, url] of [
  ['LICENSE-Material-Symbols.txt', 'https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE'],
  ['OFL-Plus-Jakarta-Sans.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/OFL.txt']
]) {
  const res = await fetch(url); if (!res.ok) throw Error(`License download failed: ${url}`); await writeFile(`${target}/${file}`, await res.text());
}
await writeFile(`${target}/fonts.css`, css);
await writeFile(`${target}/SOURCES.md`, credits);
console.log('Vendored local font files and official licenses.');
