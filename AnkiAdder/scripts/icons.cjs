const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
(async () => {
  const dir = path.join(__dirname, '../src/assets');
  const svg = await fs.readFile(path.join(dir, 'icon.svg'));
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024], images = new Map();
  for (const size of sizes) images.set(size, await sharp(svg).resize(size, size).png().toBuffer());
  await fs.writeFile(path.join(dir, 'icon.png'), images.get(1024));
  const icoSizes = sizes.filter(size => size <= 256);
  const header = Buffer.alloc(6 + 16 * icoSizes.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
  let offset = header.length;
  icoSizes.forEach((size, index) => { const pos = 6 + index * 16, png = images.get(size); header[pos] = size % 256; header[pos + 1] = size % 256; header.writeUInt16LE(1, pos + 4); header.writeUInt16LE(32, pos + 6); header.writeUInt32LE(png.length, pos + 8); header.writeUInt32LE(offset, pos + 12); offset += png.length; });
  await fs.writeFile(path.join(dir, 'icon.ico'), Buffer.concat([header, ...icoSizes.map(size => images.get(size))]));
  const chunks = Object.entries({ icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 }).map(([type, size]) => { const data = images.get(size), head = Buffer.alloc(8); head.write(type); head.writeUInt32BE(data.length + 8, 4); return Buffer.concat([head, data]); });
  const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
  await fs.writeFile(path.join(dir, 'icon.icns'), Buffer.concat([icns, ...chunks]));
  console.log('Generated PNG, Windows ICO and macOS ICNS icons.');
})().catch(e => { console.error(e); process.exitCode = 1; });
