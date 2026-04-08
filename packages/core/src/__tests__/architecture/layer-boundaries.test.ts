/**
 * 架构守卫: 层级边界检测
 * 验证各模块只依赖允许的层
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(import.meta.dirname, '..', '..');

/** 层级依赖规则 — key 可以依赖 value 中的层 */
const LAYER_RULES: Record<string, string[]> = {
  infrastructure: [],
  memory: ['infrastructure'],
  provider: ['infrastructure'],
  rag: ['memory', 'infrastructure'],
  skill: ['infrastructure'],
  routing: ['infrastructure'],
  channel: ['infrastructure'],
  scheduler: ['agent', 'infrastructure'],
  agent: ['memory', 'provider', 'bridge', 'infrastructure'],
  context: ['agent', 'memory', 'provider', 'bridge', 'routing', 'evolution', 'skill', 'security', 'infrastructure'],
  evolution: ['infrastructure'],
  security: [],
  // routes/ and bridge/ are unrestricted (they wire everything together)
};

/** 从 import 路径中提取层名称 */
function extractLayerFromImport(importPath: string, currentFile: string): string | null {
  // 只处理相对路径 import
  if (!importPath.startsWith('.')) return null;

  const dir = path.dirname(currentFile);
  const resolved = path.resolve(dir, importPath);
  const relative = path.relative(SRC_DIR, resolved);

  // 提取顶层目录名
  const parts = relative.split(path.sep);
  if (parts.length < 2) return null; // server.ts 等根文件

  return parts[0];
}

/** 获取文件所在的层 */
function getFileLayer(filePath: string): string | null {
  const relative = path.relative(SRC_DIR, filePath);
  const parts = relative.split(path.sep);
  if (parts.length < 2) return null; // 根文件
  return parts[0];
}

/** 递归扫描 .ts 文件（排除 __tests__） */
function scanTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/** 提取 import 路径（排除 import type / export type — type-only 不产生运行时依赖） */
function extractImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: string[] = [];
  const re = /(?:import|export)\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const fullMatch = m[0];
    if (/^(?:import|export)\s+type\s/.test(fullMatch)) continue;
    imports.push(m[1]);
  }
  return imports;
}

interface Violation {
  file: string;
  layer: string;
  importedLayer: string;
  importPath: string;
}

/** 检测层级违反 */
function detectViolations(): Violation[] {
  const violations: Violation[] = [];
  const files = scanTsFiles(SRC_DIR);

  for (const file of files) {
    const layer = getFileLayer(file);
    if (!layer) continue;

    // 跳过不受限的层
    if (!LAYER_RULES[layer]) continue;

    const allowedDeps = LAYER_RULES[layer];
    const imports = extractImports(file);

    for (const imp of imports) {
      const importedLayer = extractLayerFromImport(imp, file);
      if (!importedLayer) continue;
      if (importedLayer === layer) continue; // 同层引用 OK

      // 检查是否允许
      if (!allowedDeps.includes(importedLayer)) {
        violations.push({
          file: path.relative(SRC_DIR, file),
          layer,
          importedLayer,
          importPath: imp,
        });
      }
    }
  }

  return violations;
}

describe('架构守卫: 层级边界检测', () => {
  it('应正确识别层级', () => {
    const layers = Object.keys(LAYER_RULES);
    // 确认这些目录存在
    for (const layer of layers) {
      const layerDir = path.join(SRC_DIR, layer);
      expect(fs.existsSync(layerDir), `层 "${layer}" 目录不存在: ${layerDir}`).toBe(true);
    }
  });

  it('不应存在层级依赖违反', () => {
    const violations = detectViolations();
    if (violations.length > 0) {
      const formatted = violations.map((v, i) =>
        `\n  ${i + 1}. ${v.file}: ${v.layer} → ${v.importedLayer} (${v.importPath})`
      ).join('');
      expect.fail(`发现 ${violations.length} 个层级违反:${formatted}`);
    }
    expect(violations).toEqual([]);
  });
});
