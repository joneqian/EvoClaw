#!/usr/bin/env node
/**
 * brand-apply.mjs — 多品牌构建注入脚本
 *
 * 读取 brands/${BRAND}/brand.json，生成/覆写品牌相关文件：
 *   1. packages/shared/src/brand.ts（品牌常量）
 *   2. apps/desktop/src-tauri/tauri.conf.json（productName、identifier、window title）
 *   3. apps/desktop/src-tauri/icons/*（品牌图标）
 *   4. apps/desktop/index.html（<title>）
 *
 * 用法:
 *   BRAND=healthclaw node scripts/brand-apply.mjs
 *   node scripts/brand-apply.mjs          # 默认 evoclaw
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const brand = process.env.BRAND || 'evoclaw';
const brandDir = join(ROOT, 'brands', brand);
const brandJsonPath = join(brandDir, 'brand.json');

if (!existsSync(brandJsonPath)) {
  console.error(`❌ 品牌配置不存在: ${brandJsonPath}`);
  console.error(`   可用品牌: ${readdirSync(join(ROOT, 'brands')).join(', ')}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(brandJsonPath, 'utf-8'));
console.log(`🏷️  应用品牌: ${config.name} (${brand})`);

// ─── 1. 生成 packages/shared/src/brand.ts ───

const brandTs = `// ⚠️ 此文件由 scripts/brand-apply.mjs 自动生成，请勿手动编辑
// 品牌: ${config.name} | 生成时间: ${new Date().toISOString()}

/** 品牌配置类型 */
export interface BrandConfig {
  name: string;
  identifier: string;
  abbreviation: string;
  dataDir: string;
  dbFilename: string;
  configFilename: string;
  keychainService: string;
  eventPrefix: string;
  colors: {
    primary: string;
    primaryDark: string;
    gradient: [string, string];
  };
  windowTitle: string;
}

/** 当前品牌配置 */
export const BRAND: BrandConfig = ${JSON.stringify(config, null, 2)} as const;

