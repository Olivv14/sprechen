// src/backup.ts
var SAVE = "sprechen.local.v1";
var LEGACY = ["sprechen.v4", "sprechen.v3", "sprechen.v2", "sprechen.accts.v1"];
var RECOVERY = "sprechen.safe-recovery.v1";
var JOURNAL = "sprechen.safe-transaction.v1";
var isMap = (x) => !!x && typeof x === "object" && !Array.isArray(x);
function bad(s) {
  throw Error(s);
}
function safeTree(x, depth = 0) {
  if (depth > 60) bad("JSON is too deeply nested.");
  if (typeof x === "number" && !Number.isFinite(x)) bad("Numbers must be finite.");
  if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
    if (["__proto__", "constructor", "prototype"].includes(k)) bad("Unsafe object key.");
    safeTree(v, depth + 1);
  }
}
var nonnegative = (v, name) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) bad(`Invalid ${name}.`);
};
function validateDoc(x) {
  safeTree(x);
  if (!isMap(x)) bad("A Sprechen save must be an object.");
  if (typeof x.name !== "string" || typeof x.didSetup !== "boolean" || !isMap(x.sit) || typeof x.xp !== "number" || typeof x.streak !== "number") bad("Not a complete Sprechen save.");
  for (const k of ["ui", "theme", "last", "timezone", "hash"]) if (k in x && typeof x[k] !== "string") bad(`Invalid ${k}.`);
  if ("hash" in x && !/^[a-f0-9]{64}$/i.test(x.hash)) bad("Invalid device secret hash.");
  if ("ui" in x && !["en", "es"].includes(x.ui)) bad("Unsupported UI language.");
  for (const k of ["xp", "streak", "goal"]) if (k in x) nonnegative(x[k], k);
  for (const k of ["sit", "days", "eggs", "srs", "hlr", "quests", "mastery", "localPaths"]) if (k in x && !isMap(x[k])) bad(`Invalid ${k} map.`);
  for (const [k, v] of Object.entries(x.sit)) {
    if (!isMap(v) || typeof v.stars !== "number" || !Number.isInteger(v.stars) || v.stars < 0 || v.stars > 3) bad(`Invalid stars: ${k}.`);
  }
  for (const k of ["days", "eggs"]) if (isMap(x[k])) {
    for (const v of Object.values(x[k])) if (typeof v !== "boolean") bad(`Invalid ${k} value.`);
  }
  for (const k of ["srs", "hlr", "quests", "mastery"]) if (isMap(x[k])) {
    for (const v of Object.values(x[k])) if (!isMap(v)) bad(`Invalid ${k} record.`);
  }
  if (isMap(x.hlr)) for (const [key, v] of Object.entries(x.hlr)) {
    if (!isMap(v) || typeof v.conceptId !== "string" || v.conceptId !== key) bad("Invalid HLR identity.");
    for (const k of ["halfLifeHours", "totalReviews", "consecutiveCorrect"]) nonnegative(v[k], `HLR ${k}`);
    if (v.halfLifeHours <= 0) bad("Invalid half-life.");
    for (const k of ["lastReviewDate", "nextReviewDate"]) if (typeof v[k] !== "string" || !Number.isFinite(Date.parse(v[k]))) bad("Invalid HLR date.");
    if ("predictedProbability" in v && (typeof v.predictedProbability !== "number" || v.predictedProbability < 0 || v.predictedProbability > 1)) bad("Invalid probability.");
  }
  if (isMap(x.mastery)) {
    for (const v of Object.values(x.mastery)) if (isMap(v)) for (const k of ["active", "passive"]) nonnegative(v[k], `mastery ${k}`);
  }
  if (isMap(x.localPaths)) {
    if (x.localPaths.version !== 1 || !isMap(x.localPaths.reviews) || !isMap(x.localPaths.units)) bad("Incompatible local paths data.");
    for (const v of Object.values(x.localPaths.reviews)) {
      if (!isMap(v) || typeof v.answer !== "string" || typeof v.correct !== "boolean" || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at))) bad("Invalid local review.");
      nonnegative(v.attempts, "attempt count");
    }
    for (const v of Object.values(x.localPaths.units)) {
      if (!isMap(v) || typeof v.completed !== "boolean") bad("Invalid unit state.");
      if ("stage" in v && (typeof v.stage !== "number" || !Number.isInteger(v.stage) || v.stage < 0 || v.stage > 4)) bad("Invalid unit stage.");
      if ("draft" in v && typeof v.draft !== "string") bad("Invalid unit draft.");
    }
  }
  return x;
}
function parseBackup(text) {
  if (text.length > 1e7) bad("Backup exceeds 10 MB.");
  let x;
  try {
    x = JSON.parse(text);
  } catch {
    return bad("Invalid JSON.");
  }
  safeTree(x);
  if (isMap(x) && x.format === "sprechen-backup") {
    if (x.format !== "sprechen-backup" || x.version !== 1 || typeof x.exportedAt !== "string" || !Number.isFinite(Date.parse(x.exportedAt))) bad("Unsupported backup format/version.");
    return validateDoc(x.data);
  }
  return validateDoc(x);
}
function exportBackup(doc2) {
  return JSON.stringify({ format: "sprechen-backup", version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), data: validateDoc(doc2) }, null, 2);
}
var defaults = () => ({ name: "", didSetup: false, ui: "en", theme: "night", goal: 10, xp: 0, streak: 0, last: "", sit: {}, days: {}, eggs: {}, srs: {}, hlr: {} });
function readDoc(storage) {
  assertResolved(storage);
  let migrated = {}, most = 0;
  for (const key of LEGACY) {
    let value2;
    try {
      const x = JSON.parse(storage.getItem(key) || "{}");
      if (!isMap(x)) continue;
      value2 = x;
    } catch {
      continue;
    }
    const sit = {};
    if (isMap(value2.sit)) for (const [k, v] of Object.entries(value2.sit)) {
      if (isMap(v) && "stars" in v) sit[k] = { stars: Number(v.stars) || 1 };
      else if (typeof v === "number" && v > 0) sit[k] = { stars: v };
    }
    if (isMap(value2.seen)) {
      for (const [k, v] of Object.entries(value2.seen)) if (Number(v) > 0 && !sit[k]) sit[k] = { stars: 1 };
    }
    if (Object.keys(sit).length > most) {
      most = Object.keys(sit).length;
      migrated = { ...value2, sit, xp: Number(value2.xp) || 0, streak: Number(value2.streak) || 0 };
    }
  }
  const raw = storage.getItem(SAVE);
  let current = {};
  if (raw) {
    const x = JSON.parse(raw);
    if (!isMap(x)) bad("Existing save is malformed; export its raw data before proceeding.");
    current = x;
  }
  return { ...defaults(), ...migrated, ...current, sit: { ...isMap(migrated.sit) ? migrated.sit : {}, ...isMap(current.sit) ? current.sit : {} }, xp: Math.max(Number(current.xp) || 0, Number(migrated.xp) || 0), streak: Math.max(Number(current.streak) || 0, Number(migrated.streak) || 0) };
}
var progressFields = ["sit", "seen", "xp", "streak", "last", "hlr", "srs", "mastery", "days", "eggs", "quests"];
function snapshot(storage) {
  return Object.fromEntries([SAVE, ...LEGACY].map((k) => [k, storage.getItem(k)]));
}
function put(storage, key, value2) {
  if (value2 === null) storage.removeItem(key);
  else storage.setItem(key, value2);
}
function parseRecovery(raw) {
  const x = JSON.parse(raw);
  safeTree(x);
  if (!isMap(x) || x.format !== "sprechen-recovery" || x.version !== 1 || !isMap(x.before)) bad("No valid recovery snapshot.");
  const before = {};
  for (const key of [SAVE, ...LEGACY]) {
    const value2 = x.before[key];
    if (value2 !== null && typeof value2 !== "string") bad("Invalid recovery document.");
    before[key] = value2;
  }
  return before;
}
function journal(storage) {
  const raw = storage.getItem(JOURNAL);
  if (raw === null) return null;
  try {
    const x = JSON.parse(raw);
    safeTree(x);
    if (!isMap(x) || x.format !== "sprechen-transaction" || x.version !== 1 || !["pending", "complete"].includes(String(x.phase)) || !["import", "recovery"].includes(String(x.operation)) || typeof x.recoveryRaw !== "string") bad("Invalid journal.");
    parseRecovery(x.recoveryRaw);
    return x;
  } catch {
    return bad("Transaction journal is uncertain. Preserve raw documents and recovery; do not import or open legacy practice.");
  }
}
function assertResolved(storage) {
  const state = journal(storage);
  if (state && (state.phase !== "complete" || storage.getItem(RECOVERY) !== state.recoveryRaw)) bad("Incomplete or uncertain transaction. Preview and confirm recovery before continuing.");
}
function verifiedPut(storage, key, value2) {
  put(storage, key, value2);
  if (storage.getItem(key) !== value2) bad("Storage verification failed; recovery required.");
}
function mark(storage, state) {
  verifiedPut(storage, JOURNAL, JSON.stringify(state));
}
function restore(storage, before) {
  for (const key of [SAVE, ...LEGACY]) verifiedPut(storage, key, before[key]);
  if (JSON.stringify(snapshot(storage)) !== JSON.stringify(before)) bad("Recovery verification failed.");
}
function prepareImport(text, storage) {
  assertResolved(storage);
  const data = structuredClone(parseBackup(text)), from = readDoc(storage);
  if (typeof from.hash === "string") data.hash = from.hash;
  return { data, before: snapshot(storage), recoveryRaw: storage.getItem(RECOVERY), journalRaw: storage.getItem(JOURNAL), replaced: { from, to: data } };
}
function commitImport(plan, storage, confirmed) {
  if (!confirmed) return;
  assertResolved(storage);
  validateDoc(plan.data);
  if (JSON.stringify(plan.before) !== JSON.stringify(snapshot(storage)) || plan.recoveryRaw !== storage.getItem(RECOVERY) || plan.journalRaw !== storage.getItem(JOURNAL)) bad("Progress or recovery changed since preview. Preview again.");
  const recovery = JSON.stringify({ format: "sprechen-recovery", version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString(), before: plan.before });
  const state = { format: "sprechen-transaction", version: 1, phase: "pending", operation: "import", recoveryRaw: recovery };
  mark(storage, state);
  verifiedPut(storage, RECOVERY, recovery);
  try {
    for (const key of LEGACY) {
      const raw = plan.before[key];
      if (!raw) continue;
      let old;
      try {
        old = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isMap(old)) continue;
      for (const field of progressFields) delete old[field];
      verifiedPut(storage, key, JSON.stringify(old));
    }
    verifiedPut(storage, SAVE, JSON.stringify(plan.data));
    mark(storage, { ...state, phase: "complete" });
  } catch (err) {
    try {
      restore(storage, plan.before);
      mark(storage, { ...state, phase: "complete" });
    } catch {
      bad(`Import uncertain; preview recovery before continuing. ${err.message}`);
    }
    throw err;
  }
}
function recoveryPlan(storage) {
  const state = journal(storage), storedRecoveryRaw = storage.getItem(RECOVERY);
  const recoveryRaw = state?.recoveryRaw ?? storedRecoveryRaw ?? "null";
  return { before: parseRecovery(recoveryRaw), current: snapshot(storage), recoveryRaw, storedRecoveryRaw, journalRaw: storage.getItem(JOURNAL) };
}
function undoImport(storage, confirmed, expected) {
  if (!confirmed) return;
  if (!expected) bad("Recovery preview required.");
  const actual = recoveryPlan(storage), { before } = actual;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) bad("Recovery or progress changed; preview again.");
  const state = { format: "sprechen-transaction", version: 1, phase: "pending", operation: "recovery", recoveryRaw: actual.recoveryRaw };
  mark(storage, state);
  verifiedPut(storage, RECOVERY, actual.recoveryRaw);
  restore(storage, before);
  mark(storage, { ...state, phase: "complete" });
}

