#!/usr/bin/env node
/**
 * generate-brand-icons.mjs — 从品牌 logo 生成 Tauri 所需的各尺寸图标
 *
 * 用法:
 *   node scripts/generate-brand-icons.mjs healthclaw
 *   BRAND=healthclaw node scripts/generate-brand-icons.mjs
 *
 * 输入: brands/<brand>/icons/logo.png 或 logo.svg
 * 输出: 32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.ico
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const brand = process.argv[2] || process.env.BRAND || 'evoclaw';
const brandIconsDir = join(ROOT, 'brands', brand, 'icons');

// 查找源文件
const svgSource = join(brandIconsDir, 'logo.svg');
const pngSource = join(brandIconsDir, 'logo.png');
const sourceFile = existsSync(svgSource) ? svgSource : existsSync(pngSource) ? pngSource : null;

if (!sourceFile) {
  console.error(`❌ 未找到 logo 源文件: ${svgSource} 或 ${pngSource}`);
  process.exit(1);
}

const sourceBuffer = readFileSync(sourceFile);
const isSvg = sourceFile.endsWith('.svg');

const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 512 },
];

async function withSharp() {
  const sharp = (await import('sharp')).default;
  for (const { name, size } of sizes) {
    const out = join(brandIconsDir, name);
    const opts = isSvg ? { density: Math.round((72 * size) / 512) * 2 } : {};
    await sharp(sourceBuffer, opts)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`  ${name} (${size}x${size})`);
  }
}

async function withResvg() {
  if (!isSvg) {
    console.error('❌ @resvg/resvg-js 仅支持 SVG 源文件，请安装 sharp: pnpm add -D sharp');
    process.exit(1);
  }
  const { Resvg } = await import('@resvg/resvg-js');
  for (const { name, size } of sizes) {
    const out = join(brandIconsDir, name);
    const resvg = new Resvg(sourceBuffer.toString('utf-8'), {
      fitTo: { mode: 'width', value: size },
      background: 'rgba(0,0,0,0)',
    });
    const rendered = resvg.render();
    writeFileSync(out, rendered.asPng());
    console.log(`  ${name} (${size}x${size})`);
  }
}

async function main() {
  console.log(`Generating icons for brand: ${brand}`);
  console.log(`Source: ${sourceFile}\n`);

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
        '\nInstall one: pnpm add -D sharp\n',
      );
      process.exit(1);
    }
  }

  // Create .ico
  const icoSrc = join(brandIconsDir, '32x32.png');
  const icoDst = join(brandIconsDir, 'icon.ico');
  copyFileSync(icoSrc, icoDst);
  console.log('  icon.ico (copy of 32x32.png)\n');
  console.log('Done.');
}

main();
