const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULTS, validateSettings } = require('./core.cjs');

class Store {
  constructor(directory, crypto) { this.directory = directory; this.crypto = crypto; this.settings = { ...DEFAULTS }; this.secrets = {}; this.history = []; }
  async read(name, fallback) {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`Cannot read ${name}. Your saved data has been preserved. Restore that file from a backup or rename it to start fresh.`); }
  }
  async write(name, data) {
    await fs.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, name);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }
  async load() {
    const config = await this.read('settings.json', {});
    this.settings = validateSettings(config.settings || DEFAULTS);
    this.secrets = config.secrets || {};
    this.history = await this.read('history.json', []);
    if (!Array.isArray(this.history)) throw new Error('History is unreadable. Restore history.json from backup.');
  }
  publicSettings() { return { ...this.settings, hasApiKey: Boolean(this.secrets.apiKey), hasAnkiKey: Boolean(this.secrets.ankiKey) }; }
  secret(name) {
    if (!this.secrets[name]) return '';
    try { return this.crypto.decryptString(Buffer.from(this.secrets[name], 'base64')); }
    catch { throw new Error('The saved key could not be unlocked on this computer. Enter it again in Settings.'); }
  }
  async save(input) {
    const settings = validateSettings(input);
    const secrets = { ...this.secrets };
    for (const name of ['apiKey', 'ankiKey']) {
      if (input[`clear${name === 'apiKey' ? 'Api' : 'Anki'}Key`]) delete secrets[name];
      if (typeof input[name] === 'string' && input[name].trim()) {
        if (input[name].length > 2000) throw new Error('The API key is too long.');
        if (!this.crypto.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable. Unlock your operating system keychain and try again.');
        secrets[name] = this.crypto.encryptString(input[name].trim()).toString('base64');
      }
    }
    await this.write('settings.json', { settings, secrets });
    this.settings = settings; this.secrets = secrets;
    return this.publicSettings();
  }
  async put(record) {
    const history = [record, ...this.history.filter(item => item.id !== record.id)];
    await this.write('history.json', history);
    this.history = history;
    return record;
  }
  async remove(id) {
    const history = this.history.filter(item => item.id !== id);
    if (history.length === this.history.length) throw new Error('This saved entry could not be found.');
    await this.write('history.json', history);
    this.history = history;
  }
}
module.exports = { Store };
