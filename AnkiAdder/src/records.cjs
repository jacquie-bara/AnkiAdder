const { validateEntry, buildNote, DEFAULTS } = require('./core.cjs');
const { calculate, combine } = require('./ui/pricing.js');
function editRecord(record, entry) {
  validateEntry(entry); // Manual edits are not constrained by the model's short-output schema.
  const updated = { ...record, entry: structuredClone(entry), editedAt: new Date().toISOString(), pendingAnkiChanges: Boolean(record.noteId) };
  if (record.noteId && !record.ankiIdentity) updated.ankiIdentity = buildNote(record.entry, { ...DEFAULTS, sourceLanguage: record.sourceLanguage, translationLanguage: record.translationLanguage }).fields.Identity;
  if (entry.lemma.normalize('NFC').trim() !== record.entry.lemma.normalize('NFC').trim()) {
    delete updated.audio;
    updated.audioInvalidated = true;
    // Keep historical costs: editing itself is free and does not undo previous charges.
  }
  return updated;
}
function regenerateRecord(record, entry, model, receipts) {
  validateEntry(entry);
  const normalize = word => word.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ');
  if (normalize(entry.lemma) !== normalize(record.entry.lemma)) throw new Error('Text regeneration changed the word. Your original text and pronunciation were kept.');
  const updated = editRecord(record, { ...entry, word: record.entry.word, lemma: record.entry.lemma, pronunciation: record.entry.pronunciation });
  const previous = record.costs?.text || calculate(record.model, undefined);
  return { ...updated, textVersions: [...(record.textVersions || []), { entry: structuredClone(record.entry), model: record.model, format: record.format }], model, format: 'compact', regeneratedAt: new Date().toISOString(), costs: { ...record.costs, text: combine([...(previous.receipts || [previous]), ...receipts]) } };
}
function restoreRecord(record, kind) {
  if (!['text', 'audio'].includes(kind)) throw new Error('Invalid version type.');
  const key = `${kind}Versions`, versions = record[key] || [];
  if (!versions.length) throw new Error(`No previous ${kind} version is available.`);
  const version = versions.at(-1);
  if (version.entry && version.entry.lemma !== record.entry.lemma || version.lemma && version.lemma !== record.entry.lemma) throw new Error('This version belongs to the word before it was renamed.');
  const restored = kind === 'text' ? { ...editRecord(record, version.entry), model: version.model, format: version.format } : { ...record, audio: version.audio, audioInvalidated: version.audioInvalidated, pendingAnkiChanges: Boolean(record.noteId) || record.pendingAnkiChanges };
  // Restoring content never removes charges or rewinds Anki identity/schedules.
  return { ...restored, [key]: versions.slice(0, -1), restoredAt: new Date().toISOString() };
}
module.exports = { editRecord, regenerateRecord, restoreRecord };
