// Loads settings from a ".env" file in the app folder (handy on shared hosting where settings are edited
// through the File Manager). Real environment variables always win over the file.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '.env');
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// node:sqlite is built into Node.js 22.13+ (and 22.5–22.12 with --experimental-sqlite).
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  const msg = `Aplikasi ini membutuhkan Node.js versi 22.13 atau lebih baru (terpasang: ${process.versions.node}). ` +
    'Pilih Node.js 22 / 24 di menu Setup Node.js App / Node.js pada panel hosting.';
  console.error(msg);
  throw new Error(msg);
}
