# AnkiAdder

A desktop app for Windows and macOS. Enter a word to create a compact card with all distinct common meanings, exactly two short translated examples per meaning, one highlighted line of key forms, and pronunciation audio. Uses **gpt-5.6-luna** for text; the model is editable in Settings.

## Get started

**Windows:** open `AnkiAdder Setup 1.3.0.exe`. The installer creates an AnkiAdder icon on the Desktop and in the Start menu. Launch it from either shortcut; no terminal or Node.js is needed after installation.

**Mac:** the app has a macOS icon and builds as a DMG and ZIP. If you have a built DMG, open it and drag AnkiAdder into Applications, then open it from Applications or keep it in the Dock. This Windows workspace cannot produce a native Mac build. The provided `AnkiAdder-Mac-Build-Kit-1.3.0.zip` contains the source: extract it on your Mac, install Node.js 24 LTS if needed, and double-click **Build Mac App.command**. That first setup builds the DMG locally and opens the output folder. No terminal is needed for normal use after installing the resulting app. These personal builds are unsigned; macOS may require approval in Privacy & Security on first launch.

1. Install Anki desktop from [apps.ankiweb.net](https://apps.ankiweb.net/).
2. In Anki, open **Tools → Add-ons → Get Add-ons**, enter **2055492159** to install [AnkiConnect](https://ankiweb.net/shared/info/2055492159), then restart Anki. Keep Anki open while adding cards.
3. Run AnkiAdder using the Windows installer in `release`, or run from source below.
4. Open **Settings**. Set the word language, the language for definitions/translations, and your OpenAI API key. Changes save automatically after a short pause; the status indicator confirms saving. Invalid settings keep the last saved values until corrected.
5. On **Add a word**, choose a deck from the full dropdown (including empty decks and subdecks). Use **↻** to refresh after opening another Anki profile; **+ New** selects a new deck, created when you add a card. Enter a word and press Enter. Review the result and click **Add to Anki**. Enable **Automatically add after generation** for a single-step workflow. Entries with model-reported warnings pause for review.

Any language name or variety can be typed in Settings. Cards use a compact format designed for one desktop screen: brief definitions, two short examples each, and at most six principal forms instead of full conjugation tables. For Swedish verbs this means the infinitive, present, past, perfect, applicable participle, and imperative. Rare senses are intentionally omitted. Smaller windows, longer scripts, or larger text sizes may still require scrolling. AI can make mistakes; model-reported uncertainties remain visible.

**Version 1.1:** existing language, key, model, and deck settings are retained. Older comprehensive/everyday preferences automatically become compact. Pronunciation is enabled by default and can be disabled in Settings.

The API key must be an **OpenAI Platform API key**, with API billing and access to the selected model. ChatGPT subscriptions are billed separately from API usage. [Create an API key](https://platform.openai.com/api-keys). No key is included in this project.

## Run from source

Install Node.js 24 LTS, open a terminal in this folder, and run:

```sh
npm ci
npm start
```

The same source runs on Windows and macOS. Anki is contacted at `http://127.0.0.1:8765`; change the local port or optional AnkiConnect key under advanced settings if needed. No browser CORS configuration is required because the desktop main process makes the request. On macOS, if Anki stops responding in the background, bring its window to the foreground.

## What gets added

- One Anki note per lemma and source/translation-language pair, using a dedicated **AnkiAdder Vocabulary v1** note type.
- The forward card shows the word, part of speech, and pronunciation. The back has a brief meaning list, a highlighted line of key forms, and two examples per meaning. Citation markers such as `[1,2]` are removed.
- Optional reverse cards show definitions first, with the word, examples, and forms on the back.
- A deck is created if its name does not exist. Existing notes with the same lemma and language pair are detected across the collection. **Update existing card** replaces that note's content and audio with the preview while preserving its card IDs, review history, deck, tags, and reverse-card choice. Ordinary retries skip duplicates.
- Generated entries are saved locally before attempting to add them. Open **Your words** to review or retry a draft without another OpenAI call. Retrying an entry uses its original language pair and the currently saved destination deck, tags, and reverse-card setting.
- AnkiAdder writes to the open local Anki profile. Use Anki’s normal sync to send cards to your other devices.

## Edit any saved card

Open any result or an entry in **Your words** and click **Edit**. Change the word, pronunciation text, grammar, meanings, both translated examples, forms, notes or warnings. Add/remove meanings and form groups as needed. **Save changes** updates local history without any API call. **Save & update Anki**, or **Update existing card** afterward, also updates the linked Anki note while preserving its deck and review schedule. If Anki is offline, the local edit remains saved for retry. This editor covers entries generated by AnkiAdder, including older history; it does not import unrelated Anki cards.

Changing the dictionary word removes its old cached pronunciation from this entry so it cannot pronounce the wrong word. Updating an edited note does not automatically buy new audio; use **Generate pronunciation** explicitly for a new recording. Previously incurred cost receipts remain unchanged by manual edits. Renaming follows the original note identity and refuses conflicting words or a missing linked note in the open profile.

Meaning headings now show only their definition, followed by two examples once each. Meanings are numbered. Older saved previews benefit immediately; to replace duplicated text already stored in Anki, open the entry and use **Update existing card**.

## Shorten an older card

Open an older entry in **Your words**, then select **Make compact** to generate a short version. If needed, first set the languages to the original entry's language pair. Choose **Add to Anki** (or let auto-add detect the existing note), then **Update existing card**. This updates the existing note without deleting its review history. If Anki's editor is open on that note, close it before updating.

The app upgrades its dedicated note type to support compact styling and an Audio field. This updates the shared layout of AnkiAdder notes; existing long text is retained until you explicitly replace it with a compact entry.

## Pronunciation and API usage

The **Pronunciation** switch beside **Create card** turns audio on/off immediately and saves that preference. The same setting is under **Settings → Pronunciation**. Off means new words make no speech request and newly added notes have no audio attachment; it does not delete audio from existing Anki notes.

**Settings → API costs → Show the cost for each word** controls the cost display independently. It is on by default. Before generation, the app shows an illustrative estimate; after generation, it shows separate text, pronunciation and total USD estimates calculated from reported usage. These receipts are saved with each entry and preserved when replaying audio or re-adding a note. Reusing an existing pronunciation for a newly generated entry is $0 additional speech cost. Older entries without recorded usage show unavailable.

Prices checked September 11, 2026: Luna standard input **$0.20**, cached input **$0.02**, and output **$1.20** per million tokens; Mini TTS text input **$0.60** and audio output **$12** per million tokens. Reasoning tokens are included in the reported output count, not charged twice. [Official OpenAI pricing](https://developers.openai.com/api/docs/pricing). The illustration assumes 1,000 input + 1,000 output text tokens and 100 input + 75 output speech tokens (about $0.00140 text and $0.00096 audio with those assumptions). Actual usage varies.

The app requests speech streaming events to read usage while assembling the same MP3 file. Responses with no usage retain playable audio but show unavailable cost. Estimates are not invoices: they exclude unreported failed attempts, taxes, and account-specific pricing adjustments. They use bundled rates rather than fetching prices automatically. Unsupported models, processing tiers, or long-context usage show unavailable. Settings links to current pricing and your actual OpenAI usage dashboard. Disabling cost display does not change requests or billing.

Audio uses OpenAI's **gpt-4o-mini-tts** speech endpoint with the selected voice (Marin by default), asking it to say only the dictionary word in its original language. The voice is AI-generated. Click **Play pronunciation** in the preview. The MP3 is attached using Anki's `[sound:...]` format and stored in Anki's media collection, so it works offline and syncs through Anki's normal media sync. Reverse cards do not reveal the word through audio on the question side.

Each new word/language/voice recording requires a separate paid speech request. MP3 files are cached under the app's `audio/` directory and reused across sessions and retries; playback makes no API request and needs no API key. A voice change applies to new recordings. **Generate audio for each word** in Settings controls automatic generation; the preview button can also generate audio explicitly for an older entry.

Text output is capped at 4,000 tokens instead of 24,000, with low reasoning effort for Luna and short examples. There is no fixed common-meaning count; near synonyms are merged, rare senses omitted, and redundant usage text is empty. This is intended to reduce text-generation usage; a token ceiling is not a charge estimate or guaranteed saving. Audio adds its own usage. No live cost benchmark has been performed.

If speech generation fails, the text draft is retained and automatic adding pauses. Retry **Generate pronunciation** without regenerating the text, or disable automatic audio and add the text-only card.

## Privacy and storage

OpenAI and optional AnkiConnect keys are encrypted using Electron's operating-system-backed `safeStorage` (Windows DPAPI / macOS Keychain). Keys never appear in renderer settings responses. There is no plaintext fallback. Other processes running as your Windows user may still be able to decrypt DPAPI-protected data. The app sends words and language settings to OpenAI, with Responses API `store: false`; speech generation separately sends the lemma and language to OpenAI's audio endpoint. This does not override OpenAI's account-level retention policies. AnkiConnect traffic stays on loopback. There is no analytics service.

Settings and generated entries are kept in Electron's user-data folder, normally `%APPDATA%/anki-adder` on Windows and `~/Library/Application Support/anki-adder` on macOS. Use `app.getPath('userData')` when diagnosing an installation with a customized path. `settings.json` contains encrypted secrets; `history.json` contains plain-text generated entries. History is retained until you remove that file while the app is closed. Copying encrypted settings between computers may require re-entering keys. Invalid saved JSON produces an error without overwriting the original file.

## Test and build

```sh
npm test          # Core logic, mocked API/Anki, persistence and error handling
npm run test:ui   # Hidden Electron window; simulated OpenAI and Anki responses
npm run dist:win  # Windows installer, build on Windows
npm run dist:mac  # macOS DMG + ZIP, build on macOS
```

Output goes to `release/`. On a Mac, add `-- --arm64 --x64` to the macOS build command to produce both Apple Silicon and Intel artifacts. `.github/workflows/build.yml` can build on each OS through GitHub Actions after the project is pushed. It uploads build artifacts; it does not publish a release.

Local builds are unsigned. Public distribution should configure a Windows signing certificate and macOS signing/notarization credentials. The workflow does not include those credentials. A Mac build must be tested on a Mac; a Windows build alone does not verify macOS runtime behavior.

Automated tests use fake credentials and simulated responses, incur no OpenAI charges, and do not alter your Anki collection. A live end-to-end check needs your API key and a running Anki installation.

## Implementation references

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-5.6 Luna API model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI text-to-speech API](https://developers.openai.com/api/docs/guides/text-to-speech)
- [AnkiConnect source and API](https://git.sr.ht/~foosoft/anki-connect)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

The app uses Electron with a sandboxed renderer, context isolation, a narrow preload bridge, local content security policy, and no renderer network access. Generated content is treated as plain text and HTML-escaped before being included in Anki fields.
