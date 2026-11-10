import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-expect-error deterministic JS build helper
import { extract, literal } from '../scripts/course.mjs';
import { rows, forLanguage, normalize, pilot, type Course } from '../src/course.ts';
import { exactPortugalVoice } from '../src/voice.ts';
test('literal extractor rejects execution; exactly one semantic delta, same ids/order and identical executable bytes', () => {
  const { original, course, source, patched, node, replacement } = extract();
  assert.throws(() => literal({ type: 'CallExpression' }));
  assert.equal(source, readFileSync('assets/index-BzuZHiF7.js', 'utf8'));
  assert.equal(patched.slice(0, node.start), source.slice(0, node.start)); assert.equal(patched.slice(node.start + replacement.length), source.slice(node.end));
  const before = rows(original), after = rows(course); assert.deepEqual(before.map(x => x.key), after.map(x => x.key));
  const changed = after.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before[i]));
  assert.equal(changed.length, 1); assert.equal(changed[0].key, 'de::a1::2');
  assert.deepEqual(changed[0].item, { hear: null, say: 'Richtung Kreuzberg.', en: 'Direction Kreuzberg.', es: 'Dirección Kreuzberg.', ph: 'RIKH-toong KROYTS-berg', why: 'eu = oy.', lang: 'de' });
});
test('scoped samplers preserve original review identities, French unit uses a new stable lesson id', () => {
  const all = rows(extract().course as Course); assert.equal(all.length, 720);
  assert.equal(forLanguage(all, 'pt').length, 5); assert.equal(forLanguage(all, 'it').length, 11);
  assert.ok(forLanguage(all, 'pt').every(r => r.item.lang === 'pt' && r.key.startsWith('flirt::')));
  assert.equal(new Set([...all, ...pilot].map(r => r.key)).size, all.length + pilot.length);
  assert.equal(normalize('S’il vous plaît !'), normalize('Sil vous plait'));
});
test('Portuguese voice selection never chooses pt-BR, pt or generic default', () => {
  assert.equal(exactPortugalVoice([{ lang: 'pt-BR' }, { lang: 'pt' }, { lang: 'en-US' }]), undefined);
  assert.equal(exactPortugalVoice([{ lang: 'pt-BR' }, { lang: 'pt-PT' }])?.lang, 'pt-PT');
});
