const { validateEntry, buildNote, DEFAULTS } = require('./core.cjs');
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
module.exports = { editRecord };
