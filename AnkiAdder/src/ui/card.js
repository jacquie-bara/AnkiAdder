(function (root) {
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Remove copied citation markers without removing meaning numbers or IPA.
  const text = value => escapeHtml(String(value).replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, ''));
  function cardFields(entry) {
    const parts = [...new Set(entry.meanings.map(m => m.partOfSpeech).filter(Boolean))].join(', ');
    const definitions = `<ol class="definition-list">${entry.meanings.map(m => `<li>${text(m.definition)}</li>`).join('')}</ol>`;
    const forms = entry.conjugations.flatMap(t => t.forms).map(f => `<span title="${text(f.label)}">${text(f.form)}</span>`).join(', ');
    const meanings = `<ol class="sense-list">${entry.meanings.map(m => `<li><div><strong>${text(m.definition)}</strong></div><ul class="example-list">${m.examples.map(ex => `<li><span dir="auto">${text(ex.sentence)}</span> <span class="translation">(${text(ex.translation)})</span></li>`).join('')}</ul></li>`).join('')}</ol>`;
    return { Word: `${text(entry.lemma)}${parts ? ` <span class="word-type">(${text(parts)})</span>` : ''}`, Pronunciation: text(entry.pronunciation), Definitions: definitions, Forms: forms ? `<div class="key-forms"><mark>${forms}</mark></div>` : '', Meanings: meanings, Notes: entry.warnings.map(text).join('<br>') };
  }
  const exported = { escapeHtml, cardFields };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.AnkiCard = exported;
})(typeof window !== 'undefined' ? window : globalThis);
