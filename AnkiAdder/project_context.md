# AnkiAdder project context

Updated 2026-09-11 for version 1.3.0. Workspace: C:\dev\AnkiAdder. No git repository or AGENTS.md was present during this session.

## Mac follow-up (2026-09-11)

Current workspace is `/Users/yiwang/Projects/ankiadder/AnkiAdder` on macOS 15, Apple Silicon, with git at the parent directory. Use the current shell/environment rather than the historical Windows workflow notes below. Existing user formatting changes in `src/ui/index.html` were preserved.

- Removed the eyebrow, title and introductory paragraph from Add a word, Your words and Settings. Kept functional labels/help and restored a screen-reader label for the word input.
- Shared card CSS now uses transparent backgrounds in both light and night mode. The next Anki add/update refreshes the shared note-type CSS for existing cards; background changes do not require regenerating entries.
- Investigated the real cached `skum` MP3 read-only: 0.36 seconds, approximately -90 dB peak, effectively silence. Anki's media copy has the identical SHA256. Mac MP3 playback works with an audible fixture; this recording itself explains the reported silence in both apps.
- Added `src/ui/audio.js` to decode/check playback for silence or corrupt audio and display an actionable error. Regenerate pronunciation makes one explicit paid speech request without regenerating text. It saves under a fresh filename, preserves prior files on failure, accumulates pronunciation receipts, and marks linked notes for Update existing card. Playback after reload uses the replacement filename without requesting speech again. Original live user files were not modified and no real API calls were made during verification.
- UI tests use a locally generated tone (muted) for playback and a silent MP3 for rejection. Added regeneration failure/retry, receipt accumulation, persistence, no text regeneration and Anki audio upload checks, plus light/night transparency checks. 26 unit tests, Mac UI smoke and dedicated autosave checks passed. Packaged smoke now supports Mac and no longer depends on the removed heading.
- Rebuilt the Apple Silicon DMG/ZIP in `release` (version remains 1.3.0) and passed the packaged Mac startup check with a temporary profile. Build with `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac` to avoid automatically selecting a local signing certificate; the normal build stalled on certificate signing. No Developer ID signing/notarization was performed.

Historical Windows context follows.

## Product and user preferences

Cross-platform desktop app: type a word, generate a compact vocabulary entry using the user's OpenAI API key, review, and add to the running local Anki desktop app through AnkiConnect. Default text model is gpt-5.6-luna, editable in Settings. Default languages Spanish / English; preserve the user's saved settings. User studies multiple languages, including Swedish and Japanese.

Match the user's reference: centered word/part of speech, brief numbered definition summary, highlighted single line of principal forms, numbered detailed meanings with exactly two short translated examples each. Examples must appear only under each meaning, never repeated in its heading. Legacy `usage` fields caused duplicate examples; rendering now ignores usage and new generation requests it empty. No citations like [1,2]. Aim for one desktop screen, but allow scrolling for words with many common meanings. No three-meaning cap: merge near synonyms, omit rare senses, keep descriptions/examples short. At most six principal forms, not full conjugation tables. Output budget remains 4,000 tokens with low reasoning for Luna.

Pronunciation uses gpt-4o-mini-tts, default Marin; optional toggle on Add a word and in Settings. Cache MP3s and attach to Anki for offline playback/sync. Separate text/pronunciation cost estimates in USD per entry; display toggle in Settings. Saved receipts reflect reported usage and bundled rates, not invoices. Manual edits make no LLM call.

All settings autosave after 600 ms of inactivity, with visible save status; navigation/generation flush pending changes. Invalid fields retain previously saved settings and show an error. No Save settings button. Deck selection is on Add a word, uses a full dropdown, supports nested/empty/Unicode deck names, manual refresh and new deck names. AnkiConnect exposes only the currently open profile: switch profiles in Anki and refresh. A live read-only check this session reported three decks; the old autocomplete could filter by the existing typed name. Never change the user's Anki profile automatically.

Every app result/history entry has Edit. Structured form supports word, lemma, pronunciation text, grammar, meanings with two examples, forms, notes/coverage/warnings. Save changes persists locally; Save & update Anki / Update existing card explicitly updates Anki. Updates preserve schedules, deck, tags, reverse choice. Renamed lemmas follow original identity, reject collisions, and clear stale pronunciation. No audio request during an edited note update; user may explicitly generate new audio. Does not import arbitrary cards from Anki.

## Architecture

