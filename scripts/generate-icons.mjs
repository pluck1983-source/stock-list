import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(dir, 'icon-source.svg'));
// iOS and Android round maskable icons themselves - a pre-rounded tile would show dark corners.
const square = Buffer.from(svg.toString().replace('rx="112"', 'rx="0"'));
const outDir = path.join(dir, '..', 'public', 'icons');

for (const [name, size, sq] of [['apple-touch-icon.png', 180, true], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512, true], ['favicon-32.png', 32]]) {
  await sharp(sq ? square : svg, { density: 384 }).resize(size, size).png().toFile(path.join(outDir, name));
  console.log('wrote', name);
}
