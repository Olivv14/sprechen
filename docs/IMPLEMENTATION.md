# Maintainable enhancement and legacy compatibility

## Repository reality

The original application source is **not present**. `index.html` loads `assets/index-BzuZHiF7.js` and `assets/index-CuFachSo.css`. This enhancement does not recover or replace that React project. Editable TypeScript in `src/` owns the new experience, while the deployed React engine continues serving original lesson, calendar, setup, sign-in, appearance and companion routes.

Original tracked files remain byte-identical to baseline. `index.html` is a build input, not generated source ownership. Deploy **the contents of `dist/`** at `/sprechen/`; deploying the repository root alone would continue serving the original app.

## Build and exercise on Windows

Node 24.19.0 and npm.cmd 11.17.0 were used in this checkout.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run preview
```

Preview prints its actual random `http://127.0.0.1:PORT/sprechen/today` URL. It binds only to loopback, has SPA fallback under `/sprechen/`, rejects path traversal, and does not read `.env`. E2E starts/stops its own preview and isolated Chrome using `C:/Program Files/Google/Chrome/Application/chrome.exe`; no installed Playwright browser is required. `node scripts/verify.mjs` records the four required commands, outputs and exit codes under `.saikan/execution/offline-language-paths/`.

`scripts/build.mjs` uses esbuild and an explicit static-file allowlist. It emits hashed enhancement CSS/JS, a data-only patched legacy module, course JSON, HTML, fonts, icons, manifest and service worker. It copies original asset/content directories; it does not copy `.git`, development sources, dependencies, logs, credentials or private files. Production builds do not download anything. `scripts/vendor-fonts.mjs` is an explicit maintenance task that fetched the existing Google Fonts families once; pinned local font files, sources and official licenses live in `static/fonts/`.

## Editable code

- `src/app.ts`: DOM UI, language paths, integrated French unit, practice/review, profile, safe backup screens, public History API routing bridge.
- `src/backup.ts`: pure validation, read-only legacy migration view, import preview/commit, snapshot and undo.
- `src/course.ts`: stable row identities, five-item Portugal sampler, original six-line French pilot, text normalisation.
- `src/voice.ts`: optional local system TTS, exact Portugal voice policy and a public Web Speech API guard installed before loading legacy code.
- `src/style.css`: scoped slate/night enhancement styles. Original CSS stays loaded; only enhancement-root sizing is overridden.
- `src/sw.js`: build-versioned core caching and navigation fallback.
- `scripts/course.mjs`: Acorn AST / literal-only extraction and reviewed correction.
- `tests/`: native Node unit tests plus actual Chrome E2E; reports and screenshots are generated in `artifacts/`.

Routes owned by TypeScript: `/today`, `/map`, `/language/:id`, `/practice/:id`, `/series/fr/intro`, `/review-local`, `/review`, `/backup`, `/backup-safe`, `/you`, dedicated empty `/t/pt` and `/t/it` paths. Portuguese-containing original scenes `/play/flirt/rp1`, `rp2`, `fd2` use a maintained text practice wrapper in original item order, including the original mixed-language context. It omits inherited phonetic hints and protects Portugal speech. Other original routes load the existing React engine. `/` still opens original device sign-in and `/setup` remains available.

Links use ordinary navigation. On legacy pages, a small History API bridge turns legacy React `pushState`/`replaceState` navigation to owned paths into document navigation. A capture listener covers real anchor links; `popstate` covers history traversal. No React internals, mutation observers or permanent mutations inside React-owned DOM are used. A separate sibling link returns to Languages. Both old import screens are owned by TypeScript, so the old hidden file inputs never mount. Tests exercise direct paths, legacy navigation and the history bridge.

The same classifier runs before importing the compatibility module and for every navigation boundary. It matches the original router's case-insensitive basename and static route spelling, decodes path segments once (keeping encoded slashes inside their segment), and accepts repeated terminal slashes. Owned destinations are canonicalized with the original query/hash retained. Dynamic track, lesson and progress identities keep their original case; an uppercase dynamic identity that the original course does not resolve is not reinterpreted as another lesson. The loopback preview server itself only serves the lowercase `/sprechen/` prefix; uppercase-basename navigation from an already loaded page is canonicalized before requesting the server. The regression fixture server also tests direct uppercase-basename delivery of the shell, as a host supporting that alias would do.

## Data-only legacy correction