- `src/main.cjs`: Electron lifecycle, IPC, generation, local editing, audio, Anki actions. OS window/dock icons. Hidden test launch supported with --smoke-test.
- `src/preload.cjs`: narrow promise API. Renderer is sandboxed/context-isolated, no Node/network; only trusted top-level local frame may invoke IPC.
- `src/core.cjs`: settings and entry validation, strict Responses JSON schema/prompt, AnkiConnect, note type/templates/CSS. Model is `AnkiAdder Vocabulary v1`; duplicate identity is SHA256 of source language, translation language and normalized lemma. Explicit updates verify notesInfo because Anki can silently refuse while its editor is open. Updates also refresh app-owned shared note templates/styles.
- `src/records.cjs`: local edit transformation; original Anki identity migration, pending edits and stale audio invalidation. Costs remain historical.
- `src/store.cjs`: atomic settings/history JSON writes, safeStorage encryption (no plaintext fallback), secret-free public settings, unbounded history retention. Data normally `%APPDATA%/anki-adder` or `~/Library/Application Support/anki-adder`; don't print keys or overwrite real user data during testing.
- `src/audio.cjs`: speech SSE MP3 assembly + usage, validated cache paths, binary fallback with unavailable price if usage missing.
- `src/ui/index.html`, `app.js`: pages, autosave, deck picker, preview/history and API cost display. `editor.js`: native modal structured editor.
- `src/ui/card.js` + `card.css`: shared preview/Anki rendering, escaped plain text, citation stripping, numbered meanings and single form line. `compact.css`, `costs.css`, `styles.css`: app layout.
- `src/ui/pricing.js`: rates checked 2026-09-11, cached-input discounts, usage receipts, illustrative pre-generation estimates. Unknown usage/models/tiers => unavailable. Luna input/cached/output $0.20/$0.02/$1.20 per million; Mini TTS text/audio $0.60/$12. Other supported model rates in file. Prices require future rechecking against official OpenAI docs.
- `src/assets`: native SVG logo plus PNG/ICO/ICNS; `scripts/icons.cjs` uses sharp. No image generation needed for the existing vector icon.

## Run, test, package

Node.js 24 LTS. `npm ci`, `npm start`. Electron 44.3.0 / electron-builder 26.15.3 / Playwright 1.63.0; no production npm dependencies.

- `npm test`: core, audio, pricing, editing, storage tests using mock APIs.
- `npm run test:ui`: hidden Electron with isolated temporary profile and mock OpenAI/Anki calls, actual muted MP3 decoding, compact layout, full deck picker, autosave, history editing/reload, Anki updates, speech/offline recovery, costs/toggles. Screenshots in test-output. No API charges or real collection mutations.
- `node test/settings-ui.cjs`: immediate navigation and window-close autosave, invalid-field preservation. Electron manages beforeunload cancellation; Playwright's browser dialog fallback must be suppressed in this test.
- `npm run dist:win`: NSIS installer with Desktop/Start menu icon in release.
- `node test/packaged.cjs`: isolated hidden installed-bundle startup check.
- `python scripts/mac-kit.py`: source build-kit ZIP including this file. `Build Mac App.command` inside has Unix executable permissions and LF endings; on Mac with Node24 it installs dependencies and builds a DMG/ZIP.
- `.github/workflows/build.yml`: Windows x64 + Mac arm64/x64 builds on native hosts, artifact uploads only; requires pushing this project to GitHub to use.

Release targets: `release/AnkiAdder Setup 1.3.0.exe`, `release/AnkiAdder-Mac-Build-Kit-1.3.0.zip`. Older version artifacts may also exist; link the newest. Mac native binaries cannot be built on this Windows machine (electron-builder explicitly rejects it); don't claim a tested Mac binary. Builds are unsigned. Normal Windows operation after installing needs no terminal; Mac normal operation likewise after native build/install.

## Validation and remaining practical limits

25 unit tests passed for 1.3 changes. Desktop tests passed: three-meaning preview fits the 787px viewport (about 778px bottom), six examples, editable history persistence without additional paid requests, Anki field updates, deck selection and automatic settings saving. Dedicated autosave tests passed for immediate navigation, invalid-input preservation and closing before debounce expires. Windows 1.3.0 installer build and packaged app startup passed. Live Anki calls this session were read-only deck discovery; LLM and Anki mutations use mocks, so factual language accuracy/live billing were not evaluated. Mac runtime must be checked on a Mac.

Existing Anki cards store their old generated HTML until explicitly updated; changing preview rendering alone does not rewrite all historical Anki notes. Edit local history then Update existing card to apply fixes. Only the open Anki profile is accessible; updates of linked notes fail clearly if absent there. Ordinary Add uses the currently chosen deck; Update keeps the original deck. Avoid regenerating just to fix text: manual editing is free. More than three common senses are supported but completion can still hit the bounded output budget; incomplete responses produce no card rather than silently truncating.

## Session workflow notes

Use PowerShell-native file operations. Prefer rg. Use UTF-8 when reading source (PowerShell's legacy default display can look like mojibake). Use apply_patch for source changes; multiple Update blocks for the same file in one patch are rejected. Scripts passed via `node -e` can lose quotes in this environment; use a file for substantial test scripts. No subagents unless explicitly requested. Continue authorized implementation/testing/build work without repeated approval requests. Never send messages externally without user authorization.
