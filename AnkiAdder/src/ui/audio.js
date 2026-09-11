(function () {
  async function checkRecording(src) {
    const context = new AudioContext();
    try {
      const encoded = src.split(',')[1];
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      let recording;
      try { recording = await context.decodeAudioData(bytes.buffer); }
      catch { throw new Error('This recording cannot be decoded. Use Regenerate pronunciation to replace it.'); }
      for (let channel = 0; channel < recording.numberOfChannels; channel++) {
        if (recording.getChannelData(channel).some(sample => Math.abs(sample) > 0.0001)) return;
      }
      throw new Error('This recording is silent. Use Regenerate pronunciation, then Update existing card to replace the audio in Anki.');
    } finally { await context.close(); }
  }
  window.AnkiAudio = { checkRecording };
})();
