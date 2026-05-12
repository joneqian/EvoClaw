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

import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
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

// PNG 多尺寸：用于 Tauri / macOS / 通用图标
const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 512 },
];

// ICO 多尺寸：Windows installer / 任务栏 / 开始菜单 / 桌面（M14 PR-A4）
// 多分辨率合并到单一 .ico 文件，Windows 按 DPI 自动选合适尺寸
const icoSizes = [16, 32, 48, 64, 128, 256];

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

/**
 * M14 PR-A4: 用 png-to-ico 合并多尺寸 PNG 生成真 ICO 文件
 *
 * Windows installer / 任务栏 / 文件资源管理器需要多分辨率 ICO，原 copyFileSync
 * 把 32x32.png 直接当 .ico 是错的 — 装到 Windows 上会显示模糊或不显示。
 *
 * 策略：
 *   1. 用 sharp / resvg 渲染多尺寸 PNG buffer（不写盘）
 *   2. 喂给 png-to-ico 拼成单一 multi-resolution ICO 文件
 */
async function generateMultiResIco() {
  const pngToIco = (await import('png-to-ico')).default;
  let pngBuffers;

  // 尝试用 sharp 渲染（已装的依赖）
  try {
    const sharp = (await import('sharp')).default;
    pngBuffers = await Promise.all(
      icoSizes.map(async (size) => {
        const opts = isSvg ? { density: Math.round((72 * size) / 512) * 2 } : {};
        return sharp(sourceBuffer, opts).resize(size, size).png().toBuffer();
      }),
    );
  } catch {
    // 回退到 resvg-js（仅 SVG 源）
    if (!isSvg) {
      throw new Error('生成 ICO 需要 sharp 或 SVG 源 + @resvg/resvg-js');
    }
    const { Resvg } = await import('@resvg/resvg-js');
    pngBuffers = icoSizes.map((size) => {
      const resvg = new Resvg(sourceBuffer.toString('utf-8'), {
        fitTo: { mode: 'width', value: size },
        background: 'rgba(0,0,0,0)',
      });
      return resvg.render().asPng();
    });
  }

  const icoBuffer = await pngToIco(pngBuffers);
  const icoDst = join(brandIconsDir, 'icon.ico');
  writeFileSync(icoDst, icoBuffer);
  const sizeKb = (statSync(icoDst).size / 1024).toFixed(1);
  console.log(`  icon.ico (multi-res: ${icoSizes.join('/')}, ${sizeKb} KB)`);
}

async function main() {
  console.log(`Generating icons for brand: ${brand}`);
  console.log(`Source: ${sourceFile}\n`);

  try {
    await withSharp();
    console.log('  (PNG used sharp)');
  } catch {
    try {
      await withResvg();
      console.log('  (PNG used @resvg/resvg-js)');
    } catch {
      console.error(
        '\nError: neither "sharp" nor "@resvg/resvg-js" is available.',
        '\nInstall one: pnpm add -D sharp\n',
      );
      process.exit(1);
    }
  }

  // M14 PR-A4: 生成真 multi-resolution .ico
  try {
    await generateMultiResIco();
  } catch (err) {
    console.error(`\n❌ ICO 生成失败: ${err.message}`);
    console.error('   回退到 32x32.png 复制（旧行为）...');
    // 回退：保留旧行为避免脚本完全断
    const icoSrc = join(brandIconsDir, '32x32.png');
    const icoDst = join(brandIconsDir, 'icon.ico');
    copyFileSync(icoSrc, icoDst);
    console.log('  icon.ico (fallback: copy of 32x32.png)');
  }

  console.log('\nDone.');
}

main();
