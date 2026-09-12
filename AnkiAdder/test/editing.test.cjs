const { test } = require('node:test');
const assert = require('node:assert/strict');
const { editRecord, regenerateRecord } = require('../src/records.cjs');
const { buildNote, DEFAULTS, FIELDS, MODEL_NAME, addToAnki } = require('../src/core.cjs');
const fixture = require('./fixture.cjs');

test('legacy example-filled usage is omitted and meanings use numbers', () => {
  const entry = structuredClone(fixture);
  entry.meanings[0].usage = entry.meanings[0].examples.map(e=>e.sentence).join(' ');
  const html = buildNote(entry, DEFAULTS).fields.Meanings;
  assert(html.startsWith('<ol class="sense-list">'));
  for (const example of entry.meanings[0].examples) assert.equal(html.split(example.sentence).length-1,1);
});

test('editing history preserves receipts and old identity, invalidates changed-word audio', () => {
  const record = {id:'old', entry:fixture, noteId:123, sourceLanguage:'Spanish',translationLanguage:'English',costs:{text:{usd:.01}},audio:{filename:'saved.mp3'}};
  const entry = structuredClone(fixture); entry.meanings[0].definition='speak';
  const edited = editRecord(record,entry);
  assert(edited.pendingAnkiChanges); assert(edited.editedAt);
  assert.deepEqual(edited.audio,record.audio); assert.deepEqual(edited.costs,record.costs);
  assert.equal(edited.ankiIdentity,buildNote(fixture,DEFAULTS).fields.Identity);
  entry.lemma='decir'; const renamed=editRecord(edited,entry);
  assert.equal(renamed.audio,undefined); assert(renamed.audioInvalidated);
  assert.equal(renamed.ankiIdentity,edited.ankiIdentity);
  assert.equal(record.entry.lemma,fixture.lemma);
  assert.equal(editRecord({...record,noteId:undefined},entry).pendingAnkiChanges,false);
  assert.throws(()=>editRecord(record,{...entry,meanings:[]}));
});

test('text regeneration preserves audio, input, pronunciation and Anki identity while accumulating text costs', () => {
  const record = { id: 'old', entry: fixture, noteId: 123, status: 'added', createdAt: '2026-09-01', sourceLanguage: 'Spanish', translationLanguage: 'English', costs: { text: { usd: 0.01 }, pronunciation: { usd: 0.02 } }, audio: { filename: 'saved.mp3', voice: 'marin' } };
  const generated = structuredClone(fixture); generated.word = 'different input'; generated.pronunciation = 'new IPA'; generated.meanings[0].definition = 'speak';
  const updated = regenerateRecord(record, generated, 'selected-model', [{ usd: 0.03 }, { usd: 0.04 }]);
  assert.equal(updated.id, record.id); assert.equal(updated.noteId, record.noteId); assert.equal(updated.createdAt, record.createdAt);
  assert.equal(updated.entry.word, record.entry.word); assert.equal(updated.entry.pronunciation, record.entry.pronunciation);
  assert.equal(updated.entry.meanings[0].definition, 'speak'); assert(updated.regeneratedAt); assert(updated.pendingAnkiChanges);
  assert.deepEqual(updated.audio, record.audio); assert.deepEqual(updated.costs.pronunciation, record.costs.pronunciation);
  assert.equal(updated.costs.text.receipts.length, 3); assert.equal(updated.costs.text.usd, 0.08);
  assert.equal(updated.ankiIdentity, buildNote(fixture, DEFAULTS).fields.Identity);
  assert.equal(regenerateRecord(updated, generated, 'selected-model', [{ usd: 0.01 }]).costs.text.receipts.length, 4);
  assert.equal(record.entry.meanings[0].definition, fixture.meanings[0].definition);
  assert.throws(() => regenerateRecord(record, { ...generated, lemma: 'decir' }, 'selected-model', []), /changed the word/);
  const legacy = regenerateRecord({ ...record, audio: undefined, noteId: undefined, costs: undefined }, generated, 'selected-model', [{ usd: 0.01 }]);
  assert.equal(legacy.audio, undefined); assert.equal(legacy.pendingAnkiChanges, false); assert.equal(legacy.costs.text.usd, null);
});

test('renaming updates the linked note and clears stale audio without moving or recreating cards', async () => {
  const previousIdentity=buildNote(fixture,DEFAULTS).fields.Identity;
  const entry={...fixture,lemma:'decir'}; const calls=[];let saved;
  const mock=async (_url,options)=>{
    const r=JSON.parse(options.body);calls.push(r);let result=null;
    if(r.action==='modelNames')result=[MODEL_NAME];
    if(r.action==='modelFieldNames')result=FIELDS;
    if(r.action==='findNotes')result=r.params.query.includes(previousIdentity)?[123]:[];
    if(r.action==='updateNoteFields')saved=r.params.note.fields;
    if(r.action==='notesInfo')result=[{fields:Object.fromEntries(Object.entries(saved).map(([k,v])=>[k,{value:v}]))}];
    return {ok:true,json:async()=>({error:null,result})};
  };
  const result=await addToAnki(entry,DEFAULTS,'',mock,{replaceExisting:true,previousIdentity,clearAudio:true});
  assert.equal(result.noteId,123); assert.equal(saved.Identity,buildNote(entry,DEFAULTS).fields.Identity);
  assert.equal(saved.Audio,''); assert.equal(saved.Reverse,undefined);
  assert(!calls.some(c=>['addNote','deleteNotes','changeDeck'].includes(c.action)));
});

test('missing linked note and rename collisions stop updates',async()=>{
  const previousIdentity=buildNote(fixture,DEFAULTS).fields.Identity;
  for(const collision of [false,true]) {
    const actions=[];
    const mock=async(_url,options)=>{
      const r=JSON.parse(options.body);actions.push(r.action);
      const result=r.action==='modelNames'?[MODEL_NAME]:r.action==='modelFieldNames'?FIELDS:r.action==='findNotes'?(collision?(r.params.query.includes(previousIdentity)?[123]:[999]):[]):null;
      return {ok:true,json:async()=>({error:null,result})};
    };
    await assert.rejects(addToAnki({...fixture,lemma:'decir'},DEFAULTS,'',mock,{replaceExisting:true,previousIdentity}),collision?/already uses/:/not found/);
    assert(!actions.includes('updateNoteFields'));assert(!actions.includes('addNote'));
  }
});
