import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAVE, LEGACY, RECOVERY, defaults, prepareImport, commitImport, recoveryPlan, undoImport, type StorageLike } from '../src/backup.ts';

class Store implements StorageLike {
  data = new Map<string, string>(); writes = 0;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes++; this.data.set(k, v); }
  removeItem(k: string) { this.writes++; this.data.delete(k); }
}
function seed() {
  const s = new Store();
  s.setItem(SAVE, JSON.stringify({ ...defaults(), name: 'Original', didSetup: true, hash: 'a'.repeat(64) }));
  for (const key of LEGACY) s.setItem(key, JSON.stringify({ xp: 90, sit: { 'de.old': { stars: 2 } }, accounts: ['synthetic'], ui: 'es' }));
  s.setItem('unrelated', 'retained'); s.writes = 0; return s;
}
const incoming = () => JSON.stringify({ ...defaults(), name: 'Incoming', didSetup: true });
const JOURNAL = 'sprechen.safe-transaction.v1';
test('F2: every raw current document and recovery identity is checked again at undo confirmation', () => {
  for (const key of [SAVE, ...LEGACY, RECOVERY, JOURNAL]) {
    const s = seed(); commitImport(prepareImport(incoming(), s), s, true);
    const preview = recoveryPlan(s);
    // A second tab may change even whitespace or metadata without changing the summary.
    s.setItem(key, s.getItem(key)! + ' '); const changed = [...s.data]; s.writes = 0;
    assert.throws(() => undoImport(s, true, preview), /changed|preview/i, key);
    assert.equal(s.writes, 0, key); assert.deepEqual([...s.data], changed);
  }
});
class CrashStore extends Store {
  boundary = Infinity; dead = false;
  override getItem(k: string) { if (this.dead) throw Error('Process terminated'); return super.getItem(k); }
  override setItem(k: string, v: string) { if (this.dead) throw Error('Process terminated'); super.setItem(k, v); this.crash(); }
  override removeItem(k: string) { if (this.dead) throw Error('Process terminated'); super.removeItem(k); this.crash(); }
  crash() { if (this.writes === this.boundary) { this.dead = true; throw Error('Process terminated after durable boundary'); } }
}
const raw = (s: Store) => [SAVE, ...LEGACY].map(k => s.getItem(k));
test('F3: interruption at EVERY import durable boundary preserves originals and blocks retry until explicit resolution', t => {
  let cases = 0;
  // Include null vs empty string and a removed current document as separate inputs.
  for (const absent of [false, true]) {
    const baseline = seed(); if (absent) { baseline.data.delete(SAVE); baseline.data.delete(LEGACY[2]); baseline.data.set(LEGACY[3], ''); }
    const original = raw(baseline);
    const successful = new CrashStore(); successful.data = new Map(baseline.data);
    commitImport(prepareImport(incoming(), successful), successful, true);
    const count = successful.writes;
    for (let boundary = 1; boundary <= count; boundary++) {
      cases++;
      const s = new CrashStore(); s.data = new Map(baseline.data); s.boundary = boundary;
      assert.throws(() => commitImport(prepareImport(incoming(), s), s, true), /terminated|uncertain|recover/i);
      s.dead = false; s.boundary = Infinity; s.writes = 0;
      const recovery = recoveryPlan(s) as unknown as { before: Record<string, string | null> };
      assert.deepEqual([SAVE, ...LEGACY].map(k => recovery.before[k]), original, `boundary ${boundary}`);
      // Only the fully durable completion boundary may be accepted as complete on reopen.
      if (boundary < count) {
        assert.throws(() => commitImport(prepareImport(incoming(), s), s, true), /recover|incomplete|uncertain/i);
        assert.equal(s.writes, 0);
      }
      const preview = recoveryPlan(s); undoImport(s, false, preview); assert.equal(s.writes, 0);
      undoImport(s, true, preview); assert.deepEqual(raw(s), original);
      assert.equal(s.getItem('unrelated'), 'retained');
      commitImport(prepareImport(incoming(), s), s, true);
      assert.equal(JSON.parse(s.getItem(SAVE)!).name, 'Incoming');
      assert.ok((s.getItem(JOURNAL) || '').length < 12000, 'no nested history');
    }
  }
  t.diagnostic(`${cases} import durable-boundary terminations`);
});
test('F3: interruption at EVERY recovery boundary retains the original target for another explicit recovery', t => {
  let cases = 0;
  for (const absent of [false, true]) {
    const baseline = seed(); if (absent) { baseline.data.delete(SAVE); baseline.data.delete(LEGACY[2]); baseline.data.set(LEGACY[3], ''); }
    const original = raw(baseline);
    commitImport(prepareImport(incoming(), baseline), baseline, true);
    const success = new CrashStore(); success.data = new Map(baseline.data);
    undoImport(success, true, recoveryPlan(success));
    for (let boundary = 1; boundary <= success.writes; boundary++) {
      cases++;
      const s = new CrashStore(); s.data = new Map(baseline.data); s.boundary = boundary;
      assert.throws(() => undoImport(s, true, recoveryPlan(s)));
      s.dead = false; s.boundary = Infinity; s.writes = 0;
      if (boundary < success.writes) {
        assert.throws(() => prepareImport(incoming(), s), /recover|incomplete|uncertain/i); assert.equal(s.writes, 0);
      }
      const plan = recoveryPlan(s);
      assert.deepEqual([SAVE, ...LEGACY].map(k => plan.before[k]), original);
      undoImport(s, true, plan); assert.deepEqual(raw(s), original);
    }
  }
  t.diagnostic(`${cases} recovery durable-boundary terminations`);
});
test('F3: termination during EVERY rollback write/delete boundary keeps the original journal target', t => {
  let cases = 0;
  for (const absent of [false, true]) {
    const baseline = seed(); if (absent) { baseline.data.delete(SAVE); baseline.data.delete(LEGACY[1]); }
    const original = raw(baseline);
    const fixture = (boundary = Infinity) => {
      const s = new CrashStore(); s.data = new Map(baseline.data); s.boundary = boundary;
      const set = s.setItem.bind(s); let fail = true;
      s.setItem = (k, v) => { if (k === SAVE && fail) { fail = false; throw Error('Transient import failure'); } set(k, v); };
      return s;
    };
    const success = fixture(); assert.throws(() => commitImport(prepareImport(incoming(), success), success, true));
    for (let boundary = 1; boundary <= success.writes; boundary++) {
      cases++;
      const s = fixture(boundary);
      assert.throws(() => commitImport(prepareImport(incoming(), s), s, true));
      s.dead = false; s.boundary = Infinity; s.writes = 0;
      s.setItem = CrashStore.prototype.setItem.bind(s);
      const plan = recoveryPlan(s);
      assert.deepEqual([SAVE, ...LEGACY].map(k => plan.before[k]), original);
      if (boundary < success.writes) { assert.throws(() => prepareImport(incoming(), s), /recover|incomplete|uncertain/i); assert.equal(s.writes, 0); }
      undoImport(s, true, plan); assert.deepEqual(raw(s), original);
    }
  }
  t.diagnostic(`${cases} rollback-path durable-boundary terminations`);
});
test('F3: transient/persistent storage failures including completion never claim success or lose recovery', () => {
  for (const persistent of [false, true]) for (let failAt = 1; failAt <= 8; failAt++) {
    const s = seed(), original = raw(s); let attempts = 0, broken = false;
    const set = s.setItem.bind(s), remove = s.removeItem.bind(s);
    const fail = () => { if (++attempts === failAt) broken = true; if (broken) { if (!persistent) broken = false; throw Error('Synthetic quota'); } };
    s.setItem = (k, v) => { fail(); set(k, v); }; s.removeItem = k => { fail(); remove(k); };
    assert.throws(() => commitImport(prepareImport(incoming(), s), s, true), /quota|recover|uncertain/i, `${persistent}/${failAt}`);
    s.setItem = set; s.removeItem = remove;
    if (s.getItem(JOURNAL)) {
      const plan = recoveryPlan(s);
      assert.deepEqual([SAVE, ...LEGACY].map(k => plan.before[k]), original);
      undoImport(s, true, plan); assert.deepEqual(raw(s), original);
    } else assert.deepEqual(raw(s), original);
  }
});
test('F3: pre-journal recovery remains usable, malformed journal fails closed without deleting anything', () => {
  const s = seed(), original = Object.fromEntries([SAVE, ...LEGACY].map(k => [k, s.getItem(k)]));
  s.setItem(RECOVERY, JSON.stringify({ format: 'sprechen-recovery', version: 1, before: original }));
  s.setItem(SAVE, '{'); s.writes = 0;
  const preview = recoveryPlan(s); assert.equal(s.writes, 0);
  undoImport(s, true, preview); assert.deepEqual(raw(s), Object.values(original));
  s.setItem(JOURNAL, '{'); const before = [...s.data]; s.writes = 0;
  assert.throws(() => prepareImport(incoming(), s), /journal|recover|uncertain/i);
  assert.equal(s.writes, 0); assert.deepEqual([...s.data], before);
});
test('F2: confirmed undo requires a preview; cancel/reload/two successive imports retain explicit stale checks', () => {
  const s = seed(); const original = [SAVE, ...LEGACY].map(k => s.getItem(k));
  commitImport(prepareImport(incoming(), s), s, true);
  const firstPreview = recoveryPlan(s); s.writes = 0;
  undoImport(s, false, firstPreview); assert.equal(s.writes, 0);
  assert.throws(() => undoImport(s, true), /preview/i); assert.equal(s.writes, 0);
  // A new storage adapter models reload; exact raw state still matches.
  const reopened = new Store(); reopened.data = s.data;
  undoImport(reopened, true, recoveryPlan(reopened));
  assert.deepEqual([SAVE, ...LEGACY].map(k => reopened.getItem(k)), original);
  commitImport(prepareImport(incoming(), reopened), reopened, true);
  commitImport(prepareImport(JSON.stringify({ ...defaults(), name: 'Second' }), reopened), reopened, true);
  reopened.writes = 0;
  assert.throws(() => undoImport(reopened, true, firstPreview), /changed|preview/i);
  assert.equal(reopened.writes, 0);
  undoImport(reopened, true, recoveryPlan(reopened));
  assert.equal(JSON.parse(reopened.getItem(SAVE)!).name, 'Incoming');
});
