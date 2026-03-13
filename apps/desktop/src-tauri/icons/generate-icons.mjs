#!/usr/bin/env node
/**
 * generate-icons.mjs
 *
 * Converts logo.svg into the PNG icon sizes required by Tauri.
 *
 * Prerequisites (install one):
 *   pnpm add -D sharp          # preferred
 *   pnpm add -D @resvg/resvg-js  # alternative
 *
 * Usage:
 *   node apps/desktop/src-tauri/icons/generate-icons.mjs
 *
 * Outputs (in the same directory as this script):
 *   32x32.png       – 32 px
 *   128x128.png     – 128 px
 *   128x128@2x.png  – 256 px (Retina)
 *   icon.png        – 512 px
 *   icon.ico        – copied from 32x32.png (Tauri accepts PNG-as-ico)
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, 'logo.svg');
const svgBuffer = readFileSync(svgPath);

const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 512 },
];

async function withSharp() {
  const sharp = (await import('sharp')).default;
  for (const { name, size } of sizes) {
    const out = join(__dirname, name);
    await sharp(svgBuffer, { density: Math.round((72 * size) / 512) * 2 })
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`  ${name} (${size}x${size})`);
  }
}

async function withResvg() {
  const { Resvg } = await import('@resvg/resvg-js');
  for (const { name, size } of sizes) {
    const out = join(__dirname, name);
    const resvg = new Resvg(svgBuffer.toString('utf-8'), {
      fitTo: { mode: 'width', value: size },
      background: 'rgba(0,0,0,0)',
    });
    const rendered = resvg.render();
    writeFileSync(out, rendered.asPng());
    console.log(`  ${name} (${size}x${size})`);
  }
}

async function main() {
  console.log('Generating icons from logo.svg ...\n');

  try {
    await withSharp();
    console.log('\n  (used sharp)');
  } catch {
    try {
      await withResvg();
      console.log('\n  (used @resvg/resvg-js)');
    } catch (err) {
      console.error(
        '\nError: neither "sharp" nor "@resvg/resvg-js" is available.',
        '\nInstall one of them first:',
        '\n  pnpm add -D sharp',
        '\n  pnpm add -D @resvg/resvg-js\n',
      );
      process.exit(1);
    }
  }

  // Create .ico (Tauri on Windows accepts a PNG renamed to .ico)
  const icoSrc = join(__dirname, '32x32.png');
  const icoDst = join(__dirname, 'icon.ico');
  copyFileSync(icoSrc, icoDst);
  console.log('  icon.ico (copy of 32x32.png)\n');
  console.log('Done.');
}

main();