// src/course.ts
function rows(course) {
  return course.tracks.flatMap((t) => t.sections.flatMap((s) => s.units.flatMap((u) => u.lessons.flatMap((l) => l.items.map((item, index) => ({ key: `${t.id}::${l.id}::${index}`, track: t.id, lesson: l.id, title: l.title, index, item }))))));
}
var portugalKeys = /* @__PURE__ */ new Set(["flirt::rp1::2", "flirt::rp1::4", "flirt::rp2::2", "flirt::rp2::4", "flirt::fd2::0"]);
var pilot = [
  ["Bonjour, je m\u2019appelle Alex.", "Hello, my name is Alex.", "Hola, me llamo Alex."],
  ["Je suis programmeur.", "I am a programmer.", "Soy programador."],
  ["Je travaille dans une entreprise de syst\xE8mes informatiques et d\u2019intelligence artificielle.", "I work at a company specialising in computer systems and artificial intelligence.", "Trabajo en una empresa de sistemas inform\xE1ticos e inteligencia artificial."],
  ["Nous d\xE9veloppons des outils pour les entreprises.", "We develop tools for businesses.", "Desarrollamos herramientas para empresas."],
  ["Pouvez-vous r\xE9p\xE9ter plus lentement, s\u2019il vous pla\xEEt ?", "Could you repeat more slowly, please?", "\xBFPuede repetir m\xE1s despacio, por favor?"],
  ["Et vous, sur quoi travaillez-vous ?", "And you, what are you working on?", "\xBFY usted, en qu\xE9 trabaja?"]
].map(([say, en, es], index) => ({ key: `fr::intro-pilot-v1::${index}`, track: "fr", lesson: "intro-pilot-v1", title: "A programmer\u2019s introduction", index, item: { hear: null, say, en, es, ph: "", why: "Original authored French pilot. Formal vous; programmeuse is the feminine form.", lang: "fr" } }));
function forLanguage(all2, lang) {
  return all2.filter((r) => r.item.lang === lang && (lang !== "pt" || portugalKeys.has(r.key)));
}
function normalize(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

// src/voice.ts
function exactPortugalVoice(voices) {
  return voices.find((v) => v.lang.toLowerCase().replace("_", "-") === "pt-pt");
}
function guardLegacySpeech(report) {
  if (!window.speechSynthesis) return;
  const synth = window.speechSynthesis, original = synth.speak.bind(synth);
  synth.speak = (utterance) => {
    if (/^pt(?:-|_|$)/i.test(utterance.lang)) {
      const voice = utterance.voice?.lang.toLowerCase().replace("_", "-") === "pt-pt" ? utterance.voice : exactPortugalVoice(synth.getVoices().filter((v) => v.localService)) || exactPortugalVoice(synth.getVoices());
      if (!voice) {
        report("Portugal voice unavailable. Continue with text practice; no Brazilian fallback.");
        return;
      }
      utterance.lang = "pt-PT";
      utterance.voice = voice;
    }
    if (/^ar(?:-|_|$)/i.test(utterance.lang)) {
      report("No verified Tunisian audio is included.");
      return;
    }
    original(utterance);
  };
}
function speak(text, language2, report) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    report("System audio unavailable. Text practice remains available.");
    return;
  }
  const lang = { de: "de-DE", fr: "fr-FR", it: "it-IT", pt: "pt-PT" }[language2];
  if (!lang) {
    report("No verified voice for this language.");
    return;
  }
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase() === lang.toLowerCase() && v.localService);
  if (!voice) {
    report(`${lang} local system voice unavailable. Continue with text practice.`);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.voice = voice;
  utterance.rate = 0.9;
  utterance.onerror = () => report("System audio unavailable. Continue with text practice.");
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  report(`System TTS (${lang}); availability depends on installed local voices. Not recorded native audio.`);
}

