const { randomUUID } = require('node:crypto');

function parseWords(input) {
  if (typeof input !== 'string' || input.length > 201000) throw new Error('Paste up to 1,000 words, one per line.');
  const words = [...new Set(input.split(/\r\n|[\r\n]/).map(word => word.trim().normalize('NFC')).filter(Boolean))];
  if (!words.length || words.length > 1000) throw new Error('Enter 1–1,000 words, one per line.');
  if (words.some(word => word.length > 200)) throw new Error('Each line must contain at most 200 characters.');
  return words;
}

// Runs in the main process so navigation, minimization and renderer reloads do not stop work.
class BatchQueue {
  constructor({ store, processItem, preflight, keepAwake = () => () => {}, onIdle = () => {} }) {
    Object.assign(this, { store, processItem, preflight, keepAwake, onIdle });
    this.state = { status: 'idle', items: [] };
    this.running = false;
  }
  async load() {
    this.state = await this.store.read('batch.json', this.state);
    if (['running', 'stopping'].includes(this.state.status)) {
      this.state.status = 'paused';
      for (const item of this.state.items) if (item.status === 'processing') item.status = 'pending';
      await this.save();
    }
  }
  snapshot() { return structuredClone(this.state); }
  save() { return this.store.write('batch.json', this.state); }
  async start(input, settings) {
    if (this.running) throw new Error('A batch is already running.');
    if (this.state.items.some(item => item.status === 'pending')) throw new Error('Resume the unfinished batch before starting another.');
    const words = parseWords(input);
    return this.launch(async () => {
      this.state = { status: 'running', settings: { ...settings }, items: words.map(word => ({ id: randomUUID(), word, status: 'pending' })) };
    }, settings);
  }
  async resume(retryFailed = false) {
    if (this.running) throw new Error('A batch is already running.');
    if (!this.state.items.some(item => item.status === 'pending' || (retryFailed && item.status === 'failed'))) throw new Error('No words waiting to process.');
    return this.launch(async () => {
      if (retryFailed) for (const item of this.state.items) if (item.status === 'failed') item.status = 'pending';
      this.state.status = 'running'; delete this.state.error;
    }, this.state.settings);
  }
  async launch(prepare, settings) {
    this.running = true;
    try {
      await this.preflight(settings);
      await prepare();
      await this.save();
      this.done = this.run();
      return this.snapshot();
    } catch (error) { this.running = false; this.onIdle(); throw error; }
  }
  stop() {
    // Finish the current word, including its Anki write, before pausing.
    if (this.running) this.state.status = 'stopping';
    return this.snapshot();
  }
  async run() {
    let release = () => {};
    try {
      release = this.keepAwake();
      for (const item of this.state.items) {
        if (this.state.status === 'stopping') break;
        if (item.status !== 'pending') continue;
        item.status = 'processing'; delete item.error;
        await this.save();
        try {
          const { record, addError } = await this.processItem(item, this.state.settings);
          item.recordId = record.id;
          item.status = addError ? (record.entry.warnings.length ? 'review' : 'failed') : record.status;
          if (addError) item.error = addError;
        } catch (error) { item.status = 'failed'; item.error = error.message || 'This word could not be processed.'; }
        await this.save();
      }
      this.state.status = this.state.items.some(item => item.status === 'pending') ? 'paused' : 'completed';
      await this.save();
    } catch (error) {
      this.state.status = 'paused'; this.state.error = error.message;
      for (const item of this.state.items) if (item.status === 'processing') item.status = 'pending';
    } finally { this.running = false; release(); this.onIdle(); }
  }
}

module.exports = { BatchQueue, parseWords };
