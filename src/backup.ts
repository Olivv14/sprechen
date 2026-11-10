export const SAVE = 'sprechen.local.v1';
export const LEGACY = ['sprechen.v4', 'sprechen.v3', 'sprechen.v2', 'sprechen.accts.v1'] as const;
export const RECOVERY = 'sprechen.safe-recovery.v1';
export const JOURNAL = 'sprechen.safe-transaction.v1';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Doc = { [key: string]: Json };
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export const isMap = (x: unknown): x is Doc => !!x && typeof x === 'object' && !Array.isArray(x);
function bad(s: string): never { throw Error(s); }
function safeTree(x: unknown, depth = 0): void {
  if (depth > 60) bad('JSON is too deeply nested.');
  if (typeof x === 'number' && !Number.isFinite(x)) bad('Numbers must be finite.');
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) bad('Unsafe object key.');
    safeTree(v, depth + 1);
  }
}
const nonnegative = (v: Json, name: string) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) bad(`Invalid ${name}.`); };
export function validateDoc(x: unknown): Doc {
  safeTree(x);
  if (!isMap(x)) bad('A Sprechen save must be an object.');
  // A legacy raw export always contains these default fields. Do not accept arbitrary JSON.
  if (typeof x.name !== 'string' || typeof x.didSetup !== 'boolean' || !isMap(x.sit) || typeof x.xp !== 'number' || typeof x.streak !== 'number') bad('Not a complete Sprechen save.');
  for (const k of ['ui', 'theme', 'last', 'timezone', 'hash']) if (k in x && typeof x[k] !== 'string') bad(`Invalid ${k}.`);
  if ('hash' in x && !/^[a-f0-9]{64}$/i.test(x.hash as string)) bad('Invalid device secret hash.');
  if ('ui' in x && !['en', 'es'].includes(x.ui as string)) bad('Unsupported UI language.');
  for (const k of ['xp', 'streak', 'goal']) if (k in x) nonnegative(x[k], k);
  for (const k of ['sit', 'days', 'eggs', 'srs', 'hlr', 'quests', 'mastery', 'localPaths']) if (k in x && !isMap(x[k])) bad(`Invalid ${k} map.`);
  for (const [k, v] of Object.entries(x.sit)) {
    if (!isMap(v) || typeof v.stars !== 'number' || !Number.isInteger(v.stars) || v.stars < 0 || v.stars > 3) bad(`Invalid stars: ${k}.`);
  }
  for (const k of ['days', 'eggs']) if (isMap(x[k])) for (const v of Object.values(x[k])) if (typeof v !== 'boolean') bad(`Invalid ${k} value.`);
  for (const k of ['srs', 'hlr', 'quests', 'mastery']) if (isMap(x[k])) for (const v of Object.values(x[k])) if (!isMap(v)) bad(`Invalid ${k} record.`);
  if (isMap(x.hlr)) for (const [key, v] of Object.entries(x.hlr)) {
    if (!isMap(v) || typeof v.conceptId !== 'string' || v.conceptId !== key) bad('Invalid HLR identity.');
    for (const k of ['halfLifeHours', 'totalReviews', 'consecutiveCorrect']) nonnegative(v[k], `HLR ${k}`);
    if ((v.halfLifeHours as number) <= 0) bad('Invalid half-life.');
    for (const k of ['lastReviewDate', 'nextReviewDate']) if (typeof v[k] !== 'string' || !Number.isFinite(Date.parse(v[k] as string))) bad('Invalid HLR date.');
    if ('predictedProbability' in v && (typeof v.predictedProbability !== 'number' || v.predictedProbability < 0 || v.predictedProbability > 1)) bad('Invalid probability.');
  }
  if (isMap(x.mastery)) for (const v of Object.values(x.mastery)) if (isMap(v)) for (const k of ['active', 'passive']) nonnegative(v[k], `mastery ${k}`);
  if (isMap(x.localPaths)) {
    if (x.localPaths.version !== 1 || !isMap(x.localPaths.reviews) || !isMap(x.localPaths.units)) bad('Incompatible local paths data.');
    for (const v of Object.values(x.localPaths.reviews)) {
      if (!isMap(v) || typeof v.answer !== 'string' || typeof v.correct !== 'boolean' || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) bad('Invalid local review.');
      nonnegative(v.attempts, 'attempt count');
    }
    for (const v of Object.values(x.localPaths.units)) {
      if (!isMap(v) || typeof v.completed !== 'boolean') bad('Invalid unit state.');
      if ('stage' in v && (typeof v.stage !== 'number' || !Number.isInteger(v.stage) || v.stage < 0 || v.stage > 4)) bad('Invalid unit stage.');
      if ('draft' in v && typeof v.draft !== 'string') bad('Invalid unit draft.');
    }
  }
  return x;
}
export function parseBackup(text: string): Doc {
  if (text.length > 10_000_000) bad('Backup exceeds 10 MB.');
  let x: unknown;
  try { x = JSON.parse(text); } catch { return bad('Invalid JSON.'); }
  safeTree(x);
  if (isMap(x) && x.format === 'sprechen-backup') {
    if (x.format !== 'sprechen-backup' || x.version !== 1 || typeof x.exportedAt !== 'string' || !Number.isFinite(Date.parse(x.exportedAt))) bad('Unsupported backup format/version.');
    return validateDoc(x.data);
  }
  return validateDoc(x);
}
export function exportBackup(doc: Doc): string {
  return JSON.stringify({ format: 'sprechen-backup', version: 1, exportedAt: new Date().toISOString(), data: validateDoc(doc) }, null, 2);
}
export const defaults = (): Doc => ({ name: '', didSetup: false, ui: 'en', theme: 'night', goal: 10, xp: 0, streak: 0, last: '', sit: {}, days: {}, eggs: {}, srs: {}, hlr: {} });
export function readDoc(storage: StorageLike): Doc {
  assertResolved(storage);
  // Mirror the legacy reader in memory only. Reading, previewing and cancel never migrate/write.
  let migrated: Doc = {}, most = 0;
  for (const key of LEGACY) {
    let value: Doc;
    try { const x = JSON.parse(storage.getItem(key) || '{}'); if (!isMap(x)) continue; value = x; } catch { continue; }
    const sit: Doc = {};
    if (isMap(value.sit)) for (const [k, v] of Object.entries(value.sit)) {
      if (isMap(v) && 'stars' in v) sit[k] = { stars: Number(v.stars) || 1 };
      else if (typeof v === 'number' && v > 0) sit[k] = { stars: v };
    }
    if (isMap(value.seen)) for (const [k, v] of Object.entries(value.seen)) if (Number(v) > 0 && !sit[k]) sit[k] = { stars: 1 };
    if (Object.keys(sit).length > most) { most = Object.keys(sit).length; migrated = { ...value, sit, xp: Number(value.xp) || 0, streak: Number(value.streak) || 0 }; }
  }
  const raw = storage.getItem(SAVE);
  let current: Doc = {};
  if (raw) { const x: unknown = JSON.parse(raw); if (!isMap(x)) bad('Existing save is malformed; export its raw data before proceeding.'); current = x; }
  return { ...defaults(), ...migrated, ...current, sit: { ...(isMap(migrated.sit) ? migrated.sit : {}), ...(isMap(current.sit) ? current.sit : {}) }, xp: Math.max(Number(current.xp) || 0, Number(migrated.xp) || 0), streak: Math.max(Number(current.streak) || 0, Number(migrated.streak) || 0) };
}
const progressFields = ['sit', 'seen', 'xp', 'streak', 'last', 'hlr', 'srs', 'mastery', 'days', 'eggs', 'quests'];
type RawSnapshot = Record<string, string | null>;
function snapshot(storage: StorageLike): RawSnapshot { return Object.fromEntries([SAVE, ...LEGACY].map(k => [k, storage.getItem(k)])); }
function put(storage: StorageLike, key: string, value: string | null) { if (value === null) storage.removeItem(key); else storage.setItem(key, value); }
type Journal = { format: 'sprechen-transaction'; version: 1; phase: 'pending' | 'complete'; operation: 'import' | 'recovery'; recoveryRaw: string };
function parseRecovery(raw: string): RawSnapshot {
  const x: unknown = JSON.parse(raw);
  safeTree(x);
  if (!isMap(x) || x.format !== 'sprechen-recovery' || x.version !== 1 || !isMap(x.before)) bad('No valid recovery snapshot.');
  const before: RawSnapshot = {};
  for (const key of [SAVE, ...LEGACY]) {
    const value = x.before[key];
    if (value !== null && typeof value !== 'string') bad('Invalid recovery document.');
    before[key] = value;
  }
  return before;
}
function journal(storage: StorageLike): Journal | null {
  const raw = storage.getItem(JOURNAL);
  if (raw === null) return null;
  try {
    const x: unknown = JSON.parse(raw); safeTree(x);
    if (!isMap(x) || x.format !== 'sprechen-transaction' || x.version !== 1 || !['pending', 'complete'].includes(String(x.phase)) || !['import', 'recovery'].includes(String(x.operation)) || typeof x.recoveryRaw !== 'string') bad('Invalid journal.');
    parseRecovery(x.recoveryRaw);
    return x as Journal;
  } catch { return bad('Transaction journal is uncertain. Preserve raw documents and recovery; do not import or open legacy practice.'); }
}
export function assertResolved(storage: StorageLike): void {
  const state = journal(storage);
  if (state && (state.phase !== 'complete' || storage.getItem(RECOVERY) !== state.recoveryRaw)) bad('Incomplete or uncertain transaction. Preview and confirm recovery before continuing.');
}
function verifiedPut(storage: StorageLike, key: string, value: string | null): void {
  put(storage, key, value);
  if (storage.getItem(key) !== value) bad('Storage verification failed; recovery required.');
}
function mark(storage: StorageLike, state: Journal): void { verifiedPut(storage, JOURNAL, JSON.stringify(state)); }
function restore(storage: StorageLike, before: RawSnapshot): void {
  for (const key of [SAVE, ...LEGACY]) verifiedPut(storage, key, before[key]);
  if (JSON.stringify(snapshot(storage)) !== JSON.stringify(before)) bad('Recovery verification failed.');
}
export interface ImportPlan { data: Doc; before: RawSnapshot; recoveryRaw: string | null; journalRaw: string | null; replaced: { from: Doc; to: Doc }; }
export function prepareImport(text: string, storage: StorageLike): ImportPlan {
  assertResolved(storage);
  const data = structuredClone(parseBackup(text)), from = readDoc(storage);
  // An import must not replace an established device secret.
  if (typeof from.hash === 'string') data.hash = from.hash;
  return { data, before: snapshot(storage), recoveryRaw: storage.getItem(RECOVERY), journalRaw: storage.getItem(JOURNAL), replaced: { from, to: data } };
}
export function commitImport(plan: ImportPlan, storage: StorageLike, confirmed: boolean): void {
  if (!confirmed) return;
  assertResolved(storage);
  validateDoc(plan.data);
  if (JSON.stringify(plan.before) !== JSON.stringify(snapshot(storage)) || plan.recoveryRaw !== storage.getItem(RECOVERY) || plan.journalRaw !== storage.getItem(JOURNAL)) bad('Progress or recovery changed since preview. Preview again.');
  // Journal itself contains the exact original snapshot, even if terminated before RECOVERY is written.
  const recovery = JSON.stringify({ format: 'sprechen-recovery', version: 1, createdAt: new Date().toISOString(), before: plan.before });
  const state: Journal = { format: 'sprechen-transaction', version: 1, phase: 'pending', operation: 'import', recoveryRaw: recovery };
  mark(storage, state);
  verifiedPut(storage, RECOVERY, recovery);
  try {
    for (const key of LEGACY) {
      const raw = plan.before[key];
      if (!raw) continue;
      let old: unknown;
      try { old = JSON.parse(raw); } catch { continue; }
      if (!isMap(old)) continue;
      for (const field of progressFields) delete old[field];
      verifiedPut(storage, key, JSON.stringify(old));
    }
    verifiedPut(storage, SAVE, JSON.stringify(plan.data));
    mark(storage, { ...state, phase: 'complete' });
  } catch (err) {
    // A terminated process cannot run these writes. Pending journal survives a failed rollback.
    try { restore(storage, plan.before); mark(storage, { ...state, phase: 'complete' }); }
    catch { bad(`Import uncertain; preview recovery before continuing. ${(err as Error).message}`); }
    throw err;
  }
}
export interface RecoveryPlan { before: RawSnapshot; current: RawSnapshot; recoveryRaw: string; storedRecoveryRaw: string | null; journalRaw: string | null; }
export function recoveryPlan(storage: StorageLike): RecoveryPlan {
  const state = journal(storage), storedRecoveryRaw = storage.getItem(RECOVERY);
  const recoveryRaw = state?.recoveryRaw ?? storedRecoveryRaw ?? 'null';
  return { before: parseRecovery(recoveryRaw), current: snapshot(storage), recoveryRaw, storedRecoveryRaw, journalRaw: storage.getItem(JOURNAL) };
}
export function undoImport(storage: StorageLike, confirmed: boolean, expected?: RecoveryPlan): void {
  if (!confirmed) return;
  if (!expected) bad('Recovery preview required.');
  const actual = recoveryPlan(storage), { before } = actual;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) bad('Recovery or progress changed; preview again.');
  const state: Journal = { format: 'sprechen-transaction', version: 1, phase: 'pending', operation: 'recovery', recoveryRaw: actual.recoveryRaw };
  mark(storage, state);
  verifiedPut(storage, RECOVERY, actual.recoveryRaw);
  // Recovery failures stay pending; repeating explicit recovery always targets the original, never half-written state.
  restore(storage, before);
  mark(storage, { ...state, phase: 'complete' });
}