// src/app.ts
var BASE = "/sprechen";
var root = document.getElementById("root");
root.dataset.build = "03d838211c5333bf";
var escape = (value2) => String(value2 ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var link = (path, text, cls = "") => `<a class="${cls}" href="${BASE}${path}">${escape(text)}</a>`;
var button = (id, text, cls = "") => `<button type="button" id="${id}" class="${cls}">${escape(text)}</button>`;
var on = (id, callback) => document.getElementById(id)?.addEventListener("click", (event) => {
  try {
    callback(event);
  } catch (err) {
    notice(`Action could not finish: ${err.message}`);
  }
});
var value = (id) => document.getElementById(id).value;
var languages = {
  de: { title: "Deutsch", scope: "Existing German lessons + local practice. All paths open." },
  fr: { title: "Fran\xE7ais", scope: "Start with an integrated introduction, or revisit the existing French lessons." },
  pt: { title: "Portugu\xEAs \xB7 Portugal", scope: "Five selected text items from the existing mixed social scenes. Portugal only; a practice sampler, not a full course." },
  it: { title: "Italiano", scope: "Eleven existing items from mixed social scenes. A practice sampler, not a full course." },
  tn: { title: "Tunisian / Arabic context", scope: "Resource state only. No verified Tunisian teaching or assessed audio is included yet." }
};
function routePath(pathname) {
  if (!/^\/sprechen(?:\/|$)/i.test(pathname)) return null;
  let path = pathname.slice(BASE.length);
  try {
    path = path.split("/").map((segment) => decodeURIComponent(segment).replace(/\//g, "%2F")).join("/");
  } catch {
  }
  const parts = (path.replace(/\/+$/, "") || "/").split("/");
  parts[1] = parts[1].toLowerCase();
  return parts.join("/");
}
var currentPath = () => routePath(location.pathname) || "/";
function owned(path) {
  return /^\/(today|map|language|practice|series|backup-safe|backup|you|review-local|review)(\/|$)/.test(path) || /^\/t\/(pt|it)(\/|$)/.test(path) || /^\/play\/flirt\/(rp1|rp2|fd2)$/.test(path);
}
function notice(text) {
  let box = document.getElementById("notice");
  if (!box) {
    box = document.createElement("div");
    box.id = "notice";
    box.setAttribute("role", "status");
    box.className = "legacy-notice";
    document.body.append(box);
  }
  box.textContent = text;
}
guardLegacySpeech(notice);
var originalPush = history.pushState.bind(history);
var originalReplace = history.replaceState.bind(history);
function maintainedURL(target) {
  const path = routePath(target.pathname);
  if (target.origin !== location.origin || path === null || !owned(path)) return null;
  const canonical = new URL(target);
  canonical.pathname = BASE + path;
  return canonical;
}
var initialURL = maintainedURL(new URL(location.href));
if (initialURL && initialURL.href !== location.href) originalReplace(history.state, "", initialURL);
for (const method of ["pushState", "replaceState"]) {
  const original = method === "pushState" ? originalPush : originalReplace;
  history[method] = (data, unused, url) => {
    if (url != null) {
      const target = maintainedURL(new URL(url, location.href));
      if (target) {
        if (method === "replaceState") location.replace(target.href);
        else location.assign(target.href);
        return;
      }
    }
    original(data, unused, url);
  };
}
window.addEventListener("popstate", (event) => {
  const target = maintainedURL(new URL(location.href));
  if (target) {
    event.stopImmediatePropagation();
    location.replace(target.href);
  }
}, true);
document.addEventListener("click", (event) => {
  const mouse = event;
  if (mouse.button || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey || mouse.altKey) return;
  const a = event.target?.closest("a");
  if (!a || a.target || a.hasAttribute("download")) return;
  const target = maintainedURL(new URL(a.href));
  if (target) {
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign(target.href);
  }
}, true);
var offlineText = "Preparing offline core\u2026";
var offlineRegistration;
var offlineSequence = 0;
var installFailed = false;
var watchedWorkers = /* @__PURE__ */ new WeakSet();
function workerMessage(worker, message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), timer = setTimeout(() => {
      channel.port1.close();
      reject(Error("Offline status unavailable."));
    }, message === "REPAIR" ? 25e3 : 5e3);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(e.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}
async function refreshOffline() {
  const sequence = ++offlineSequence, registration = offlineRegistration;
  if (!registration) return;
  try {
    if (registration.waiting) {
      const candidate = registration.waiting;
      const candidateStatus = await workerMessage(candidate, "STATUS");
      if (candidateStatus.version === "sprechen-core-03d838211c5333bf" && candidateStatus.ready) candidate.postMessage("ACTIVATE");
    }
    const worker = registration.active;
    const status = worker ? await workerMessage(worker, "STATUS") : void 0;
    if (sequence !== offlineSequence) return;
    if (status?.version === "sprechen-core-03d838211c5333bf" && status.ready) {
      offlineText = "Offline ready \xB7 core lessons and text practice saved on this device";
    } else if (status?.version !== void 0 && status.version !== "sprechen-core-03d838211c5333bf") {
      offlineText = `${status.ready ? "Previous version available" : "Other version incomplete"} \xB7 this loaded build offline preparation ${installFailed ? "failed. Reconnect and retry." : registration.installing || registration.waiting ? "in progress\u2026" : "incomplete. Reconnect and retry."}`;
    } else {
      offlineText = installFailed ? "Offline preparation failed. Reconnect and retry." : registration.installing ? "Preparing offline core for this loaded build\u2026" : "Offline preparation incomplete. Reconnect and retry.";
    }
  } catch (err) {
    if (sequence === offlineSequence) offlineText = `Offline preparation failed: ${err.message}`;
  }
  updateOffline();
}
function observeOffline(registration) {
  const watch = (worker) => {
    if (!worker || watchedWorkers.has(worker)) return;
    watchedWorkers.add(worker);
    const timer = setTimeout(() => {
      if (worker.state === "installing" || worker.state === "installed") {
        installFailed = true;
        void refreshOffline();
      }
    }, 25e3);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated" || worker.state === "redundant") clearTimeout(timer);
      if (worker.state === "redundant") installFailed = true;
      void refreshOffline();
    });
  };
  watch(registration.installing);
  watch(registration.waiting);
  registration.addEventListener("updatefound", () => {
    installFailed = false;
    watch(registration.installing);
    void refreshOffline();
  });
}
async function offlineStatus(retry = false) {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    offlineText = "Offline preparation unavailable: use HTTPS or localhost.";
    updateOffline();
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(BASE + "/sw.js", { scope: BASE + "/" });
    if (offlineRegistration !== registration) {
      offlineRegistration = registration;
      observeOffline(registration);
    }
    if (retry) {
      installFailed = false;
      await registration.update();
      const worker = registration.active;
      if (worker) {
        const status = await workerMessage(worker, "STATUS");
        if (status.version === "sprechen-core-03d838211c5333bf" && !status.ready) {
          const repaired = await workerMessage(worker, "REPAIR");
          if (!repaired.ready) throw Error(repaired.error || "Required core resources are still missing.");
        }
      }
    }
    await refreshOffline();
  } catch (err) {
    offlineText = `Offline preparation failed: ${err.message}`;
  }
  updateOffline();
}
function updateOffline() {
  const el = document.getElementById("offline-status");
  if (el) el.textContent = `${navigator.onLine ? "" : "Offline now \xB7 "}${offlineText}`;
}
window.addEventListener("online", () => {
  updateOffline();
  void refreshOffline();
});
window.addEventListener("offline", () => {
  updateOffline();
  void refreshOffline();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshOffline();
});
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    void refreshOffline();
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "CORE_INCOMPLETE") void refreshOffline();
  });
}
void offlineStatus();
function shell(title, body) {
  document.body.classList.add("local-paths");
  root.innerHTML = `<div class="paths-shell"><header class="paths-header">${link("/today", "Sprechen", "brand")}<span>LOCAL / NIGHT</span>${link("/you", "You")}</header><main id="main"><p class="eyebrow">YOUR LANGUAGE, YOUR PATH</p><h1>${escape(title)}</h1>${body}<p id="notice" role="status"></p><aside class="offline-box"><p id="offline-status" role="status"></p>${button("offline-retry", "Retry offline preparation", "quiet")}<p>Text exercises and review work locally after preparation. System audio depends on installed voices. External support stays online.</p></aside></main><nav class="paths-nav" aria-label="Main">${link("/today", "Languages")}${link("/review-local", "Review")}${link("/backup-safe", "Backup")}${link("/you", "You")}</nav></div>`;
  updateOffline();
  on("offline-retry", () => {
    offlineText = "Preparing offline core\u2026";
    updateOffline();
    void offlineStatus(true);
  });
}
function doc() {
  return readDoc(localStorage);
}
function write(change) {
  const data = doc();
  localStorage.setItem(SAVE, JSON.stringify(change(data)));
}
function paths(data) {
  if (!isMap(data.localPaths)) data.localPaths = { version: 1, reviews: {}, units: {} };
  if (data.localPaths.version !== 1 || !isMap(data.localPaths.reviews) || !isMap(data.localPaths.units)) throw Error("Local paths data is incompatible. Export a backup before proceeding.");
  return data.localPaths;
}
function enroll(row) {
  write((data) => {
    const hlr = isMap(data.hlr) ? data.hlr : {};
    if (!hlr[row.key]) hlr[row.key] = { conceptId: row.key, halfLifeHours: 24, totalReviews: 0, consecutiveCorrect: 0, lastReviewDate: (/* @__PURE__ */ new Date()).toISOString(), nextReviewDate: (/* @__PURE__ */ new Date()).toISOString() };
    data.hlr = hlr;
    return data;
  });
}
function record(row, answer, correct) {
  write((data) => {
    const p = paths(data), reviews = p.reviews, old = isMap(reviews[row.key]) ? reviews[row.key] : {};
    reviews[row.key] = { ...old, answer, correct, at: (/* @__PURE__ */ new Date()).toISOString(), attempts: Number(old.attempts || 0) + 1 };
    const mastery = isMap(data.mastery) ? data.mastery : {}, previous = isMap(mastery[row.key]) ? mastery[row.key] : { passive: 0, active: 0 };
    mastery[row.key] = { ...previous, active: Number(previous.active || 0) + (correct ? 1 : 0) };
    data.mastery = mastery;
    const hlr = isMap(data.hlr) ? data.hlr : {}, before = isMap(hlr[row.key]) ? hlr[row.key] : {};
    const halfLife = Math.max(0.5, Math.min(8760, Number(before.halfLifeHours || 24) * (correct ? 1.8 : 0.5))), now = /* @__PURE__ */ new Date();
    hlr[row.key] = { ...before, conceptId: row.key, halfLifeHours: halfLife, lastReviewDate: now.toISOString(), totalReviews: Number(before.totalReviews || 0) + 1, consecutiveCorrect: correct ? Number(before.consecutiveCorrect || 0) + 1 : 0, nextReviewDate: new Date(now.getTime() + halfLife * -Math.log2(0.85) * 36e5).toISOString() };
    data.hlr = hlr;
    return data;
  });
}
var all = [];
function support(item) {
  return doc().ui === "es" ? item.item.es : item.item.en;
}
function picker() {
  shell("Where will you go today?", `<p class="lead">Choose freely each time. Learning language and support language are separate.</p><div class="language-grid">${Object.entries(languages).map(([id, l]) => link(`/language/${id}`, `${l.title} \u2192`, "language-card") + `<p class="scope scope-${id}">${escape(l.scope)}</p>`).join("")}</div><section class="panel"><h2>Your original collection</h2><p>All original lesson content remains available. Language pages put activities in their language context.</p>${link("/", "Device sign-in / setup")}${link("/calendar", "Original calendar")}</section>`);
}
function language(id) {
  const language2 = languages[id];
  if (!language2) {
    picker();
    return;
  }
  const available = forLanguage(all, id);
  const body = id === "tn" ? `<section class="panel"><h2>An honest starting point</h2><p>Tunisian Arabic (Derja) and Modern Standard Arabic are different learning contexts. This build has no verified Tunisian lesson corpus, native recordings, or Arabic reading unit.</p><p>No assessed course is offered here. Generic Arabic TTS or dictation would not establish Tunisian pronunciation accuracy.</p><p>You can choose this context at any time; it is not locked behind another language.</p></section>` : `${id === "fr" ? `<section class="panel accent"><p class="eyebrow">ORIGINAL \xB7 INTEGRATED UNIT 01</p><h2>A programmer\u2019s introduction</h2><p>Meet a colleague, describe a systems and AI company, and repair a misunderstanding.</p>${link("/series/fr/intro", "Start French unit", "action")}</section>` : ""}<section class="panel"><h2>${id === "pt" || id === "it" ? "Social-scene sampler" : "Practice in context"}</h2><p>${available.length} locally available items. Existing indices and progress identities stay intact.</p>${id === "pt" ? "<p>Portugal text selection. Inherited phonetic hints and unverified media are omitted. Audio requires an exact pt-PT voice; no pt-BR fallback.</p>" : ""}${link(`/practice/${id}`, "Start text practice", "action")}${link(`/review-local?language=${id}`, "Review this language")}</section>${id === "de" || id === "fr" ? `<section class="panel"><h2>Original lessons</h2><p>Existing lesson engine and saved progress.</p>${link(`/t/${id}`, "Browse original lessons")}${link(`/play/${id}/${id === "de" ? "m1" : "fh1"}`, "Open original first lesson")}${id === "de" ? `${link("/lego", "German sentence frames")}${link("/mission", "German missions")}${link("/listen", "German listening support")}${link("/slang", "German slang practice")}` : ""}</section>` : ""}<details class="panel"><summary>Preserved mixed collection</summary><p>Original multilingual social/flirt scenes are retained with original progress keys. These are situational lines, not a full language course. Select a language above for filtered practice.</p>${link("/t/flirt", "Original mixed scenes")}</details>`;
  shell(language2.title, `<p class="lead">${escape(language2.scope)}</p>${body}${id === "de" ? `<section class="panel"><h2>Optional Berlin context clip</h2><p>Existing muted stock context, not a spoken lesson or an improvised conversation. Text exercises do not depend on this video.</p>${button("load-context-video", "Load optional context clip")}<video id="context-video" controls muted playsinline preload="none" hidden aria-label="Optional Berlin context clip"></video><p id="media-status" role="status"></p><p>Faktenwiki \xB7 CC BY-SA 4.0. Existing attribution: video/CREDITS.md.</p></section>` : ""}${link("/today", "Choose another language")}`);
  on("load-context-video", () => {
    const video = document.getElementById("context-video");
    const status = document.getElementById("media-status");
    status.textContent = "Loading optional context\u2026";
    video.hidden = false;
    video.onerror = () => {
      status.textContent = "Optional video unavailable. Continue with local text practice.";
    };
    video.onloadeddata = () => {
      status.textContent = "Included context loaded. Playback is optional.";
    };
    video.src = BASE + "/video/ubahn.mp4";
    video.load();
  });
}
function practice(id, review = false, originalLesson) {
  const chosen = new URLSearchParams(location.search).get("language");
  let collection = review ? [...all, ...pilot].filter((r) => {
    const data = doc(), p = isMap(data.localPaths) ? data.localPaths : {}, reviews = isMap(p.reviews) ? p.reviews : {};
    return (r.key in reviews || isMap(data.hlr) && r.key in data.hlr) && (!chosen || r.item.lang === chosen);
  }) : originalLesson ? all.filter((r) => r.track === "flirt" && r.lesson === originalLesson) : forLanguage(all, id);
  if (review) collection.sort((a, b) => {
    const hlr = doc().hlr || {};
    const date = (key) => isMap(hlr[key]) ? Date.parse(hlr[key].nextReviewDate) || 0 : 0;
    return date(a.key) - date(b.key);
  });
  let index = 0, revealed = false, checked = false;
  function render() {
    const row = collection[index];
    if (!row) {
      shell(review ? "Local review" : "Practice complete", `<section class="panel"><p>${collection.length ? "Session complete. Your answers are saved locally." : "No saved items in this language yet. Complete a practice answer or the French unit, then return here."}</p>${link("/today", "Choose a language")}${link("/review-local", "Open saved review")}</section>`);
      return;
    }
    shell(review ? "Local review" : originalLesson ? "Preserved social scene" : `${languages[id]?.title || "Portugal"} practice`, `${originalLesson ? "<p>Original scene, in its original item order. Text practice preserves its saved review identities. Portuguese audio requires pt-PT; inherited phonetic hints are omitted.</p>" : ""}<p>${index + 1} / ${collection.length} \xB7 ${escape(row.title)} \xB7 ${escape(row.item.lang === "pt" ? "pt-PT text" : row.item.lang)}</p><section class="panel"><p class="eyebrow">${review ? "RETRIEVE IT FIRST" : "READ THE SITUATION"}</p><h2>${escape(support(row))}</h2><p>Write the learning-language line. This checks text recall, not pronunciation.</p><label>Your answer<textarea id="answer" lang="${row.item.lang}" autocomplete="off" spellcheck="false"></textarea></label><div class="actions">${button("check", "Check and save", "primary")}${button("reveal", "Reveal help")}${button("hear", "Listen \xB7 system TTS")}</div><p id="result" role="status"></p><div id="help" ${revealed ? "" : "hidden"}><p class="utterance" lang="${row.item.lang}">${escape(row.item.say)}</p><p>${escape(row.item.lang === "pt" ? "Portugal text practice; no inherited phonetic hint." : row.item.why)}</p></div>${button("next", "Next item")}</section>${link(`/language/${row.item.lang}`, "Back to language")}`);
    on("reveal", () => {
      revealed = true;
      document.getElementById("help").hidden = false;
    });
    on("hear", () => speak(row.item.say, row.item.lang, notice));
    on("check", () => {
      const answer = value("answer");
      if (!answer.trim()) {
        notice("Write an answer first.");
        return;
      }
      const correct = normalize(answer) === normalize(row.item.say);
      record(row, answer, correct);
      checked = true;
      document.getElementById("result").textContent = correct ? "Matched \xB7 saved for review." : "Not matched yet \xB7 attempt saved. Reveal help, then try again.";
    });
    on("next", () => {
      if (!checked) {
        notice("Check and save an attempt before continuing.");
        return;
      }
      index++;
      revealed = checked = false;
      render();
    });
  }
  render();
}
function frenchUnit() {
  const data = doc(), p = isMap(data.localPaths) ? data.localPaths : {}, units = isMap(p.units) ? p.units : {}, saved = isMap(units["fr-intro-v1"]) ? units["fr-intro-v1"] : {};
  let stage = Number(saved.stage || 0), draft = String(saved.draft || ""), revealed = false, understood = false, produced = false, dialogue = 0, repair = false;
  const persist = (completed = false) => write((d) => {
    const p2 = paths(d), units2 = p2.units, previous = isMap(units2["fr-intro-v1"]) ? units2["fr-intro-v1"] : {};
    units2["fr-intro-v1"] = { ...previous, stage, draft, completed: completed || previous.completed === true };
    return d;
  });
  function render() {
    let body = "";
    if (stage === 0) body = `<h2>1 \xB7 Meet Alex</h2><p>You meet a colleague at a professional event. Alex introduces a systems and AI company. Read the French scene or try system audio before looking at help.</p><blockquote lang="fr">${pilot.slice(0, 4).map((r) => escape(r.item.say)).join(" ")}</blockquote><p>Alex is an example name. You will write your own version later.</p>${button("listen", "Listen to scene \xB7 system TTS")}${button("advance", "Try understanding", "primary")}`;
    if (stage === 1) body = `<h2>2 \xB7 Attempt understanding</h2><p>What does Alex\u2019s company do?</p><div class="choices">${button("understand-wrong", "It runs a restaurant")}${button("understand-right", "It develops systems and AI tools")}</div><p id="understanding" role="status"></p>${button("translation", "Reveal translation and help")}<div id="translation-help" hidden>${pilot.slice(0, 4).map((r) => `<p lang="fr">${escape(r.item.say)}</p><p>${escape(support(r))}</p>`).join("")}<p>Je suis = I am. Je travaille dans = I work in. Nous d\xE9veloppons = we develop. Programmeuse is the feminine form of programmeur.</p></div>${button("advance", "Read and produce", "primary")}`;
    if (stage === 2) body = `<h2>3 \xB7 Make it yours</h2><p>Read the model, then introduce yourself in French with your name, programmer role, and a company working with systems and AI. An example company is enough; do not enter client information.</p><details><summary>French writing model</summary><p lang="fr">${pilot.slice(0, 4).map((r) => escape(r.item.say)).join(" ")}</p></details><label>Your French introduction<textarea id="production" lang="fr" rows="6">${escape(draft)}</textarea></label>${button("save-draft", "Save draft")}${button("produce", "Check introduction and save", "primary")}<p id="production-result" role="status"></p><p>Checks look for the key ideas in text. They are not a grammar grade or pronunciation score.</p>${button("advance", "Join the conversation", "primary")}`;
    if (stage === 3) {
      const prompts = ["Bonjour ! Vous travaillez dans quel domaine ?", "Ah, vous vendez des ordinateurs ?", "D\u2019accord. Sur quoi travaillez-vous en ce moment ?"];
      body = `<h2>4 \xB7 Participate</h2><p>Authored branching dialogue. The characters follow written branches; no video actor or AI improvisation is involved.</p><blockquote lang="fr">${escape(prompts[dialogue])}</blockquote><details><summary>English / Spanish help</summary><p>${["Hello! What field do you work in? / \xA1Hola! \xBFEn qu\xE9 sector trabaja?", "Oh, you sell computers? / Ah, \xBFvende ordenadores?", "Understood. What are you working on at the moment? / \xBFEn qu\xE9 trabaja ahora?"][dialogue]}</p></details><div id="dialogue-feedback" role="status"></div><div class="choices">${dialogue === 0 ? `${button("good", "Je suis programmeur. Je travaille dans les syst\xE8mes et l\u2019intelligence artificielle.")}${button("negative", "Je voudrais un caf\xE9.")}` : dialogue === 1 ? `${button("good", "Pas exactement. Nous d\xE9veloppons des logiciels et des outils d\u2019IA.")}${button("negative", "Oui, c\u2019est \xE7a.")}` : `${button("good", "Nous d\xE9veloppons un outil pour les entreprises. Et vous ?")}${button("negative", "Je ne travaille jamais.")}`}${button("repair", "Pouvez-vous r\xE9p\xE9ter plus lentement, s\u2019il vous pla\xEEt ?")}</div><p id="repair-help"></p>`;
    }
    if (stage >= 4) body = `<h2>5 \xB7 Ready to retrieve</h2><p>You introduced your work and clarified a misunderstanding. Six French lines are now in local review.</p><p>Your introduction:</p><blockquote lang="fr">${escape(draft)}</blockquote>${link("/review-local?language=fr", "Review French now", "action")}${button("restart", "Practise the scene again")}`;
    shell("A programmer\u2019s introduction", `<p class="lead">French \xB7 original unit \xB7 ${Math.min(stage + 1, 5)} / 5</p><section class="panel accent">${body}</section>${link("/language/fr", "Back to French")}`);
    on("listen", () => speak(pilot.slice(0, 4).map((r) => r.item.say).join(" "), "fr", notice));
    on("understand-wrong", () => {
      understood = true;
      document.getElementById("understanding").textContent = "That is not the company described. Look for syst\xE8mes and intelligence artificielle. Try again or reveal help.";
    });
    on("understand-right", () => {
      understood = true;
      document.getElementById("understanding").textContent = "Yes: systems and AI tools. Now reveal the translation to check the details.";
    });
    on("translation", () => {
      if (!understood) {
        notice("Make an understanding attempt before revealing help.");
        return;
      }
      revealed = true;
      document.getElementById("translation-help").hidden = false;
    });
    on("save-draft", () => {
      draft = value("production");
      persist();
      notice("Draft saved locally.");
    });
    on("produce", () => {
      draft = value("production");
      const n = normalize(draft);
      produced = /je mappelle|mon nom|je suis/.test(n) && /programmeu|developpeu/.test(n) && /systeme/.test(n) && /intelligence artificielle|\bia\b/.test(n);
      persist();
      document.getElementById("production-result").textContent = produced ? "Key ideas found \xB7 saved. You can join the conversation." : "Draft saved. Include an introduction, programmer role, systems, and AI. Open the model for help.";
    });
    on("advance", () => {
      if (stage === 1 && (!understood || !revealed)) {
        notice("Attempt understanding and reveal help before continuing.");
        return;
      }
      if (stage === 2 && !produced) {
        notice("Check your introduction before joining the conversation.");
        return;
      }
      stage++;
      persist();
      render();
    });
    on("negative", () => {
      repair = true;
      document.getElementById("dialogue-feedback").textContent = dialogue === 1 ? "Misunderstanding: the colleague now thinks you sell computers. Repair the meaning before continuing." : "The reply does not explain your work. Try a relevant reply or ask for repetition.";
    });
    on("repair", () => {
      repair = true;
      document.getElementById("repair-help").textContent = ["Bien s\xFBr. Quel est votre m\xE9tier ? \u2014 What is your job?", "Je demande si votre entreprise vend du mat\xE9riel. \u2014 I\u2019m asking whether your company sells hardware.", "Quel projet d\xE9veloppez-vous maintenant ? \u2014 What project are you developing now?"][dialogue];
      document.getElementById("dialogue-feedback").textContent = "Repair branch: the colleague rephrases. Choose the reply that explains your work.";
    });
    on("good", () => {
      if (dialogue === 1 && repair) notice("Meaning repaired: software and AI tools, not computer sales.");
      dialogue++;
      repair = false;
      if (dialogue === 3) {
        stage = 4;
        for (const row of pilot) enroll(row);
        persist(true);
      }
      render();
      if (dialogue > 0 && dialogue < 3) notice("Reply accepted. The colleague continues.");
    });
    on("restart", () => {
      stage = 0;
      dialogue = 0;
      persist();
      render();
    });
  }
  render();
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" })), a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function summary(data) {
  return `${Object.keys(isMap(data.sit) ? data.sit : {}).length} lesson records \xB7 ${Number(data.xp || 0)} XP \xB7 ${Object.keys(isMap(data.hlr) ? data.hlr : {}).length} review records \xB7 ${Object.keys(isMap(data.localPaths) && isMap(data.localPaths.reviews) ? data.localPaths.reviews : {}).length} local answers`;
}
function backup() {
  let plan;
  let currentSummary;
  try {
    currentSummary = summary(doc());
  } catch (err) {
    currentSummary = `Current progress cannot be read: ${err.message} Raw export and stored recovery remain available.`;
  }
  shell("Safe backup & restore", `<p class="lead">Your data stays in this browser. Import replaces this device\u2019s save only after a preview and your confirmation. Close other Sprechen tabs before importing or restoring.</p><section class="panel"><h2>Export</h2><p>${escape(currentSummary)}</p>${button("export", "Export Sprechen backup", "primary")}${button("raw-export", "Download raw current documents")}${button("recovery-export", "Download pre-import recovery")}</section><section class="panel"><h2>Import</h2><label>Choose a Sprechen JSON file<input id="backup-file" type="file" accept="application/json,.json"></label><label>Or paste backup JSON<textarea id="backup-json" rows="5" spellcheck="false"></textarea></label>${button("preview", "Validate and preview", "primary")}<p id="backup-error" role="alert"></p><div id="preview-area"></div></section><section class="panel"><h2>Recover previous device data</h2><p>The last pre-import snapshot contains the exact current and legacy documents, including archived migration progress. Recovery also requires a preview and confirmation.</p>${button("undo-preview", "Preview recovery")}<div id="undo-area"></div></section>`);
  const error = (err) => {
    document.getElementById("backup-error").textContent = err.message;
  };
  on("export", () => {
    try {
      download(exportBackup(doc()), "sprechen-backup-v1.json");
      notice("Backup exported.");
    } catch (err) {
      error(err);
    }
  });
  on("raw-export", () => {
    download(JSON.stringify({ format: "sprechen-raw-documents", version: 1, documents: Object.fromEntries([SAVE, ...LEGACY, RECOVERY, JOURNAL].map((k) => [k, localStorage.getItem(k)])) }, null, 2), "sprechen-raw-current.json");
  });
  on("recovery-export", () => {
    try {
      download(recoveryPlan(localStorage).recoveryRaw, "sprechen-pre-import-recovery.json");
    } catch (err) {
      error(err);
    }
  });
  document.getElementById("backup-file").addEventListener("change", async (event) => {
    plan = void 0;
    document.getElementById("preview-area").innerHTML = "";
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 1e7) {
        error(Error("Backup exceeds 10 MB."));
        return;
      }
      document.getElementById("backup-json").value = await file.text();
    }
  });
  document.getElementById("backup-json").addEventListener("input", () => {
    plan = void 0;
    document.getElementById("preview-area").innerHTML = "";
  });
  on("preview", () => {
    plan = void 0;
    document.getElementById("preview-area").innerHTML = "";
    document.getElementById("backup-error").textContent = "";
    try {
      plan = prepareImport(value("backup-json"), localStorage);
      document.getElementById("preview-area").innerHTML = `<div class="preview"><h3>Replacement preview</h3><p>Current: ${escape(summary(plan.replaced.from))}</p><p>Incoming: ${escape(summary(plan.data))}</p><p>Name: ${escape(plan.replaced.from.name)} \u2192 ${escape(plan.data.name)}. Support: ${escape(plan.replaced.from.ui)} \u2192 ${escape(plan.data.ui)}.</p><p>All current save fields will be replaced with the validated incoming fields. This device\u2019s existing secret is retained. Old migration progress is archived in recovery and quarantined; legacy preferences and account metadata remain.</p><details><summary>Inspect all incoming fields</summary><pre>${escape(JSON.stringify(plan.data, null, 2))}</pre></details><details><summary>Inspect current fields being replaced</summary><pre>${escape(JSON.stringify(plan.replaced.from, null, 2))}</pre></details>${button("confirm-import", "Confirm replacement", "danger")}${button("cancel-import", "Cancel import")}</div>`;
      on("cancel-import", () => {
        plan = void 0;
        document.getElementById("preview-area").innerHTML = "";
        notice("Import cancelled. No data was written.");
      });
      on("confirm-import", () => {
        try {
          if (!plan) throw Error("Preview required.");
          commitImport(plan, localStorage, true);
          plan = void 0;
          document.getElementById("preview-area").innerHTML = "";
          notice("Import complete. Pre-import recovery is available.");
        } catch (err) {
          error(err);
        }
      });
    } catch (err) {
      error(err);
    }
  });
  on("undo-preview", () => {
    try {
      const raw = recoveryPlan(localStorage);
      document.getElementById("undo-area").innerHTML = `<div class="preview"><h3>Recovery preview</h3><p>Restore the exact pre-import save and ${LEGACY.length} legacy migration documents. Changes made since that import will be replaced. Close other Sprechen tabs before restoring.</p><details><summary>Inspect recovery documents</summary><pre>${escape(JSON.stringify(raw.before, null, 2))}</pre></details><details><summary>Inspect current raw documents being replaced</summary><pre>${escape(JSON.stringify(raw.current, null, 2))}</pre></details>${button("undo-confirm", "Confirm recovery", "danger")}${button("undo-cancel", "Cancel recovery")}</div>`;
      on("undo-cancel", () => {
        document.getElementById("undo-area").innerHTML = "";
        notice("Recovery cancelled. No data was written.");
      });
      on("undo-confirm", () => {
        try {
          undoImport(localStorage, true, raw);
          document.getElementById("undo-area").innerHTML = "";
          notice("Pre-import data restored.");
        } catch (err) {
          error(err);
        }
      });
    } catch (err) {
      error(err);
    }
  });
}
function profile() {
  const data = doc();
  shell("You & this device", `<p class="lead">${escape(summary(data))}</p><section class="panel"><h2>Profile & preferences</h2><label>Name<input id="profile-name" value="${escape(data.name)}"></label><label>Support language<select id="profile-ui"><option value="en" ${data.ui === "en" ? "selected" : ""}>English</option><option value="es" ${data.ui === "es" ? "selected" : ""}>Espa\xF1ol</option></select></label><p>Navigation uses English. This setting changes translation help; it does not select a learning language.</p><label>Daily minutes<input id="profile-goal" type="number" min="1" max="180" value="${escape(data.goal || 10)}"></label>${button("profile-save", "Save preferences", "primary")}</section><section class="panel"><h2>Device account</h2><p>The original name and secret screen is a device-local gate. There is no cloud account or new service. Your established secret is retained during import.</p>${link("/", "Original sign-in")}${link("/setup", "Original setup")}${link("/themes", "Original appearance settings")}${link("/companions", "Original companions")}</section><section class="panel"><h2>Data</h2>${link("/backup-safe", "Safe export / import / recovery", "action")}</section>`);
  on("profile-save", () => {
    const goal = Number(value("profile-goal"));
    if (!Number.isFinite(goal) || goal < 1 || goal > 180) {
      notice("Daily minutes must be between 1 and 180.");
      return;
    }
    write((d) => ({ ...d, name: value("profile-name").trim(), ui: value("profile-ui"), goal }));
    notice("Preferences saved.");
  });
}
async function main() {
  const path = currentPath();
  try {
    assertResolved(localStorage);
  } catch (err) {
    backup();
    notice(err.message);
    return;
  }
  if (!owned(path)) {
    await import(
      /* @vite-ignore */
      "/sprechen/assets/legacy-0a6805017f71a194.js"
    );
    const nav = document.createElement("aside");
    nav.className = "legacy-return";
    nav.innerHTML = link("/today", "Languages \u2197");
    document.body.append(nav);
    return;
  }
  try {
    if (["/backup-safe", "/backup"].includes(path)) {
      backup();
      return;
    }
    if (path === "/you") {
      profile();
      return;
    }
    const response = await fetch(BASE + "/course.json");
    if (!response.ok) throw Error("Local course unavailable. Prepare offline while online and retry.");
    all = rows(await response.json());
    if (/^\/(today|map)$/.test(path)) picker();
    else if (path.startsWith("/language/")) language(path.split("/")[2]);
    else if (/^\/t\/(pt|it)/.test(path)) language(path.split("/")[2]);
    else if (path.startsWith("/play/flirt/")) practice("pt", false, path.split("/")[3]);
    else if (path.startsWith("/practice/")) practice(path.split("/")[2]);
    else if (path === "/review-local" || path === "/review") practice("", true);
    else if (path === "/series/fr/intro") frenchUnit();
    else if (["/backup-safe", "/backup"].includes(path)) backup();
    else if (path === "/you") profile();
    else picker();
  } catch (err) {
    shell("Unable to open this path", `<p role="alert">${escape(err.message)}</p>${link("/today", "Return to languages")}`);
  }
}
void main();