The extractor parses the active bundle without executing it, finds the sole object with `pack` and `tracks`, and evaluates only literal AST nodes. Calls, computed properties, spreads and executable expressions are rejected. All track/section/unit/lesson/item order and identities remain unchanged: 560 items in `de`, 40 in `fr`, zero in dedicated `it`/`pt`, and 120 in `flirt` (720 total). Filtering by item language also includes mixed-context items: 647 German, 51 French, 11 Italian and 11 Portuguese; the new Portugal starter selects five.

Exactly one reviewed item is corrected at **`de::a1::2`**. The known record had a stray question followed by every intended field shifted to the right. It becomes:

```json
{"hear":null,"say":"Richtung Kreuzberg.","en":"Direction Kreuzberg.","es":"Dirección Kreuzberg.","ph":"RIKH-toong KROYTS-berg","why":"eu = oy.","lang":"de"}
```

The build verifies the exact corrupt input before applying this correction, serializes only the DATA AST node, and emits `assets/legacy-CONTENT_HASH.js` in `dist`. Every executable byte before and after that node is unchanged. Original JS remains untouched (also copied unchanged). Unit tests assert exactly one semantic item delta, unchanged identities/order and identical executable prefix/suffix. `dist/build-info.json` records offsets, hashes, output paths and correction identity. This constrained generated data replacement is needed because no original React source exists.

## Saves, validation and import recovery

Verified actual key spellings are **`sprechen.local.v1`**, `sprechen.v4`, `sprechen.v3`, `sprechen.v2`, `sprechen.accts.v1` (not `spreken`). The legacy reader merges `sit` and uses maximum XP/streak from its strongest migration document. `readDoc` mirrors that in memory without writing. New practice extends the current document; it never clears storage or starts a replacement save. Existing HLR/mastery keys remain `track::lesson::index`; lesson stars remain `track.lesson`. Unknown document/record fields survive updates.

The new export is `{format:"sprechen-backup", version:1, exportedAt, data}`. Raw exports with the actual legacy save shape are accepted. Validators reject null/arrays, foreign JSON, malformed maps, invalid numeric/HLR/date/identity values, unsafe keys anywhere, incompatible extension versions, excessive size/depth. Unknown legitimate JSON fields are retained, including legacy raw metadata named `version` or `data`. This is shape validation, not cryptographic proof of file origin.

Preview performs no writes. Confirm first compares every exact raw current/legacy document and both recovery/journal identities with the preview. It writes and verifies a pending **`sprechen.safe-transaction.v1`** journal containing the original exact raw snapshot, then writes and verifies **`sprechen.safe-recovery.v1`**. Only then does it strip top-level migration progress fields from the old documents, retaining account/preferences/unknown metadata, and replace the current save. Every write is read back; a complete journal is written and verified last. This prevents the original reader's max/merge from resurrecting archived progress. An established device secret hash is retained even if the incoming file supplies another hash. Other save fields are the explicitly previewed replacement. Invalid/preview/cancel never modifies storage, including recovery and journal keys.

Undo requires a separate preview/confirm/cancel. The preview captures both recovery identity and all exact current raw documents; any change before confirmation rejects with zero writes and requires a refreshed preview. Confirming without a preview is rejected. Recovery is itself journaled and restores exact strings or key absence. A failed recovery stays pending and can be explicitly retried against the same original snapshot. The journal's verified snapshot is authoritative when it exists, including an interruption before the separate recovery key was replaced. Valid pre-journal recovery records still work. Malformed journals fail closed without deletion; raw export remains available for manual diagnosis.

The recovery download is an archival raw-document snapshot, not an ordinary progress import. Normal portable transfer uses the versioned backup export. Raw-current download also exports malformed strings without parsing or repairing them, plus the recovery and journal documents. A corrupt current save cannot prevent access to recovery preview/download/cancel. Normal envelope export reports validation errors. None of these read/export actions writes storage.

There is one bounded snapshot, duplicated in the journal for durability, with no nested undo history. A later confirmed import may replace it only after the journal is complete and agrees with the separate recovery record. An interrupted or uncertain journal blocks imports, maintained progress reads/writes, and bootstrap into the original engine; the app opens the safe recovery page instead, with no automatic migration or restoration. Explicit recovery must finish before continuing. A synchronous import error attempts verified rollback; rollback failure or a failed final completion write retains the original snapshot and reports failure, never success. A verified rollback can finish the journal but still reports the original import error.

localStorage does not provide multi-key ACID, cross-tab locking, permanent disk durability, or protection from eviction. **Close other Sprechen tabs before import/recovery.** The UI states this constraint. Exact stale-preview checks and the pending-bootstrap/read guards are enforced, but an already running old/uncooperative app tab can race during a multi-key operation; the journal cannot stop that tab or merge its concurrent edits. Preserve raw exports before manual repair, especially for a malformed journal or persistent quota/storage failure. Snapshot duplication needs extra storage capacity. No user browser profile is used by tests.

