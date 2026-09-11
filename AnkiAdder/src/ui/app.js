const api = window.ankiAdder;
const $ = selector => document.querySelector(selector);
const escape = window.AnkiCard.escapeHtml;
const pricing = window.AnkiPricing;
let settings, history = [], current, busy = false, player, decks = [];
let settingsTimer, settingsDirty = false, settingsSave, settingsRevision = 0;
let batchState = { status: 'idle', items: [] }, batchTimer;
const batchActive = () => ['running', 'stopping'].includes(batchState.status);

function notice(message, error = false) { $('#notice').textContent = message; $('#notice').classList.toggle('error', error); $('#notice').hidden = !message; }
function page(name) {
  document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== `page-${name}`; });
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.page === name));
  if (name === 'history') renderHistory();
  window.scrollTo(0, 0);
}
function setBusy(value, generating = false) {
  value = value || batchActive();
  busy = value;
  $('#generate').disabled = value; $('#word').disabled = value;
  $('#quick-audio').disabled = value;
  document.querySelectorAll('#settings-form input, #settings-form select, #preview button, .deck-controls button, .deck-controls select, #choose-new-deck').forEach(el => { el.disabled = value; });
  $('#loading').hidden = !generating; $('#cancel').hidden = !generating;
  $('#generate').textContent = generating ? 'Creating…' : settings?.autoAdd ? 'Create & add ↗' : 'Create card ↗';
  $('#empty').hidden = generating || Boolean(current);
  $('#batch-words').disabled = value;
  $('#batch-start').disabled = value || batchState.items.some(item => item.status === 'pending');
  $('#batch-resume').disabled = value; $('#batch-retry').disabled = value;
}
function fillSettings(updateForm = true) {
  const form = $('#settings-form');
  if (updateForm) {
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements.namedItem(key); if (!field) continue;
    if (field.type === 'checkbox') field.checked = value; else field.value = value;
  }
  form.elements.apiKey.value = ''; form.elements.ankiKey.value = '';
  form.elements.clearApiKey.checked = false; form.elements.clearAnkiKey.checked = false;
  }
  form.elements.apiKey.placeholder = settings.hasApiKey ? 'Saved securely · leave blank to keep' : 'Paste your OpenAI API key';
  form.elements.ankiKey.placeholder = settings.hasAnkiKey ? 'Saved securely · leave blank to keep' : 'Only if configured in AnkiConnect';
  $('#key-status').textContent = settings.hasApiKey ? 'API key saved with operating system encryption.' : 'Your key is encrypted on this computer.';
  $('#setup-banner').hidden = settings.hasApiKey;
  $('#language-badge').textContent = settings.sourceLanguage;
  renderDecks();
  $('#generate').textContent = settings.autoAdd ? 'Create & add ↗' : 'Create card ↗';
  $('#quick-audio').checked = settings.audioEnabled;
  $('#batch-settings').textContent = `${settings.sourceLanguage} → ${settings.translationLanguage} · Pronunciation ${settings.audioEnabled ? 'on' : 'off'} · Uses your saved language, voice and card settings. Each new word uses the API.`;
  const rates = pricing.rates[settings.model];
  $('#pricing-info').textContent = `${settings.model}: ${rates ? `$${rates.input} input / $${rates.cached} cached input / $${rates.output} output per million tokens.` : 'No built-in price; text cost will show unavailable.'} Pronunciation: $0.60 input text / $12 output audio per million tokens.`;
  renderCosts();
}
function renderCosts() {
  const box = $('#cost-summary'); box.hidden = !settings?.showCosts;
  if (box.hidden) return;
  const forCurrent = current && (!$('#word').value.trim() || [current.entry.word, current.entry.lemma].includes($('#word').value.trim()));
  const costs = forCurrent ? current.costs || {} : pricing.estimate(settings.model, settings.audioEnabled);
  const audioLabel = costs.pronunciation?.basis === 'cached' ? ' (cached)' : costs.pronunciation?.basis === 'off' ? ' (off)' : '';
  const total = costs.text?.usd != null && costs.pronunciation?.usd != null ? pricing.amount({ usd: costs.text.usd + costs.pronunciation.usd }) : 'unavailable';
  box.textContent = `${forCurrent ? `“${current.entry.lemma}”` : 'Next word'} · estimated USD: Text ${pricing.amount(costs.text)} · Pronunciation ${pricing.amount(costs.pronunciation)}${audioLabel} · Total ${total}`;
  box.title = forCurrent ? 'Based on reported API usage and saved standard rates. Not an invoice; excludes unreported failed requests. Replaying or re-adding this entry has no new API cost when its audio is cached.' : 'Illustrative estimate: 1,000 input + 1,000 output text tokens; 100 input + 75 output speech tokens. Actual usage varies. See Settings → API costs.';
}
async function checkAnki() {
  $('#connection-label').textContent = 'Checking Anki…';
  try {
    const { decks } = await api.checkAnki();
    $('#connection-label').textContent = 'Anki connected'; $('#connection-dot').classList.add('online');
    setDecks(decks);
    $('#deck-help').textContent = `${decks.length} decks in the open Anki profile. Switch profiles in Anki, then refresh.`;
    $('#anki-test-result').textContent = 'Connected. Anki is ready to receive your cards.';
  } catch (e) {
    $('#connection-label').textContent = 'Anki not connected'; $('#connection-dot').classList.remove('online');
    $('#anki-test-result').textContent = e.message;
    $('#deck-help').textContent = 'Deck list unavailable. Open Anki and refresh; saved deck names are kept.';
  }
}
async function refreshHistory() { history = await api.history(); $('#history-count').textContent = history.length; renderHistory(); }
function renderHistory() {
  const search = $('#history-search').value.trim().toLocaleLowerCase();
  const items = history.filter(r => `${r.entry.lemma} ${r.entry.word} ${r.sourceLanguage}`.toLocaleLowerCase().includes(search));
  $('#history-list').innerHTML = items.length ? items.map(r => `<button class="history-row" data-record="${escape(r.id)}"><span><strong dir="auto">${escape(r.entry.lemma)}</strong><small>${escape(r.sourceLanguage)} → ${escape(r.translationLanguage)} · ${r.entry.meanings.length} meanings · ${escape(new Date(r.createdAt).toLocaleDateString())}</small></span><span class="history-status">${r.pendingAnkiChanges ? 'Edited · update Anki →' : r.status === 'draft' ? 'Draft · review →' : 'In Anki · view →'}</span></button>`).join('') : '<div class="empty"><h2>No words here yet.</h2><p>Your generated entries will appear here.</p></div>';
}
function renderPreview(record) {
  current = record;
  const entry = record.entry, fields = window.AnkiCard.cardFields(entry);
  $('#empty').hidden = true; $('#preview').hidden = false;
  $('#page-create').classList.add('has-preview');
  $('#preview').innerHTML = `<div class="preview-toolbar"><span class="preview-meta">${escape(record.sourceLanguage)} · CARD PREVIEW</span><div class="actions"><button id="edit-entry" class="secondary">Edit</button>${record.format !== 'compact' ? '<button id="compact-entry" class="secondary">Make compact</button>' : ''}${record.noteId ? '<button id="update-note" class="secondary">Update existing card</button>' : ''}<button id="add-note" class="primary">${record.status === 'draft' ? 'Add to Anki →' : 'Check / add to Anki →'}</button></div></div>
    ${record.pendingAnkiChanges ? '<p class="help">Changes saved locally. Update existing card to apply them in Anki.</p>' : ''}
    ${record.status === 'duplicate' ? '<p class="help">Update existing card replaces its text and audio with this preview, keeping its deck and review history.</p>' : ''}
    <div class="vocab-card preview-sheet"><h2 class="word-heading" dir="auto">${fields.Word}</h2><div class="preview-audio"><button id="play-audio" class="text-button" title="AI-generated pronunciation">${record.audio ? '▶ Play pronunciation' : '＋ Generate pronunciation'}</button><span>AI voice${entry.pronunciation ? ' · ' + escape(entry.pronunciation) : ''}</span></div><hr>${fields.Definitions}${fields.Forms}${fields.Meanings}${fields.Notes ? `<div class="card-warning">${fields.Notes}</div>` : ''}</div>
    ${record.audio && settings.audioEnabled ? '<div class="audio-repair"><button id="regenerate-audio" class="text-button">Regenerate pronunciation</button><span class="help">New audio request · billed separately</span></div>' : ''}
    <details class="entry-details"><summary>Entry details</summary><p class="help">${escape(record.model)} · ${entry.meanings.length} meanings · ${entry.meanings.length * 2} examples${record.deck ? ' · Saved in ' + escape(record.deck) : ''}. Generated with AI.</p>${entry.notes ? `<p class="help">${escape(entry.notes)}</p>` : ''}${entry.coverage ? `<p class="help">${escape(entry.coverage)}</p>` : ''}${record.format !== 'compact' ? '<p class="help">This is an older entry. Make compact generates a shorter version using your API key. The existing Anki card changes only when you update it.</p>' : ''}</details>`;
  document.querySelectorAll('#preview button').forEach(el => { el.disabled = busy; });
  if (!settings.audioEnabled) { $('#play-audio').hidden = true; $('.preview-audio>span').textContent = 'Pronunciation off'; }
  renderCosts();
}
async function generate(word) {
  if (busy || !word || !await flushSettings()) return;
  if (!settings.hasApiKey) { page('settings'); notice('Add your OpenAI API key to create your first card.', true); return; }
  player?.pause(); notice(''); setBusy(true, true); $('#preview').hidden = true;
  try {
    const result = await api.generate(word); renderPreview(result.record); await refreshHistory();
    if (result.addError) notice(result.addError + ' Your entry is saved below.', true);
    else if (result.record.status !== 'draft') notice(result.record.status === 'duplicate' ? 'Already in Anki. Use Update existing card to replace it with this preview.' : 'Your word has been added to Anki.');
  } catch (e) { notice(e.message, true); $('#preview').hidden = !current; }
  finally { setBusy(false); $('#word').focus(); $('#word').select(); }
}
document.addEventListener('click', async event => {
  const navigation = event.target.closest('[data-page]'); if (navigation) { if (!await flushSettings()) return; page(navigation.dataset.page); }
  const link = event.target.closest('[data-link]'); if (link) { try { await api.openLink(link.dataset.link); } catch (e) { notice(e.message, true); } }
  const item = event.target.closest('[data-record]'); if (item && !busy) { const r = history.find(r => r.id === item.dataset.record); if (r) { player?.pause(); $('#word').value = r.entry.lemma; renderPreview(r); page('create'); } }
  if (event.target.closest('#edit-entry') && current && !busy) {
    if (!await flushSettings()) return;
    player?.pause();
    const id = current.id;
    window.EntryEditor.open(current, async (entry, update) => {
      setBusy(true);
      try {
        const edited = await api.edit(id, entry); $('#word').value = edited.entry.lemma;
        renderPreview(edited); await refreshHistory();
        if (update) { renderPreview(await api.add(id, true)); await refreshHistory(); }
        notice(update ? 'Edits saved and updated in Anki. Review history preserved.' : 'Edits saved in Your words. No API call was made.');
      } catch (e) { notice(e.message + ' Any saved local edits remain in Your words.', true); throw e; }
      finally { setBusy(false); }
    });
  }
  if (event.target.closest('#compact-entry') && current && !busy) {
    if (settings.sourceLanguage !== current.sourceLanguage || settings.translationLanguage !== current.translationLanguage) {
      notice(`Set languages to ${current.sourceLanguage} → ${current.translationLanguage} in Settings before regenerating this entry.`, true); return;
    }
    $('#word').value = current.entry.lemma; await generate(current.entry.lemma);
  }
  if ((event.target.closest('#add-note') || event.target.closest('#update-note')) && current && !busy) {
    if (!await flushSettings()) return;
    const replace = Boolean(event.target.closest('#update-note'));
    setBusy(true); notice(replace ? 'Updating your Anki card…' : 'Adding to Anki…');
    try {
      const record = await api.add(current.id, replace); renderPreview(record); await refreshHistory();
      notice(record.status === 'duplicate' ? 'This word is already in Anki. Use Update existing card to replace it with this preview.' : record.status === 'updated' ? 'Updated in Anki. Your review history is preserved.' : 'Added to Anki. Your next word is waiting.');
    } catch (e) { notice(`${e.message} Your entry is saved in Your words; you can retry without generating it again.`, true); }
    finally { setBusy(false); }
  }
  if ((event.target.closest('#play-audio') || event.target.closest('#regenerate-audio')) && current && !busy) {
    if (!await flushSettings()) return;
    const regenerate = Boolean(event.target.closest('#regenerate-audio'));
    setBusy(true); player?.pause(); notice('');
    $('#play-audio').textContent = current.audio && !regenerate ? 'Loading audio…' : 'Generating pronunciation…';
    try {
      const result = await api.audio(current.id, regenerate); renderPreview(result.record); await refreshHistory();
      await window.AnkiAudio.checkRecording(result.src);
      player = new Audio(result.src); await player.play();
      if (regenerate) notice(result.record.noteId ? 'Pronunciation regenerated. Use Update existing card to send the new audio to Anki.' : 'Pronunciation regenerated.');
    } catch (e) { notice(`Pronunciation: ${e.message}`, true); }
    finally { renderPreview(current); setBusy(false); }
  }
});
$('#word-form').addEventListener('submit', async event => { event.preventDefault(); await generate($('#word').value.trim()); });
$('#cancel').addEventListener('click', async () => { try { await api.cancel(); } catch (e) { notice(e.message, true); } });
function scheduleSettings() {
  settingsDirty = true; settingsRevision++; clearTimeout(settingsTimer);
  $('#settings-status').textContent = 'Unsaved changes…';
  settingsTimer = setTimeout(flushSettings, 600);
}
async function flushSettings() {
  clearTimeout(settingsTimer);
  if (settingsSave) { const saved = await settingsSave; if (!saved) return false; return settingsDirty ? flushSettings() : true; }
  if (!settingsDirty) return true;
  const form = $('#settings-form');
  if (!form.checkValidity()) { $('#settings-status').textContent = 'Not saved — complete the required settings.'; return false; }
  if (busy) { $('#settings-status').textContent = 'Waiting to save…'; settingsTimer = setTimeout(flushSettings, 600); return false; }
  const revision = settingsRevision;
  const values = { ...settings, ...Object.fromEntries(new FormData(form)) };
  for (const name of ['autoAdd','reverse','clearApiKey','clearAnkiKey','audioEnabled','showCosts']) values[name] = form.elements[name].checked;
  const connectionChanged = values.ankiUrl !== settings.ankiUrl || Boolean(values.ankiKey) || values.clearAnkiKey;
  $('#settings-status').textContent = 'Saving…';
  settingsSave = (async () => {
    try {
      settings = await api.saveSettings(values);
      // Do not overwrite text typed while the disk write was in flight.
      for (const name of ['apiKey','ankiKey']) if (form.elements[name].value === values[name]) form.elements[name].value = '';
      for (const name of ['clearApiKey','clearAnkiKey']) if (form.elements[name].checked === values[name]) form.elements[name].checked = false;
      settingsDirty = settingsRevision !== revision;
      fillSettings(false); if (current) renderPreview(current);
      $('#settings-status').textContent = settingsDirty ? 'Unsaved changes…' : 'Saved automatically';
      if (connectionChanged) void checkAnki();
      return true;
    } catch(e) { $('#settings-status').textContent = `Not saved — ${e.message}`; return false; }
  })();
  const success = await settingsSave; settingsSave = undefined;
  return success && settingsDirty ? flushSettings() : success;
}
$('#settings-form').addEventListener('input', scheduleSettings);
$('#settings-form').addEventListener('change', scheduleSettings);
$('#settings-form').addEventListener('submit', async event => { event.preventDefault(); await flushSettings(); });
function setDecks(names) { decks = names; renderDecks(); }
function renderDecks() {
  const names = decks.includes(settings.deck) ? decks : [settings.deck, ...decks];
  for (const selector of ['#deck-select', '#batch-deck']) {
    $(selector).replaceChildren(...names.map(name => { const o = document.createElement('option'); o.value = name; o.textContent = name + (decks.includes(name) ? '' : ' (saved / new)'); return o; }));
    $(selector).value = settings.deck;
  }
}
async function chooseDeck(value) {
  if (busy || !await flushSettings()) { renderDecks(); return; }
  setBusy(true);
  try { settings = await api.saveSettings({ ...settings, deck: value }); renderDecks(); $('#new-deck-row').hidden = true; }
  catch(e) { notice(e.message,true); renderDecks(); }
  finally { setBusy(false); }
}
$('#deck-select').addEventListener('change', event => chooseDeck(event.target.value));
$('#batch-deck').addEventListener('change', event => chooseDeck(event.target.value));
$('#refresh-decks').addEventListener('click', async () => { if (await flushSettings()) await checkAnki(); });
$('#new-deck').addEventListener('click', () => { $('#new-deck-row').hidden = !$('#new-deck-row').hidden; if (!$('#new-deck-row').hidden) $('#new-deck-name').focus(); });
$('#choose-new-deck').addEventListener('click', () => chooseDeck($('#new-deck-name').value.trim()));
$('#new-deck-name').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); chooseDeck(event.target.value.trim()); } });
$('#history-search').addEventListener('input', renderHistory);
$('#word').addEventListener('input', renderCosts);
$('#quick-audio').addEventListener('change', async () => {
  const enabled = $('#quick-audio').checked;
  if (!await flushSettings()) { $('#quick-audio').checked = settings.audioEnabled; return; }
  setBusy(true); player?.pause();
  try {
    settings = await api.saveSettings({ ...settings, audioEnabled: enabled });
    $('#settings-form').elements.audioEnabled.checked = enabled;
    if (current) renderPreview(current); renderCosts();
  } catch (e) { $('#quick-audio').checked = settings.audioEnabled; notice(e.message, true); }
  finally { setBusy(false); }
});
$('#reconnect').addEventListener('click', checkAnki); $('#test-anki').addEventListener('click', checkAnki);
async function init() {
  try { settings = await api.settings(); fillSettings(); await refreshHistory(); await syncBatch(); await checkAnki(); }
  catch (e) { notice(e.message, true); }
}
init();
function renderBatch() {
  const { items, status } = batchState;
  $('#batch-progress').hidden = !items.length;
  const count = name => items.filter(item => item.status === name).length;
  const finished = items.length - count('pending') - count('processing');
  const currentWord = items.find(item => item.status === 'processing')?.word;
  const title = status === 'running' ? 'Processing' : status === 'stopping' ? 'Stopping after this word' : status === 'paused' ? 'Paused' : 'Finished';
  $('#batch-summary').textContent = `${title} · ${finished}/${items.length} processed · ${count('added') + count('updated')} added · ${count('duplicate')} already in Anki · ${count('review')} to review · ${count('failed')} failed${currentWord ? ` · ${currentWord}` : ''}${batchState.settings ? ` · Deck: ${batchState.settings.deck}` : ''}`;
  $('#batch-meter').max = items.length || 1; $('#batch-meter').value = finished;
  $('#batch-error').textContent = batchState.error || '';
  $('#batch-stop').hidden = !batchActive(); $('#batch-stop').disabled = status === 'stopping';
  $('#batch-resume').hidden = batchActive() || !count('pending');
  $('#batch-retry').hidden = batchActive() || !count('failed') || Boolean(count('pending'));
  const labels = { pending: 'Waiting', processing: 'Creating & adding…', added: 'Added to Anki', updated: 'Updated in Anki', duplicate: 'Already in Anki', review: 'Saved for review', failed: 'Failed' };
  $('#batch-results').innerHTML = items.map(item => `<li><span><strong dir="auto">${escape(item.word)}</strong><small>${escape(labels[item.status] || item.status)}${item.error ? ` · ${escape(item.error)}` : ''}</small></span>${item.recordId ? `<button class="text-button" data-record="${escape(item.recordId)}" ${batchActive() ? 'disabled' : ''}>View entry →</button>` : ''}</li>`).join('');
}
async function syncBatch() {
  clearTimeout(batchTimer);
  try {
    const previous = JSON.stringify(batchState);
    batchState = await api.batch();
    if (JSON.stringify(batchState) !== previous) {
      renderBatch(); setBusy(false); await refreshHistory();
    }
  } catch (e) { notice(e.message, true); }
  if (batchActive()) batchTimer = setTimeout(syncBatch, 500);
}
async function runBatch(action) {
  if (busy || !await flushSettings()) return;
  player?.pause(); notice(''); setBusy(true);
  try { batchState = await action(); renderBatch(); }
  catch (e) { notice(e.message, true); }
  finally { setBusy(false); await syncBatch(); }
}
$('#batch-form').addEventListener('submit', event => { event.preventDefault(); void runBatch(() => api.startBatch($('#batch-words').value)); });
$('#batch-resume').addEventListener('click', () => runBatch(() => api.resumeBatch()));
$('#batch-retry').addEventListener('click', () => runBatch(() => api.resumeBatch(true)));
$('#batch-stop').addEventListener('click', async () => {
  try { batchState = await api.stopBatch(); renderBatch(); }
  catch (e) { notice(e.message, true); }
});
let closing = false;
window.addEventListener('beforeunload', event => {
  if (closing || (!settingsDirty && !settingsSave)) return;
  event.preventDefault(); event.returnValue = false;
  flushSettings().then(saved => { if (saved) { closing = true; window.close(); } else notice('Settings could not be saved. Complete the required fields in Settings before closing.', true); });
});
