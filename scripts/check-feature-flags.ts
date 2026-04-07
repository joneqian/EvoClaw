/**
 * Feature Flag 一致性校验脚本
 *
 * 校验三处定义保持同步：
 * 1. FEATURE_REGISTRY (packages/core/src/infrastructure/feature.ts) — 注册表
 * 2. feature-flags.d.ts (packages/core/src/feature-flags.d.ts) — 编译时常量声明
 * 3. build.ts (packages/core/build.ts) — esbuild define 列表
 *
 * 用法: tsx scripts/check-feature-flags.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const CORE_DIR = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../packages/core');

// ─── 1. 从 FEATURE_REGISTRY 提取 keys ───

const featureTs = fs.readFileSync(path.join(CORE_DIR, 'src/infrastructure/feature.ts'), 'utf-8');
const registryMatch = featureTs.match(/FEATURE_REGISTRY\s*=\s*\{([\s\S]*?)\}\s*as\s*const/);
if (!registryMatch) {
  console.error('❌ 无法解析 FEATURE_REGISTRY');
  process.exit(1);
}
const registryKeys = [...registryMatch[1].matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]);

// ─── 2. 从 feature-flags.d.ts 提取 declare const ───

const dtsContent = fs.readFileSync(path.join(CORE_DIR, 'src/feature-flags.d.ts'), 'utf-8');
const dtsKeys = [...dtsContent.matchAll(/declare\s+const\s+FEATURE_(\w+)\s*:/g)].map(m => m[1]);

// ─── 3. 从 build.ts 提取 FEATURE_NAMES ───

const buildTs = fs.readFileSync(path.join(CORE_DIR, 'build.ts'), 'utf-8');
const namesMatch = buildTs.match(/FEATURE_NAMES\s*=\s*\[([\s\S]*?)\]/);
if (!namesMatch) {
  console.error('❌ 无法解析 build.ts 中的 FEATURE_NAMES');
  process.exit(1);
}
const buildKeys = [...namesMatch[1].matchAll(/'(\w+)'/g)].map(m => m[1]);

// ─── 4. 从 Feature 对象提取 getter ───

const getterKeys = [...featureTs.matchAll(/get\s+(\w+)\(\)\s*:\s*boolean/g)].map(m => m[1]);

// ─── 校验 ───

const errors: string[] = [];

function checkSync(source: string, keys: string[], reference: string, refKeys: string[]) {
  const missing = refKeys.filter(k => !keys.includes(k));
  const extra = keys.filter(k => !refKeys.includes(k));
  if (missing.length > 0) {
    errors.push(`${source} 缺少: ${missing.join(', ')} (存在于 ${reference})`);
  }
  if (extra.length > 0) {
    errors.push(`${source} 多出: ${extra.join(', ')} (不存在于 ${reference})`);
  }
}

checkSync('feature-flags.d.ts', dtsKeys, 'FEATURE_REGISTRY', registryKeys);
checkSync('build.ts FEATURE_NAMES', buildKeys, 'FEATURE_REGISTRY', registryKeys);
checkSync('Feature getter', getterKeys, 'FEATURE_REGISTRY', registryKeys);

if (errors.length > 0) {
  console.error('❌ Feature Flag 一致性校验失败:\n');
  for (const err of errors) {
    console.error(`  • ${err}`);
  }
  console.error(`\n📋 FEATURE_REGISTRY keys: [${registryKeys.join(', ')}]`);
  console.error(`📋 feature-flags.d.ts:    [${dtsKeys.join(', ')}]`);
  console.error(`📋 build.ts FEATURE_NAMES: [${buildKeys.join(', ')}]`);
  console.error(`📋 Feature getters:        [${getterKeys.join(', ')}]`);
  process.exit(1);
} else {
  console.log(`✅ Feature Flag 一致性校验通过 (${registryKeys.length} 个 Flag)`);
  console.log(`   [${registryKeys.join(', ')}]`);
}