French draft/stage/completion and new answer records live under `localPaths:{version:1,reviews,units}` in the current document. Six French pilot identities use `fr::intro-pilot-v1::0..5`, without colliding with legacy lessons. Completion enrolls fresh due HLR entries with zero reviews; actual recall attempts update HLR and mastery. Practice records use a simple documented local half-life update and preserve extra fields. Existing legacy scheduling records are never reset. Review lists saved/enrolled items sorted by next review date and allows early practice; it does not claim every listed item is overdue. Support language changes only translation help; navigation remains English.

## Offline and media boundaries

The core cache includes local shell, hashed bootstrap, active corrected legacy module, original CSS, course, fonts, icons, corpus and existing included media. Build identity hashes the ordered resource hashes of a template app containing a fixed identity slot, plus the worker template. The identity is filled once into the final app; its final content hash determines its filename. The worker receives that same identity and the final resource list. `build-info.json` records the algorithm, template hashes and actual emitted resource hashes. This avoids a self-referential hash loop and permits byte-for-byte deterministic builds.

The app announces ready only when the active worker identifies **this loaded build** and verifies the cache. It observes installing, failed/redundant, waiting, activation and controller changes. A verified matching waiting worker can activate without reloading any page. An active previous build remains available during failed installation, but cannot supply readiness for the loaded build. Failure/timeouts are visible and Retry checks for an update or repairs an incomplete matching cache. Unfinished form input is retained. Tests publish actual build A then B on one random loopback origin, including a failed B resource install, not fabricated status replies.

`STATUS` checks every required cache entry, its success status, non-HTML type for non-HTML resources, and the matching ready marker. Missing entries invalidate the marker and notify open pages; required fetch misses, offline/online and visibility changes trigger rechecks. Retry refetches/verifies the core before replacing the marker. A failed candidate only deletes its own build cache; repair failure leaves readiness incomplete. Readiness is an observation, not continuous monitoring of browser eviction: arbitrary out-of-band deletion is detected on a status/lifecycle/fetch recheck. Only same-origin `/sprechen/` requests participate. External providers are never fetched or cached by the worker.

Extensionless application navigation tries the network and falls back to the cached shell on failure, including deep routes. Missing JS/JSON/media requests, including direct navigation to resource filenames, never receive that HTML fallback; network failure returns an explanatory plain-text 503. Core files are served from the matching cache. Previous build caches are retained for open tabs, with old hashed assets available across versions. There is no forced page reload; ordinary navigation/reload remains learner-controlled. Old caches consume disk until the browser clears site data; cache pruning across open builds is deferred.

Readiness means the cache succeeded, not a promise that the browser will never evict data. Preparation needs HTTPS or localhost and adequate storage. HTTP at a remote IP is not a valid offline/PWA proof. System TTS is optional and new activities require an installed local voice; Portugal additionally requires exact `pt-PT`. Missing/failed audio keeps text usable. Legacy Portugal speech also cannot fall back to Brazil. No new STT or phoneme scoring is introduced. The original device UI’s dictation remains its existing optional browser feature, not pronunciation assessment.

French has an authored text scene with optional clearly labelled system audio, not an externally sourced video. The optional Berlin stock clip is unchanged existing media; load errors show a fallback. Existing external listening resources remain optional legacy support. No claim is made about external playback, native Tunisian audio, physical iPhone, Safari or installed phone voices.

## Fix-cycle regression commands

Run the ordinary npm commands above, plus `node tests/fix-cycle.e2e.mjs`, `node tests/offline-build.e2e.mjs`, and `node tests/build-identity.mjs`. The offline replacement test uses the preserved actual pre-offline-fix build at `.saikan/execution/offline-language-paths/fix-cycle-1/build-a/` and current `dist/` as B; both build identities are recorded in its JSON. The identity test rebuilds twice and compares all 78 output files, then verifies template and emitted hashes. Run it before browser tests, which read the finished output.

Set `SPRECHEN_TEST_ARTIFACTS=.saikan/execution/offline-language-paths/fix-cycle-1/original-e2e` when running `npm.cmd run test:e2e` for this cycle, to preserve earlier reports/screenshots. New regression evidence defaults to the cycle directory; optional `EVIDENCE_LABEL` distinguishes runs. All browser tests launch installed Chrome with fresh synthetic contexts and ephemeral loopback origins, never a real profile. The cycle report records actual failures and final results rather than treating prior unsafe-behavior assertions as safety tests.
