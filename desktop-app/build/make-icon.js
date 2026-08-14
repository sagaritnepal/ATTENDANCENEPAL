// One-off: wraps build/icon.png in a minimal .ico container (the PNG-in-ICO
// format Windows Vista+ reads natively) so packaging tools that require a
// real .ico (unlike electron-builder, which auto-converts a PNG itself)
// have one to use. Not part of the app itself — run once, or again if
// build/icon.png ever changes; the .ico it produces is what's committed.
const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, 'icon.png');
const icoPath = path.join(__dirname, 'icon.ico');
const png = fs.readFileSync(pngPath);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = icon
header.writeUInt16LE(1, 4); // image count

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // width: 0 = 256px
entry.writeUInt8(0, 1); // height: 0 = 256px
entry.writeUInt8(0, 2); // color palette: none
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8); // image data size
entry.writeUInt32LE(header.length + entry.length, 12); // offset to image data

fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
console.log(`Wrote ${icoPath} (${png.length} byte PNG embedded)`);
