const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
  const directory=await fs.mkdtemp(path.resolve('test-output/settings-'));
  const env={...process.env,ANKIADDER_TEST_DATA:directory};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({args:['.','--smoke-test'],env});
  try {
    const page=await app.firstWindow();page.setDefaultTimeout(15000);
    // Electron handles beforeunload cancellation itself; suppress Playwright's browser-dialog fallback.
    page.on('dialog', () => {});
    await page.locator('.nav[data-page=settings]').click();
    await page.locator('[name=sourceLanguage]').fill('Japanese');
    await page.locator('[name=showCosts]').uncheck();
    await page.locator('.nav[data-page=create]').click();
    await page.waitForFunction(()=>document.querySelector('#language-badge').textContent==='Japanese');
    assert.equal((await page.evaluate(()=>window.ankiAdder.settings())).showCosts,false);
    await page.locator('.nav[data-page=settings]').click();
    await page.locator('[name=sourceLanguage]').fill('');
    await page.waitForFunction(()=>document.querySelector('#settings-status').textContent.includes('Not saved'));
    assert.equal((await page.evaluate(()=>window.ankiAdder.settings())).sourceLanguage,'Japanese');
    await page.locator('[name=sourceLanguage]').fill('Swedish');
    await page.locator('[name=tags]').fill('autosaved on-close');
    // Close before debounce expires. beforeunload flushes to disk before closing.
    const closed=page.waitForEvent('close');await page.evaluate(()=>window.close());await closed;
    const disk=JSON.parse(await fs.readFile(path.join(directory,'settings.json'),'utf8'));
    assert.equal(disk.settings.sourceLanguage,'Swedish');assert.equal(disk.settings.tags,'autosaved on-close');
    console.log('Autosave passed: immediate navigation, invalid input preserves saved data, close flushes pending changes.');
  } finally { await app.close().catch(()=>{}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
