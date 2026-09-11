const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`AnkiAdder requires Node.js 22.12 or newer; you are running ${process.version}.`);
  console.error('Install Node.js 24, then run npm ci and npm start again.');
  console.error('If you use nvm, run: nvm install && nvm use');
  process.exit(1);
}
