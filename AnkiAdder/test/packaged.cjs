const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  await fs.mkdir('test-output', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('test-output/packaged-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const bundle = process.platform === 'darwin' ? `release/mac${process.arch === 'arm64' ? '-arm64' : ''}/AnkiAdder.app/Contents/MacOS/AnkiAdder` : 'release/win-unpacked/AnkiAdder.exe';
  const app = await _electron.launch({ executablePath: path.resolve(bundle), args: ['--smoke-test', '--user-data-dir=' + directory], env });
  try {
    const page = await app.firstWindow();
    await page.locator('#word').waitFor();
    const settings = await page.evaluate(() => window.ankiAdder.settings());
    if (settings.model !== 'gpt-5.6-luna') throw new Error('Wrong packaged default model');
    if (settings.detail !== 'compact' || !settings.audioEnabled) throw new Error('Compact cards and pronunciation must be enabled by default');
    if (await page.evaluate(() => typeof window.ankiAdder.audio) !== 'function') throw new Error('Missing pronunciation bridge');
    if (await page.evaluate(() => typeof window.ankiAdder.regenerateText) !== 'function') throw new Error('Missing text-regeneration bridge');
    for (const method of ['restore', 'deleteHistory', 'entryDecks']) if (await page.evaluate(method => typeof window.ankiAdder[method], method) !== 'function') throw new Error(`Missing ${method} bridge`);
    if (await page.locator('#history-previous, #history-next').count() !== 2) throw new Error('Missing history navigation');
    if (await page.evaluate(() => typeof window.AnkiAudio.checkRecording) !== 'function') throw new Error('Missing recording validation');
    await page.locator('.nav[data-page=batch]').click();
    await page.locator('#batch-words').waitFor();
    if ((await page.evaluate(() => window.ankiAdder.batch())).status !== 'idle') throw new Error('Unexpected packaged batch state');
    console.log('Packaged app starts successfully; compact defaults, audio bridge, UI and settings verified.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