// 便捷导出
export const BRAND_NAME = BRAND.name;
export const BRAND_ABBREVIATION = BRAND.abbreviation;
export const BRAND_IDENTIFIER = BRAND.identifier;
export const BRAND_DATA_DIR = BRAND.dataDir;
export const BRAND_DB_FILENAME = BRAND.dbFilename;
export const BRAND_CONFIG_FILENAME = BRAND.configFilename;
export const BRAND_KEYCHAIN_SERVICE = BRAND.keychainService;
export const BRAND_EVENT_PREFIX = BRAND.eventPrefix;
export const BRAND_COLORS = BRAND.colors;
`;

const brandTsPath = join(ROOT, 'packages', 'shared', 'src', 'brand.ts');
writeFileSync(brandTsPath, brandTs, 'utf-8');
console.log(`  ✅ ${brandTsPath}`);

// ─── 2. 覆写 tauri.conf.json ───

const tauriConfPath = join(ROOT, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));

tauriConf.productName = config.name;
tauriConf.identifier = config.identifier;
if (tauriConf.app?.windows?.[0]) {
  tauriConf.app.windows[0].title = config.windowTitle;
}

writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf-8');
console.log(`  ✅ ${tauriConfPath}`);

// ─── 3. 覆写 Cargo.toml package name + lib name ───

const cargoTomlPath = join(ROOT, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');
let cargoToml = readFileSync(cargoTomlPath, 'utf-8');
// 品牌名转 kebab-case 作为 crate name（如 HealthClaw → healthclaw-desktop）
const crateName = config.name.toLowerCase().replace(/\s+/g, '-') + '-desktop';
const libName = crateName.replace(/-/g, '_') + '_lib';
// 替换 [package] 下的 name（第一个出现）和 [lib] 下的 name（第二个出现）
let nameIdx = 0;
cargoToml = cargoToml.replace(/^name = ".*"$/gm, (match) => {
  nameIdx++;
  if (nameIdx === 1) return `name = "${crateName}"`;
  if (nameIdx === 2) return `name = "${libName}"`;
  return match;
});
writeFileSync(cargoTomlPath, cargoToml, 'utf-8');
console.log(`  ✅ ${cargoTomlPath} (${crateName})`);

// 同步更新 main.rs 中的 lib crate 引用
const mainRsPath = join(ROOT, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs');
let mainRs = readFileSync(mainRsPath, 'utf-8');
mainRs = mainRs.replace(/\w+_desktop_lib::run\(\)/, `${libName}::run()`);
writeFileSync(mainRsPath, mainRs, 'utf-8');
console.log(`  ✅ ${mainRsPath} (${libName})`);

// ─── 4. 复制品牌图标 ───

const brandIconsDir = join(brandDir, 'icons');
const tauriIconsDir = join(ROOT, 'apps', 'desktop', 'src-tauri', 'icons');

if (existsSync(brandIconsDir)) {
  const iconFiles = readdirSync(brandIconsDir);
  for (const file of iconFiles) {
    copyFileSync(join(brandIconsDir, file), join(tauriIconsDir, file));
  }
  console.log(`  ✅ 图标已复制 (${iconFiles.length} 个文件)`);

  // 同时复制 logo 到前端 public 目录（供 UI 中引用）
  const publicDir = join(ROOT, 'apps', 'desktop', 'public');
  // 优先 PNG，其次 SVG；统一复制为 brand-logo.png（PNG 源）或 brand-logo.svg（SVG 源）
  // 同时生成另一个格式的副本确保 <img src="/brand-logo.png"> 总能工作
  const logoPng = join(brandIconsDir, 'logo.png');
  const logoSvg = join(brandIconsDir, 'logo.svg');
  if (existsSync(logoPng)) {
    copyFileSync(logoPng, join(publicDir, 'brand-logo.png'));
    console.log(`  ✅ Logo 已复制到 public/ (PNG)`);
  } else if (existsSync(logoSvg)) {
    copyFileSync(logoSvg, join(publicDir, 'brand-logo.svg'));
    // 同时用 icon.png（已生成的 512px）作为 PNG 版本
    const iconPng = join(brandIconsDir, 'icon.png');
    if (existsSync(iconPng)) {
      copyFileSync(iconPng, join(publicDir, 'brand-logo.png'));
    }
    console.log(`  ✅ Logo 已复制到 public/ (SVG+PNG)`);
  }
} else {
  console.log(`  ⚠️  品牌图标目录不存在: ${brandIconsDir}，跳过`);
}

// ─── 5. 更新 index.html <title> ───

const indexHtmlPath = join(ROOT, 'apps', 'desktop', 'index.html');
let indexHtml = readFileSync(indexHtmlPath, 'utf-8');
indexHtml = indexHtml.replace(/<title>[^<]*<\/title>/, `<title>${config.name}</title>`);
writeFileSync(indexHtmlPath, indexHtml, 'utf-8');
console.log(`  ✅ ${indexHtmlPath}`);

// ─── 6. 更新 index.css 品牌色 ───

const indexCssPath = join(ROOT, 'apps', 'desktop', 'src', 'index.css');
let indexCss = readFileSync(indexCssPath, 'utf-8');

// 从品牌主色派生 hover / active / muted 变体
function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/.{2}/g);
  return m.map(c => parseInt(c, 16));
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

function darken(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function toOklchMuted(hex) {
  // 简化：生成一个浅色 muted 变体（高亮度、低饱和度）
  const [r, g, b] = hexToRgb(hex);
  // 计算色相角度（简化版）
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return `oklch(0.93 0.05 ${Math.round(h)})`;
}

const brandPrimary = config.colors.primary;
const brandHover = darken(brandPrimary, 0.08);
const brandActive = config.colors.primaryDark;
const brandMuted = toOklchMuted(brandPrimary);

indexCss = indexCss.replace(
  /--color-brand:\s*[^;]+;\s*\n\s*--color-brand-hover:\s*[^;]+;\s*\n\s*--color-brand-active:\s*[^;]+;\s*\n\s*--color-brand-muted:\s*[^;]+;/,
  `--color-brand: ${brandPrimary};\n  --color-brand-hover: ${brandHover};\n  --color-brand-active: ${brandActive};\n  --color-brand-muted: ${brandMuted};`
);

writeFileSync(indexCssPath, indexCss, 'utf-8');
console.log(`  ✅ ${indexCssPath} (brand: ${brandPrimary})`);

console.log(`\n✨ 品牌 ${config.name} 已应用完成`);
