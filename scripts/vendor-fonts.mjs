// One-time, explicit maintenance task. Production build never downloads resources.
import { mkdir, writeFile } from 'node:fs/promises';
const target = 'static/fonts';
await mkdir(target, { recursive: true });
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
