import { SAVE, RECOVERY, JOURNAL, LEGACY, assertResolved, isMap, readDoc, prepareImport, commitImport, exportBackup, recoveryPlan, undoImport, type Doc, type ImportPlan } from './backup.ts';
import { rows, pilot, forLanguage, normalize, type Course, type Row } from './course.ts';
import { guardLegacySpeech, speak } from './voice.ts';
declare const LEGACY_MODULE: string;
declare const EXPECTED_BUILD: string;
const BASE = '/sprechen';
const root = document.getElementById('root')!;
root.dataset.build = EXPECTED_BUILD;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const link = (path: string, text: string, cls = '') => `<a class="${cls}" href="${BASE}${path}">${escape(text)}</a>`;
const button = (id: string, text: string, cls = '') => `<button type="button" id="${id}" class="${cls}">${escape(text)}</button>`;
const on = (id: string, callback: (event: Event) => void) => document.getElementById(id)?.addEventListener('click', event => {
  try { callback(event); } catch (err) { notice(`Action could not finish: ${(err as Error).message}`); }
});
const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
const languages: Record<string, { title: string; scope: string }> = {
  de: { title: 'Deutsch', scope: 'Existing German lessons + local practice. All paths open.' },
  fr: { title: 'Français', scope: 'Start with an integrated introduction, or revisit the existing French lessons.' },
  pt: { title: 'Português · Portugal', scope: 'Five selected text items from the existing mixed social scenes. Portugal only; a practice sampler, not a full course.' },
  it: { title: 'Italiano', scope: 'Eleven existing items from mixed social scenes. A practice sampler, not a full course.' },
  tn: { title: 'Tunisian / Arabic context', scope: 'Resource state only. No verified Tunisian teaching or assessed audio is included yet.' }
};
// Match the compatibility router's basename and one-pass segment decoding. Encoded slashes
// remain segment content. Only static route names are folded; data identities keep their case.
function routePath(pathname: string): string | null {
  if (!/^\/sprechen(?:\/|$)/i.test(pathname)) return null;
  let path = pathname.slice(BASE.length);
  try { path = path.split('/').map(segment => decodeURIComponent(segment).replace(/\//g, '%2F')).join('/'); } catch { /* legacy also retains malformed encodings */ }
  const parts = (path.replace(/\/+$/, '') || '/').split('/');
  parts[1] = parts[1].toLowerCase();
  return parts.join('/');
}
const currentPath = () => routePath(location.pathname) || '/';
function owned(path: string): boolean {
  return /^\/(today|map|language|practice|series|backup-safe|backup|you|review-local|review)(\/|$)/.test(path) || /^\/t\/(pt|it)(\/|$)/.test(path) || /^\/play\/flirt\/(rp1|rp2|fd2)$/.test(path);
}
function notice(text: string) {
  let box = document.getElementById('notice');
  if (!box) { box = document.createElement('div'); box.id = 'notice'; box.setAttribute('role', 'status'); box.className = 'legacy-notice'; document.body.append(box); }
  box.textContent = text;
}
guardLegacySpeech(notice);
// React Router's public History API is the single bridge out of the compatibility engine.
const originalPush = history.pushState.bind(history), originalReplace = history.replaceState.bind(history);
function maintainedURL(target: URL): URL | null {
  const path = routePath(target.pathname);
  if (target.origin !== location.origin || path === null || !owned(path)) return null;
  const canonical = new URL(target); canonical.pathname = BASE + path;
  return canonical;
}
// Canonicalize before any compatibility module can mount; retain query/hash verbatim.
const initialURL = maintainedURL(new URL(location.href));
if (initialURL && initialURL.href !== location.href) originalReplace(history.state, '', initialURL);
for (const method of ['pushState', 'replaceState'] as const) {
  const original = method === 'pushState' ? originalPush : originalReplace;
  history[method] = (data: unknown, unused: string, url?: string | URL | null) => {
    if (url != null) {
      const target = maintainedURL(new URL(url, location.href));
      if (target) {
        if (method === 'replaceState') location.replace(target.href); else location.assign(target.href);
        return;
      }
    }
    original(data, unused, url);
  };
}
window.addEventListener('popstate', event => {
  const target = maintainedURL(new URL(location.href));
  if (target) { event.stopImmediatePropagation(); location.replace(target.href); }
}, true);
document.addEventListener('click', event => {
  const mouse = event as MouseEvent;
  if (mouse.button || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey || mouse.altKey) return;
  const a = (event.target as Element)?.closest('a');
  if (!a || a.target || a.hasAttribute('download')) return;
  const target = maintainedURL(new URL(a.href));
  if (target) {
    event.preventDefault(); event.stopImmediatePropagation(); location.assign(target.href);
  }
}, true);

let offlineText = 'Preparing offline core…';
let offlineRegistration: ServiceWorkerRegistration | undefined, offlineSequence = 0, installFailed = false;
const watchedWorkers = new WeakSet<ServiceWorker>();
type WorkerStatus = { ready: boolean; version: string; missing?: string[]; error?: string };
function workerMessage(worker: ServiceWorker, message: string): Promise<WorkerStatus> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), timer = setTimeout(() => { channel.port1.close(); reject(Error('Offline status unavailable.')); }, message === 'REPAIR' ? 25000 : 5000);
    channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data); };
    worker.postMessage(message, [channel.port2]);
  });
}
async function refreshOffline() {
  const sequence = ++offlineSequence, registration = offlineRegistration;
  if (!registration) return;
  try {
    if (registration.waiting) {
      const candidate = registration.waiting;
      const candidateStatus = await workerMessage(candidate, 'STATUS');
      if (candidateStatus.version === 'sprechen-core-' + EXPECTED_BUILD && candidateStatus.ready) candidate.postMessage('ACTIVATE');
    }
    const worker = registration.active;
    const status = worker ? await workerMessage(worker, 'STATUS') : undefined;
    if (sequence !== offlineSequence) return;
    if (status?.version === 'sprechen-core-' + EXPECTED_BUILD && status.ready) {
      offlineText = 'Offline ready · core lessons and text practice saved on this device';
    } else if (status?.version !== undefined && status.version !== 'sprechen-core-' + EXPECTED_BUILD) {
      offlineText = `${status.ready ? 'Previous version available' : 'Other version incomplete'} · this loaded build offline preparation ${installFailed ? 'failed. Reconnect and retry.' : registration.installing || registration.waiting ? 'in progress…' : 'incomplete. Reconnect and retry.'}`;
    } else {
      offlineText = installFailed ? 'Offline preparation failed. Reconnect and retry.' : registration.installing ? 'Preparing offline core for this loaded build…' : 'Offline preparation incomplete. Reconnect and retry.';
    }
  } catch (err) { if (sequence === offlineSequence) offlineText = `Offline preparation failed: ${(err as Error).message}`; }
  updateOffline();
}
function observeOffline(registration: ServiceWorkerRegistration) {
  const watch = (worker: ServiceWorker | null) => {
    if (!worker || watchedWorkers.has(worker)) return;
    watchedWorkers.add(worker);
    const timer = setTimeout(() => { if (worker.state === 'installing' || worker.state === 'installed') { installFailed = true; void refreshOffline(); } }, 25000);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') clearTimeout(timer);
      if (worker.state === 'redundant') installFailed = true;
      void refreshOffline();
    });
  };
  watch(registration.installing); watch(registration.waiting);
  registration.addEventListener('updatefound', () => { installFailed = false; watch(registration.installing); void refreshOffline(); });
}
async function offlineStatus(retry = false) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { offlineText = 'Offline preparation unavailable: use HTTPS or localhost.'; updateOffline(); return; }
  try {
    const registration = await navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' });
    if (offlineRegistration !== registration) { offlineRegistration = registration; observeOffline(registration); }
    if (retry) {
      installFailed = false;
      await registration.update();
      const worker = registration.active;
      if (worker) {
        const status = await workerMessage(worker, 'STATUS');
        if (status.version === 'sprechen-core-' + EXPECTED_BUILD && !status.ready) {
          const repaired = await workerMessage(worker, 'REPAIR');
          if (!repaired.ready) throw Error(repaired.error || 'Required core resources are still missing.');
        }
      }
    }
    await refreshOffline();
  } catch (err) { offlineText = `Offline preparation failed: ${(err as Error).message}`; }
  updateOffline();
}
function updateOffline() { const el = document.getElementById('offline-status'); if (el) el.textContent = `${navigator.onLine ? '' : 'Offline now · '}${offlineText}`; }
window.addEventListener('online', () => { updateOffline(); void refreshOffline(); });
window.addEventListener('offline', () => { updateOffline(); void refreshOffline(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshOffline(); });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => { void refreshOffline(); });
  navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'CORE_INCOMPLETE') void refreshOffline(); });
}
void offlineStatus();
function shell(title: string, body: string) {
  document.body.classList.add('local-paths');
  root.innerHTML = `<div class="paths-shell"><header class="paths-header">${link('/today', 'Sprechen', 'brand')}<span>LOCAL / NIGHT</span>${link('/you', 'You')}</header><main id="main"><p class="eyebrow">YOUR LANGUAGE, YOUR PATH</p><h1>${escape(title)}</h1>${body}<p id="notice" role="status"></p><aside class="offline-box"><p id="offline-status" role="status"></p>${button('offline-retry', 'Retry offline preparation', 'quiet')}<p>Text exercises and review work locally after preparation. System audio depends on installed voices. External support stays online.</p></aside></main><nav class="paths-nav" aria-label="Main">${link('/today', 'Languages')}${link('/review-local', 'Review')}${link('/backup-safe', 'Backup')}${link('/you', 'You')}</nav></div>`;
  updateOffline(); on('offline-retry', () => { offlineText = 'Preparing offline core…'; updateOffline(); void offlineStatus(true); });
}
function doc(): Doc { return readDoc(localStorage); }
function write(change: (data: Doc) => Doc) {
  const data = doc(); localStorage.setItem(SAVE, JSON.stringify(change(data)));
}
function paths(data: Doc): Doc {
  if (!isMap(data.localPaths)) data.localPaths = { version: 1, reviews: {}, units: {} };
  if (data.localPaths.version !== 1 || !isMap(data.localPaths.reviews) || !isMap(data.localPaths.units)) throw Error('Local paths data is incompatible. Export a backup before proceeding.');
  return data.localPaths as Doc;
}
function enroll(row: Row) {
  write(data => {
    const hlr = isMap(data.hlr) ? data.hlr : {};
    if (!hlr[row.key]) hlr[row.key] = { conceptId: row.key, halfLifeHours: 24, totalReviews: 0, consecutiveCorrect: 0, lastReviewDate: new Date().toISOString(), nextReviewDate: new Date().toISOString() };
    data.hlr = hlr; return data;
  });
}
function record(row: Row, answer: string, correct: boolean) {
  write(data => {
    const p = paths(data), reviews = p.reviews as Doc, old = isMap(reviews[row.key]) ? reviews[row.key] as Doc : {};
    reviews[row.key] = { ...old, answer, correct, at: new Date().toISOString(), attempts: Number(old.attempts || 0) + 1 };
    const mastery = isMap(data.mastery) ? data.mastery : {}, previous = isMap(mastery[row.key]) ? mastery[row.key] as Doc : { passive: 0, active: 0 };
    mastery[row.key] = { ...previous, active: Number(previous.active || 0) + (correct ? 1 : 0) }; data.mastery = mastery;
    const hlr = isMap(data.hlr) ? data.hlr : {}, before = isMap(hlr[row.key]) ? hlr[row.key] as Doc : {};
    const halfLife = Math.max(.5, Math.min(8760, Number(before.halfLifeHours || 24) * (correct ? 1.8 : .5))), now = new Date();
    hlr[row.key] = { ...before, conceptId: row.key, halfLifeHours: halfLife, lastReviewDate: now.toISOString(), totalReviews: Number(before.totalReviews || 0) + 1, consecutiveCorrect: correct ? Number(before.consecutiveCorrect || 0) + 1 : 0, nextReviewDate: new Date(now.getTime() + halfLife * -Math.log2(.85) * 3600000).toISOString() };
    data.hlr = hlr; return data;
  });
}
let all: Row[] = [];
function support(item: Row) { return doc().ui === 'es' ? item.item.es : item.item.en; }
function picker() {
  shell('Where will you go today?', `<p class="lead">Choose freely each time. Learning language and support language are separate.</p><div class="language-grid">${Object.entries(languages).map(([id, l]) => link(`/language/${id}`, `${l.title} →`, 'language-card') + `<p class="scope scope-${id}">${escape(l.scope)}</p>`).join('')}</div><section class="panel"><h2>Your original collection</h2><p>All original lesson content remains available. Language pages put activities in their language context.</p>${link('/', 'Device sign-in / setup')}${link('/calendar', 'Original calendar')}</section>`);
}
function language(id: string) {
  const language = languages[id]; if (!language) { picker(); return; }
  const available = forLanguage(all, id);
  const body = id === 'tn' ? `<section class="panel"><h2>An honest starting point</h2><p>Tunisian Arabic (Derja) and Modern Standard Arabic are different learning contexts. This build has no verified Tunisian lesson corpus, native recordings, or Arabic reading unit.</p><p>No assessed course is offered here. Generic Arabic TTS or dictation would not establish Tunisian pronunciation accuracy.</p><p>You can choose this context at any time; it is not locked behind another language.</p></section>` :
    `${id === 'fr' ? `<section class="panel accent"><p class="eyebrow">ORIGINAL · INTEGRATED UNIT 01</p><h2>A programmer’s introduction</h2><p>Meet a colleague, describe a systems and AI company, and repair a misunderstanding.</p>${link('/series/fr/intro', 'Start French unit', 'action')}</section>` : ''}<section class="panel"><h2>${id === 'pt' || id === 'it' ? 'Social-scene sampler' : 'Practice in context'}</h2><p>${available.length} locally available items. Existing indices and progress identities stay intact.</p>${id === 'pt' ? '<p>Portugal text selection. Inherited phonetic hints and unverified media are omitted. Audio requires an exact pt-PT voice; no pt-BR fallback.</p>' : ''}${link(`/practice/${id}`, 'Start text practice', 'action')}${link(`/review-local?language=${id}`, 'Review this language')}</section>${id === 'de' || id === 'fr' ? `<section class="panel"><h2>Original lessons</h2><p>Existing lesson engine and saved progress.</p>${link(`/t/${id}`, 'Browse original lessons')}${link(`/play/${id}/${id === 'de' ? 'm1' : 'fh1'}`, 'Open original first lesson')}${id === 'de' ? `${link('/lego', 'German sentence frames')}${link('/mission', 'German missions')}${link('/listen', 'German listening support')}${link('/slang', 'German slang practice')}` : ''}</section>` : ''}<details class="panel"><summary>Preserved mixed collection</summary><p>Original multilingual social/flirt scenes are retained with original progress keys. These are situational lines, not a full language course. Select a language above for filtered practice.</p>${link('/t/flirt', 'Original mixed scenes')}</details>`;
  shell(language.title, `<p class="lead">${escape(language.scope)}</p>${body}${id === 'de' ? `<section class="panel"><h2>Optional Berlin context clip</h2><p>Existing muted stock context, not a spoken lesson or an improvised conversation. Text exercises do not depend on this video.</p>${button('load-context-video', 'Load optional context clip')}<video id="context-video" controls muted playsinline preload="none" hidden aria-label="Optional Berlin context clip"></video><p id="media-status" role="status"></p><p>Faktenwiki · CC BY-SA 4.0. Existing attribution: video/CREDITS.md.</p></section>` : ''}${link('/today', 'Choose another language')}`);
  on('load-context-video', () => {
    const video = document.getElementById('context-video') as HTMLVideoElement;
    const status = document.getElementById('media-status')!;
    status.textContent = 'Loading optional context…'; video.hidden = false;
    video.onerror = () => { status.textContent = 'Optional video unavailable. Continue with local text practice.'; };
    video.onloadeddata = () => { status.textContent = 'Included context loaded. Playback is optional.'; };
    video.src = BASE + '/video/ubahn.mp4'; video.load();
  });
}
function practice(id: string, review = false, originalLesson?: string) {
  const chosen = new URLSearchParams(location.search).get('language');
  let collection = review ? [...all, ...pilot].filter(r => {
    const data = doc(), p = isMap(data.localPaths) ? data.localPaths : {}, reviews = isMap(p.reviews) ? p.reviews : {};
    return (r.key in reviews || (isMap(data.hlr) && r.key in data.hlr)) && (!chosen || r.item.lang === chosen);
  }) : originalLesson ? all.filter(r => r.track === 'flirt' && r.lesson === originalLesson) : forLanguage(all, id);
  if (review) collection.sort((a, b) => {
    const hlr = doc().hlr as Doc || {};
    const date = (key: string) => isMap(hlr[key]) ? Date.parse((hlr[key] as Doc).nextReviewDate as string) || 0 : 0;
    return date(a.key) - date(b.key);
  });
  let index = 0, revealed = false, checked = false;
  function render() {
    const row = collection[index];
    if (!row) {
      shell(review ? 'Local review' : 'Practice complete', `<section class="panel"><p>${collection.length ? 'Session complete. Your answers are saved locally.' : 'No saved items in this language yet. Complete a practice answer or the French unit, then return here.'}</p>${link('/today', 'Choose a language')}${link('/review-local', 'Open saved review')}</section>`); return;
    }
    shell(review ? 'Local review' : originalLesson ? 'Preserved social scene' : `${languages[id]?.title || 'Portugal'} practice`, `${originalLesson ? '<p>Original scene, in its original item order. Text practice preserves its saved review identities. Portuguese audio requires pt-PT; inherited phonetic hints are omitted.</p>' : ''}<p>${index + 1} / ${collection.length} · ${escape(row.title)} · ${escape(row.item.lang === 'pt' ? 'pt-PT text' : row.item.lang)}</p><section class="panel"><p class="eyebrow">${review ? 'RETRIEVE IT FIRST' : 'READ THE SITUATION'}</p><h2>${escape(support(row))}</h2><p>Write the learning-language line. This checks text recall, not pronunciation.</p><label>Your answer<textarea id="answer" lang="${row.item.lang}" autocomplete="off" spellcheck="false"></textarea></label><div class="actions">${button('check', 'Check and save', 'primary')}${button('reveal', 'Reveal help')}${button('hear', 'Listen · system TTS')}</div><p id="result" role="status"></p><div id="help" ${revealed ? '' : 'hidden'}><p class="utterance" lang="${row.item.lang}">${escape(row.item.say)}</p><p>${escape(row.item.lang === 'pt' ? 'Portugal text practice; no inherited phonetic hint.' : row.item.why)}</p></div>${button('next', 'Next item')}</section>${link(`/language/${row.item.lang}`, 'Back to language')}`);
    on('reveal', () => { revealed = true; document.getElementById('help')!.hidden = false; });
    on('hear', () => speak(row.item.say, row.item.lang, notice));
    on('check', () => {
      const answer = value('answer'); if (!answer.trim()) { notice('Write an answer first.'); return; }
      const correct = normalize(answer) === normalize(row.item.say);
      record(row, answer, correct); checked = true;
      document.getElementById('result')!.textContent = correct ? 'Matched · saved for review.' : 'Not matched yet · attempt saved. Reveal help, then try again.';
    });
    on('next', () => { if (!checked) { notice('Check and save an attempt before continuing.'); return; } index++; revealed = checked = false; render(); });
  }
  render();
}

