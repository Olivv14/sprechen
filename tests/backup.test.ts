import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAVE, LEGACY, RECOVERY, JOURNAL, defaults, parseBackup, exportBackup, readDoc, prepareImport, commitImport, recoveryPlan, undoImport, type Doc, type StorageLike } from '../src/backup.ts';

class Store implements StorageLike {
  data = new Map<string, string>(); writes = 0; failKey = '';
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (k === this.failKey) throw Error('Synthetic quota failure'); this.writes++; this.data.set(k, v); }
  removeItem(k: string) { this.writes++; this.data.delete(k); }
}
const original = (): Doc => ({ ...defaults(), name: 'Synthetic Ada', didSetup: true, xp: 120, streak: 4, sit: { 'de.m1': { stars: 3, note: 'retained' } }, hash: 'a'.repeat(64), customMetadata: { accounts: [{ id: 'synthetic', preference: 'dark' }] }, mastery: { 'de::m1::0': { active: 2, passive: 3 } }, hlr: { 'de::m1::0': { conceptId: 'de::m1::0', halfLifeHours: 24, totalReviews: 2, consecutiveCorrect: 1, lastReviewDate: '2026-01-01T00:00:00.000Z', nextReviewDate: '2026-01-02T00:00:00.000Z' } } });
function populated() {
  const storage = new Store(); storage.setItem(SAVE, JSON.stringify(original()));
  for (const key of LEGACY) storage.setItem(key, JSON.stringify({ name: 'old', ui: 'es', theme: 'jade', accounts: [{ id: 'fake-account' }], sit: { 'de.old': { stars: 2 } }, seen: { 'de.ancient': 1 }, xp: 9999, streak: 98, privateMetadata: { keep: true } }));
  storage.setItem('unrelated', 'untouched'); storage.writes = 0; return storage;
}
const copy = (s: Store) => [...s.data.entries()];
test('accepts current versioned envelope and exact legacy raw, preserving unknown metadata and item keys', () => {
  const raw = { ...original(), version: 'legacy-user-metadata', data: { preserve: true } }; assert.deepEqual(parseBackup(JSON.stringify(raw)), raw); assert.deepEqual(parseBackup(exportBackup(raw)), raw);
});
test('rejects malformed, foreign, unsupported versions, null/array and dangerous keys with zero storage writes', () => {
  const invalid = ['{', 'null', '[]', '{"hello":"world"}', JSON.stringify({ format: 'other', version: 1, data: original() }), JSON.stringify({ format: 'sprechen-backup', version: 2, data: original() }), JSON.stringify(original()).replace('"name":', '"__proto__":{"polluted":true},"name":'), JSON.stringify(original()).replace('"note":', '"constructor":{},"note":')];
  for (const text of invalid) { const storage = populated(), before = copy(storage); assert.throws(() => prepareImport(text, storage)); assert.deepEqual(copy(storage), before); assert.equal(storage.writes, 0); }
});
test('invalid maps, fields and numbers rejected', () => {
  for (const patch of [{ sit: [] }, { hlr: [] }, { mastery: { bad: 1 } }, { srs: null }, { days: { date: 3 } }, { eggs: [] }, { xp: -1 }, { xp: '12' }, { goal: -3 }, { streak: null }, { didSetup: 'yes' }, { hash: 'bad' }, { sit: { 'de.m1': { stars: 5 } } }, { sit: { 'de.m1': { stars: '3' } } }, { mastery: { key: { active: -1, passive: 0 } } }, { hlr: { id: { conceptId: 'different' } } }, { localPaths: { version: 10, reviews: {}, units: {} } }]) {
    const storage = populated(); assert.throws(() => prepareImport(JSON.stringify({ ...original(), ...patch }), storage), JSON.stringify(patch)); assert.equal(storage.writes, 0);
  }
  assert.throws(() => parseBackup(JSON.stringify(original()).replace('"xp":120', '"xp":1e999')));
});
test('preview, export and cancel do not modify even recovery keys; explicit commit archives stale migration progress', () => {
  const storage = populated(), before = copy(storage), incoming = { ...defaults(), name: 'Incoming', didSetup: true, note: { keep: true } };
  storage.setItem(RECOVERY, 'previous recovery'); storage.writes = 0; const unchanged = copy(storage);
  const plan = prepareImport(exportBackup(incoming), storage); exportBackup(readDoc(storage)); commitImport(plan, storage, false);
  assert.equal(storage.writes, 0); assert.deepEqual(copy(storage), unchanged);
  commitImport(plan, storage, true);
  const current = JSON.parse(storage.getItem(SAVE)!); assert.equal(current.name, 'Incoming'); assert.equal(current.hash, 'a'.repeat(64)); assert.deepEqual(current.note, { keep: true });
  assert.equal(readDoc(storage).xp, 0); assert.deepEqual(readDoc(storage).sit, {}); // legacy max/merge must not resurrect progress
  for (const key of LEGACY) { const old = JSON.parse(storage.getItem(key)!); assert.equal(old.xp, undefined); assert.equal(old.sit, undefined); assert.equal(old.ui, 'es'); assert.equal(old.theme, 'jade'); assert.deepEqual(old.accounts, [{ id: 'fake-account' }]); assert.deepEqual(old.privateMetadata, { keep: true }); }
  assert.equal(storage.getItem('unrelated'), 'untouched');
  undoImport(storage, false); assert.equal(JSON.parse(storage.getItem(SAVE)!).name, 'Incoming');
  undoImport(storage, true, recoveryPlan(storage));
  assert.deepEqual([...storage.data].filter(([k]) => k !== RECOVERY && k !== JOURNAL), before.filter(([k]) => k !== RECOVERY));
  assert.equal(JSON.parse(storage.getItem(JOURNAL)!).phase, 'complete');
  assert.equal(JSON.parse(storage.getItem(JOURNAL)!).recoveryRaw, storage.getItem(RECOVERY));
  assert.equal(readDoc(storage).xp, 9999);
});
test('snapshot failure causes no replacement; stale preview rejected with zero writes', () => {
  const storage = populated(), before = copy(storage), plan = prepareImport(exportBackup(defaults()), storage);
  storage.failKey = RECOVERY; assert.throws(() => commitImport(plan, storage, true), /quota/);
  assert.deepEqual(copy(storage).filter(([k]) => k !== JOURNAL), before); assert.equal(storage.writes, 1);
  assert.equal(JSON.parse(storage.getItem(JOURNAL)!).phase, 'pending');
  assert.deepEqual(recoveryPlan(storage).before, plan.before);
  storage.failKey = ''; undoImport(storage, true, recoveryPlan(storage));
  const fresh = prepareImport(exportBackup(defaults()), storage);
  storage.setItem(SAVE, JSON.stringify({ ...original(), xp: 999 })); storage.writes = 0;
  assert.throws(() => commitImport(fresh, storage, true), /changed/); assert.equal(storage.writes, 0);
});
test('import rollback on transient write failure leaves old documents recoverable', () => {
  const storage = populated(), before = copy(storage), plan = prepareImport(exportBackup(defaults()), storage);
  const set = storage.setItem.bind(storage); let fails = true;
  storage.setItem = (k, v) => { if (k === SAVE && fails) { fails = false; throw Error('Transient failure'); } set(k, v); };
  assert.throws(() => commitImport(plan, storage, true), /Transient/);
  assert.deepEqual([...storage.data].filter(([k]) => k !== RECOVERY && k !== JOURNAL), before); assert.ok(storage.getItem(RECOVERY));
  assert.equal(JSON.parse(storage.getItem(JOURNAL)!).phase, 'complete');
  assert.deepEqual(recoveryPlan(storage).before, plan.before);
});
test('read mirrors legacy migration without writes, preserves all current metadata', () => {
  const storage = populated(); const d = readDoc(storage); assert.equal(d.xp, 9999); assert.ok((d.sit as Doc)['de.m1']); assert.ok((d.sit as Doc)['de.old']); assert.ok(d.customMetadata); assert.equal(storage.writes, 0);
});
