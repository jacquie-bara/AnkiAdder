(() => {
  const dialog = document.querySelector('#entry-editor');
  const form = document.querySelector('#editor-form');
  const container = document.querySelector('#editor-fields');
  const escape = window.AnkiCard.escapeHtml;
  let draft, save, saving = false;
  const field = (label, path, value, required = false) => `<label>${escape(label)}<textarea rows="1" data-path="${path}" ${required ? 'required' : ''} dir="auto">${escape(value)}</textarea></label>`;
  const blankMeaning = () => ({ partOfSpeech: '', definition: '', usage: '', examples: [{ sentence: '', translation: '' }, { sentence: '', translation: '' }] });
  function render() {
    container.innerHTML = `<div class="form-grid">${['word', 'lemma', 'pronunciation', 'grammar'].map(k => field(({word:'Original word',lemma:'Word / lemma',pronunciation:'Pronunciation',grammar:'Grammar'})[k], k, draft[k], ['word','lemma'].includes(k))).join('')}</div><h3>Meanings & examples</h3>${draft.meanings.map((m,i) => `<fieldset><legend>Meaning ${i+1}</legend><div class="form-grid">${field('Part of speech', `meanings.${i}.partOfSpeech`, m.partOfSpeech, true)}${field('Short definition', `meanings.${i}.definition`, m.definition, true)}</div>${m.examples.map((e,j) => `<div class="form-grid">${field(`Example ${j+1}`, `meanings.${i}.examples.${j}.sentence`,e.sentence,true)}${field('Translation',`meanings.${i}.examples.${j}.translation`,e.translation,true)}</div>`).join('')}<button type="button" class="text-button" data-remove-meaning="${i}" ${draft.meanings.length===1?'disabled':''}>Remove meaning</button></fieldset>`).join('')}<button type="button" class="secondary" data-add-meaning>Add meaning</button><h3>Forms</h3>${draft.conjugations.map((g,i) => `<fieldset>${field('Group title',`conjugations.${i}.title`,g.title,true)}${g.forms.map((f,j) => `<div class="form-grid">${field('Label',`conjugations.${i}.forms.${j}.label`,f.label,true)}${field('Form',`conjugations.${i}.forms.${j}.form`,f.form,true)}<button type="button" class="text-button" data-remove-form="${i}.${j}">Remove form</button></div>`).join('')}<button type="button" class="text-button" data-add-form="${i}">Add form</button> <button type="button" class="text-button" data-remove-group="${i}">Remove group</button></fieldset>`).join('')}<button type="button" class="secondary" data-add-group>Add form group</button><h3>Notes</h3>${field('Notes','notes',draft.notes)}${field('Coverage','coverage',draft.coverage)}${field('Warnings (one per line)','warnings',draft.warnings.join('\n'))}`;
  }
  container.addEventListener('input', event => {
    const path = event.target.dataset.path; if (!path) return;
    const keys = path.split('.'); const last = keys.pop();
    const target = keys.reduce((o,k) => o[k], draft);
    target[last] = path === 'warnings' ? event.target.value.split('\n').map(s=>s.trim()).filter(Boolean) : event.target.value;
  });
  container.addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b || saving) return;
    const d=b.dataset;
    if ('addMeaning' in d) draft.meanings.push(blankMeaning());
    if ('removeMeaning' in d && draft.meanings.length>1) draft.meanings.splice(Number(d.removeMeaning),1);
    if ('addGroup' in d) draft.conjugations.push({title:'Key forms',forms:[{label:'',form:''}]});
    if ('removeGroup' in d) draft.conjugations.splice(Number(d.removeGroup),1);
    if ('addForm' in d) draft.conjugations[Number(d.addForm)].forms.push({label:'',form:''});
    if ('removeForm' in d) { const [i,j]=d.removeForm.split('.').map(Number); draft.conjugations[i].forms.splice(j,1); if (!draft.conjugations[i].forms.length) draft.conjugations.splice(i,1); }
    render();
  });
  document.querySelector('#editor-cancel').addEventListener('click', () => { if (!saving) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    saving=true; form.querySelectorAll('button,textarea').forEach(e=>e.disabled=true);
    try { await save(draft, event.submitter.id === 'editor-update'); dialog.close(); }
    catch(e) { document.querySelector('#editor-error').textContent=e.message; }
    finally { saving=false; form.querySelectorAll('button,textarea').forEach(e=>e.disabled=false); }
  });
  window.EntryEditor = { open(record, callback) {
    draft=structuredClone(record.entry); draft.meanings.forEach(m=>m.usage=''); save=callback;
    document.querySelector('#editor-error').textContent='';
    document.querySelector('#editor-update').hidden=!record.noteId;
    render(); dialog.showModal();
  } };
})();