function frenchUnit() {
  const data = doc(), p = isMap(data.localPaths) ? data.localPaths : {}, units = isMap(p.units) ? p.units : {}, saved = isMap(units['fr-intro-v1']) ? units['fr-intro-v1'] as Doc : {};
  let stage = Number(saved.stage || 0), draft = String(saved.draft || ''), revealed = false, understood = false, produced = false, dialogue = 0, repair = false;
  const persist = (completed = false) => write(d => { const p = paths(d), units = p.units as Doc, previous = isMap(units['fr-intro-v1']) ? units['fr-intro-v1'] as Doc : {}; units['fr-intro-v1'] = { ...previous, stage, draft, completed: completed || previous.completed === true }; return d; });
  function render() {
    let body = '';
    if (stage === 0) body = `<h2>1 · Meet Alex</h2><p>You meet a colleague at a professional event. Alex introduces a systems and AI company. Read the French scene or try system audio before looking at help.</p><blockquote lang="fr">${pilot.slice(0, 4).map(r => escape(r.item.say)).join(' ')}</blockquote><p>Alex is an example name. You will write your own version later.</p>${button('listen', 'Listen to scene · system TTS')}${button('advance', 'Try understanding', 'primary')}`;
    if (stage === 1) body = `<h2>2 · Attempt understanding</h2><p>What does Alex’s company do?</p><div class="choices">${button('understand-wrong', 'It runs a restaurant')}${button('understand-right', 'It develops systems and AI tools')}</div><p id="understanding" role="status"></p>${button('translation', 'Reveal translation and help')}<div id="translation-help" hidden>${pilot.slice(0, 4).map(r => `<p lang="fr">${escape(r.item.say)}</p><p>${escape(support(r))}</p>`).join('')}<p>Je suis = I am. Je travaille dans = I work in. Nous développons = we develop. Programmeuse is the feminine form of programmeur.</p></div>${button('advance', 'Read and produce', 'primary')}`;
    if (stage === 2) body = `<h2>3 · Make it yours</h2><p>Read the model, then introduce yourself in French with your name, programmer role, and a company working with systems and AI. An example company is enough; do not enter client information.</p><details><summary>French writing model</summary><p lang="fr">${pilot.slice(0, 4).map(r => escape(r.item.say)).join(' ')}</p></details><label>Your French introduction<textarea id="production" lang="fr" rows="6">${escape(draft)}</textarea></label>${button('save-draft', 'Save draft')}${button('produce', 'Check introduction and save', 'primary')}<p id="production-result" role="status"></p><p>Checks look for the key ideas in text. They are not a grammar grade or pronunciation score.</p>${button('advance', 'Join the conversation', 'primary')}`;
    if (stage === 3) {
      const prompts = ['Bonjour ! Vous travaillez dans quel domaine ?', 'Ah, vous vendez des ordinateurs ?', 'D’accord. Sur quoi travaillez-vous en ce moment ?'];
      body = `<h2>4 · Participate</h2><p>Authored branching dialogue. The characters follow written branches; no video actor or AI improvisation is involved.</p><blockquote lang="fr">${escape(prompts[dialogue])}</blockquote><details><summary>English / Spanish help</summary><p>${['Hello! What field do you work in? / ¡Hola! ¿En qué sector trabaja?', 'Oh, you sell computers? / Ah, ¿vende ordenadores?', 'Understood. What are you working on at the moment? / ¿En qué trabaja ahora?'][dialogue]}</p></details><div id="dialogue-feedback" role="status"></div><div class="choices">${dialogue === 0 ? `${button('good', 'Je suis programmeur. Je travaille dans les systèmes et l’intelligence artificielle.')}${button('negative', 'Je voudrais un café.')}` : dialogue === 1 ? `${button('good', 'Pas exactement. Nous développons des logiciels et des outils d’IA.')}${button('negative', 'Oui, c’est ça.')}` : `${button('good', 'Nous développons un outil pour les entreprises. Et vous ?')}${button('negative', 'Je ne travaille jamais.')}`}${button('repair', 'Pouvez-vous répéter plus lentement, s’il vous plaît ?')}</div><p id="repair-help"></p>`;
    }
    if (stage >= 4) body = `<h2>5 · Ready to retrieve</h2><p>You introduced your work and clarified a misunderstanding. Six French lines are now in local review.</p><p>Your introduction:</p><blockquote lang="fr">${escape(draft)}</blockquote>${link('/review-local?language=fr', 'Review French now', 'action')}${button('restart', 'Practise the scene again')}`;
    shell('A programmer’s introduction', `<p class="lead">French · original unit · ${Math.min(stage + 1, 5)} / 5</p><section class="panel accent">${body}</section>${link('/language/fr', 'Back to French')}`);
    on('listen', () => speak(pilot.slice(0, 4).map(r => r.item.say).join(' '), 'fr', notice));
    on('understand-wrong', () => { understood = true; document.getElementById('understanding')!.textContent = 'That is not the company described. Look for systèmes and intelligence artificielle. Try again or reveal help.'; });
    on('understand-right', () => { understood = true; document.getElementById('understanding')!.textContent = 'Yes: systems and AI tools. Now reveal the translation to check the details.'; });
    on('translation', () => { if (!understood) { notice('Make an understanding attempt before revealing help.'); return; } revealed = true; document.getElementById('translation-help')!.hidden = false; });
    on('save-draft', () => { draft = value('production'); persist(); notice('Draft saved locally.'); });
    on('produce', () => {
      draft = value('production'); const n = normalize(draft);
      produced = /je mappelle|mon nom|je suis/.test(n) && /programmeu|developpeu/.test(n) && /systeme/.test(n) && /intelligence artificielle|\bia\b/.test(n);
      persist(); document.getElementById('production-result')!.textContent = produced ? 'Key ideas found · saved. You can join the conversation.' : 'Draft saved. Include an introduction, programmer role, systems, and AI. Open the model for help.';
    });
    on('advance', () => {
      if (stage === 1 && (!understood || !revealed)) { notice('Attempt understanding and reveal help before continuing.'); return; }
      if (stage === 2 && !produced) { notice('Check your introduction before joining the conversation.'); return; }
      stage++; persist(); render();
    });
    on('negative', () => {
      repair = true; document.getElementById('dialogue-feedback')!.textContent = dialogue === 1 ? 'Misunderstanding: the colleague now thinks you sell computers. Repair the meaning before continuing.' : 'The reply does not explain your work. Try a relevant reply or ask for repetition.';
    });
    on('repair', () => {
      repair = true; document.getElementById('repair-help')!.textContent = ['Bien sûr. Quel est votre métier ? — What is your job?', 'Je demande si votre entreprise vend du matériel. — I’m asking whether your company sells hardware.', 'Quel projet développez-vous maintenant ? — What project are you developing now?'][dialogue];
      document.getElementById('dialogue-feedback')!.textContent = 'Repair branch: the colleague rephrases. Choose the reply that explains your work.';
    });
    on('good', () => {
      if (dialogue === 1 && repair) notice('Meaning repaired: software and AI tools, not computer sales.');
      dialogue++; repair = false;
      if (dialogue === 3) { stage = 4; for (const row of pilot) enroll(row); persist(true); }
      render();
      if (dialogue > 0 && dialogue < 3) notice('Reply accepted. The colleague continues.');
    });
    on('restart', () => { stage = 0; dialogue = 0; persist(); render(); });
  }
  render();
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function summary(data: Doc) { return `${Object.keys(isMap(data.sit) ? data.sit : {}).length} lesson records · ${Number(data.xp || 0)} XP · ${Object.keys(isMap(data.hlr) ? data.hlr : {}).length} review records · ${Object.keys(isMap(data.localPaths) && isMap(data.localPaths.reviews) ? data.localPaths.reviews : {}).length} local answers`; }
function backup() {
  let plan: ImportPlan | undefined;
  let currentSummary: string;
  try { currentSummary = summary(doc()); }
  catch (err) { currentSummary = `Current progress cannot be read: ${(err as Error).message} Raw export and stored recovery remain available.`; }
  shell('Safe backup & restore', `<p class="lead">Your data stays in this browser. Import replaces this device’s save only after a preview and your confirmation. Close other Sprechen tabs before importing or restoring.</p><section class="panel"><h2>Export</h2><p>${escape(currentSummary)}</p>${button('export', 'Export Sprechen backup', 'primary')}${button('raw-export', 'Download raw current documents')}${button('recovery-export', 'Download pre-import recovery')}</section><section class="panel"><h2>Import</h2><label>Choose a Sprechen JSON file<input id="backup-file" type="file" accept="application/json,.json"></label><label>Or paste backup JSON<textarea id="backup-json" rows="5" spellcheck="false"></textarea></label>${button('preview', 'Validate and preview', 'primary')}<p id="backup-error" role="alert"></p><div id="preview-area"></div></section><section class="panel"><h2>Recover previous device data</h2><p>The last pre-import snapshot contains the exact current and legacy documents, including archived migration progress. Recovery also requires a preview and confirmation.</p>${button('undo-preview', 'Preview recovery')}<div id="undo-area"></div></section>`);
  const error = (err: unknown) => { document.getElementById('backup-error')!.textContent = (err as Error).message; };
  on('export', () => { try { download(exportBackup(doc()), 'sprechen-backup-v1.json'); notice('Backup exported.'); } catch (err) { error(err); } });
  on('raw-export', () => { download(JSON.stringify({ format: 'sprechen-raw-documents', version: 1, documents: Object.fromEntries([SAVE, ...LEGACY, RECOVERY, JOURNAL].map(k => [k, localStorage.getItem(k)])) }, null, 2), 'sprechen-raw-current.json'); });
  on('recovery-export', () => { try { download(recoveryPlan(localStorage).recoveryRaw, 'sprechen-pre-import-recovery.json'); } catch (err) { error(err); } });
  document.getElementById('backup-file')!.addEventListener('change', async event => {
    plan = undefined; document.getElementById('preview-area')!.innerHTML = '';
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) { if (file.size > 10_000_000) { error(Error('Backup exceeds 10 MB.')); return; } (document.getElementById('backup-json') as HTMLTextAreaElement).value = await file.text(); }
  });
  document.getElementById('backup-json')!.addEventListener('input', () => { plan = undefined; document.getElementById('preview-area')!.innerHTML = ''; });
  on('preview', () => {
    plan = undefined; document.getElementById('preview-area')!.innerHTML = ''; document.getElementById('backup-error')!.textContent = '';
    try {
      plan = prepareImport(value('backup-json'), localStorage);
      document.getElementById('preview-area')!.innerHTML = `<div class="preview"><h3>Replacement preview</h3><p>Current: ${escape(summary(plan.replaced.from))}</p><p>Incoming: ${escape(summary(plan.data))}</p><p>Name: ${escape(plan.replaced.from.name)} → ${escape(plan.data.name)}. Support: ${escape(plan.replaced.from.ui)} → ${escape(plan.data.ui)}.</p><p>All current save fields will be replaced with the validated incoming fields. This device’s existing secret is retained. Old migration progress is archived in recovery and quarantined; legacy preferences and account metadata remain.</p><details><summary>Inspect all incoming fields</summary><pre>${escape(JSON.stringify(plan.data, null, 2))}</pre></details><details><summary>Inspect current fields being replaced</summary><pre>${escape(JSON.stringify(plan.replaced.from, null, 2))}</pre></details>${button('confirm-import', 'Confirm replacement', 'danger')}${button('cancel-import', 'Cancel import')}</div>`;
      on('cancel-import', () => { plan = undefined; document.getElementById('preview-area')!.innerHTML = ''; notice('Import cancelled. No data was written.'); });
      on('confirm-import', () => {
        try { if (!plan) throw Error('Preview required.'); commitImport(plan, localStorage, true); plan = undefined; document.getElementById('preview-area')!.innerHTML = ''; notice('Import complete. Pre-import recovery is available.'); } catch (err) { error(err); }
      });
    } catch (err) { error(err); }
  });
  on('undo-preview', () => {
    try {
      const raw = recoveryPlan(localStorage);
      document.getElementById('undo-area')!.innerHTML = `<div class="preview"><h3>Recovery preview</h3><p>Restore the exact pre-import save and ${LEGACY.length} legacy migration documents. Changes made since that import will be replaced. Close other Sprechen tabs before restoring.</p><details><summary>Inspect recovery documents</summary><pre>${escape(JSON.stringify(raw.before, null, 2))}</pre></details><details><summary>Inspect current raw documents being replaced</summary><pre>${escape(JSON.stringify(raw.current, null, 2))}</pre></details>${button('undo-confirm', 'Confirm recovery', 'danger')}${button('undo-cancel', 'Cancel recovery')}</div>`;
      on('undo-cancel', () => { document.getElementById('undo-area')!.innerHTML = ''; notice('Recovery cancelled. No data was written.'); });
      on('undo-confirm', () => { try { undoImport(localStorage, true, raw); document.getElementById('undo-area')!.innerHTML = ''; notice('Pre-import data restored.'); } catch (err) { error(err); } });
    } catch (err) { error(err); }
  });
}
function profile() {
  const data = doc();
  shell('You & this device', `<p class="lead">${escape(summary(data))}</p><section class="panel"><h2>Profile & preferences</h2><label>Name<input id="profile-name" value="${escape(data.name)}"></label><label>Support language<select id="profile-ui"><option value="en" ${data.ui === 'en' ? 'selected' : ''}>English</option><option value="es" ${data.ui === 'es' ? 'selected' : ''}>Español</option></select></label><p>Navigation uses English. This setting changes translation help; it does not select a learning language.</p><label>Daily minutes<input id="profile-goal" type="number" min="1" max="180" value="${escape(data.goal || 10)}"></label>${button('profile-save', 'Save preferences', 'primary')}</section><section class="panel"><h2>Device account</h2><p>The original name and secret screen is a device-local gate. There is no cloud account or new service. Your established secret is retained during import.</p>${link('/', 'Original sign-in')}${link('/setup', 'Original setup')}${link('/themes', 'Original appearance settings')}${link('/companions', 'Original companions')}</section><section class="panel"><h2>Data</h2>${link('/backup-safe', 'Safe export / import / recovery', 'action')}</section>`);
  on('profile-save', () => {
    const goal = Number(value('profile-goal')); if (!Number.isFinite(goal) || goal < 1 || goal > 180) { notice('Daily minutes must be between 1 and 180.'); return; }
    write(d => ({ ...d, name: value('profile-name').trim(), ui: value('profile-ui'), goal })); notice('Preferences saved.');
  });
}
async function main() {
  const path = currentPath();
  try { assertResolved(localStorage); }
  catch (err) { backup(); notice((err as Error).message); return; }
  if (!owned(path)) {
    await import(/* @vite-ignore */ LEGACY_MODULE);
    // Stable sibling navigation, without mutating React-owned elements.
    const nav = document.createElement('aside'); nav.className = 'legacy-return'; nav.innerHTML = link('/today', 'Languages ↗'); document.body.append(nav);
    return;
  }
  try {
    // Recovery and profile remain reachable even if local course preparation failed.
    if (['/backup-safe', '/backup'].includes(path)) { backup(); return; }
    if (path === '/you') { profile(); return; }
    const response = await fetch(BASE + '/course.json'); if (!response.ok) throw Error('Local course unavailable. Prepare offline while online and retry.');
    all = rows(await response.json() as Course);
    if (/^\/(today|map)$/.test(path)) picker();
    else if (path.startsWith('/language/')) language(path.split('/')[2]);
    else if (/^\/t\/(pt|it)/.test(path)) language(path.split('/')[2]);
    else if (path.startsWith('/play/flirt/')) practice('pt', false, path.split('/')[3]);
    else if (path.startsWith('/practice/')) practice(path.split('/')[2]);
    else if (path === '/review-local' || path === '/review') practice('', true);
    else if (path === '/series/fr/intro') frenchUnit();
    else if (['/backup-safe', '/backup'].includes(path)) backup();
    else if (path === '/you') profile();
    else picker();
  } catch (err) { shell('Unable to open this path', `<p role="alert">${escape((err as Error).message)}</p>${link('/today', 'Return to languages')}`); }
}
void main();
