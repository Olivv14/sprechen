import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

test('F1 one classifier covers basename, one-pass encoding, static case and terminal slashes without folding identities', () => {
  const app = readFileSync('src/app.ts', 'utf8');
  const definitions = app.slice(app.indexOf('function routePath('), app.indexOf('\nfunction notice('));
  const { routePath, owned } = new Function('const BASE="/sprechen";' + transformSync(definitions, { loader: 'ts' }).code + ';return {routePath,owned};')();
  for (const input of ['/sprechen/BACKUP', '/SPRECHEN/bAcKuP///', '/sprechen/%62ack%75p//']) { assert.equal(routePath(input), '/backup'); assert.equal(owned(routePath(input)), true); }
  for (const input of ['/sprechen/PLAY/flirt/rp1///', '/SpReChEn/pLaY/%66lirt/%72p1']) { assert.equal(routePath(input), '/play/flirt/rp1'); assert.equal(owned(routePath(input)), true); }
  for (const input of ['/sprechen/backup%2F', '/sprechen/%2562ackup', '/sprechen//backup']) assert.equal(owned(routePath(input)), false, input);
  for (const input of ['/sprech%65n/backup', '/sprechen%2Fbackup', '/sprechen-other/backup']) assert.equal(routePath(input), null);
  assert.equal(routePath('/sprechen/PLAY/de/MiXeD'), '/play/de/MiXeD');
  assert.equal(owned(routePath('/sprechen/PLAY/de/m1')), false);
  assert.equal(owned(routePath('/sprechen/play/fr/fh1')), false);
});
