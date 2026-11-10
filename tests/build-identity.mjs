import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function manifest(directory = 'dist') {
  const entries = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = directory + '/' + entry.name;
    if (entry.isDirectory()) entries.push(...await manifest(file));
    else entries.push([file, digest(await readFile(file))]);
  } return entries;
}
const builds = [];
for (let i = 0; i < 2; i++) {
  process.stdout.write(execFileSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' }));
  builds.push(await manifest());
}
assert.deepEqual(builds[0], builds[1], 'all output bytes must reproduce');
const info = JSON.parse(await readFile('dist/build-info.json', 'utf8'));
const hash = bytes => digest(bytes).slice(0, 16);
assert.equal(hash(JSON.stringify(info.identityResourceHashes) + await readFile('src/sw.js', 'utf8')), info.version);
const slot = '__SPRECHEN_BUILD_ID__';
const js = await readFile('dist/' + info.bootstrap, 'utf8');
assert.ok(js.includes(info.version)); assert.ok(!js.includes(slot));
assert.equal(info.bootstrap, 'assets/paths-' + hash(js) + '.js');
const templateJS = js.replaceAll(info.version, slot), templateBootstrap = `assets/paths-${hash(templateJS)}.js`;
for (const [file, expected] of info.identityResourceHashes) {
  const bytes = file === templateBootstrap ? templateJS : /^(index|404)\.html$/.test(file) ? (await readFile('dist/' + file, 'utf8')).replaceAll(info.bootstrap, templateBootstrap) : await readFile('dist/' + file);
  assert.equal(hash(bytes), expected, 'identity template ' + file);
}
for (const [file, expected] of info.resourceHashes) assert.equal(hash(await readFile('dist/' + file)), expected, 'emitted resource ' + file);
const worker = await readFile('dist/sw.js', 'utf8');
assert.ok(worker.includes('sprechen-core-' + info.version));
assert.equal(info.coreResources, info.resourceHashes.length);
assert.ok(info.resourceHashes.every(([file]) => !/^https?:/.test(file)));
await writeFile('.saikan/execution/offline-language-paths/fix-cycle-1/reproducible-builds.json', JSON.stringify({ version: info.version, outputFiles: builds[0].length, coreResources: info.coreResources, builds, identityVerified: true }, null, 2));
console.log(`PASS two byte-identical builds: ${info.version}; ${builds[0].length} files; app/worker identity and every build-info hash verified`);
