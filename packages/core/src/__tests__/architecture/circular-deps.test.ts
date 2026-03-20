/**
 * 架构守卫: 循环依赖检测
 * 扫描 src/ 目录，构建依赖图，检测循环引用
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(import.meta.dirname, '..', '..');

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

/** 提取 import 路径 */
function extractImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: string[] = [];

  // 静态 import: import ... from '...'
  const staticRe = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(content))) {
    imports.push(m[1]);
  }

  // 动态 import: import('...')
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRe.exec(content))) {
    imports.push(m[1]);
  }

  // export ... from '...'
  const reExportRe = /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = reExportRe.exec(content))) {
    imports.push(m[1]);
  }

  return imports;
}

/** 解析相对路径为绝对路径 */
function resolveImport(fromFile: string, importPath: string): string | null {
  // 只处理相对路径
  if (!importPath.startsWith('.')) return null;

  const dir = path.dirname(fromFile);
  let resolved = path.resolve(dir, importPath);

  // .js → .ts 映射
  if (resolved.endsWith('.js')) {
    resolved = resolved.slice(0, -3) + '.ts';
  }

  // 尝试直接匹配
  if (fs.existsSync(resolved)) return resolved;

  // 尝试加 .ts
  if (fs.existsSync(resolved + '.ts')) return resolved + '.ts';

  // 尝试 index.ts
  if (fs.existsSync(path.join(resolved, 'index.ts'))) return path.join(resolved, 'index.ts');

  return null;
}

/** 构建依赖图 */
function buildDependencyGraph(rootDir: string): Map<string, Set<string>> {
  const files = scanTsFiles(rootDir);
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    const deps = new Set<string>();
    const imports = extractImports(file);
    for (const imp of imports) {
      const resolved = resolveImport(file, imp);
      if (resolved) deps.add(resolved);
    }
    graph.set(file, deps);
  }

  return graph;
}

/** DFS 三色标记检测循环 */
function detectCycles(graph: Map<string, Set<string>>): string[][] {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();
  const cycles: string[][] = [];

  for (const node of graph.keys()) {
    color.set(node, WHITE);
  }

  function dfs(node: string): void {
    color.set(node, GREY);
    const deps = graph.get(node) ?? new Set();
    for (const dep of deps) {
      if (!graph.has(dep)) continue; // 外部依赖，跳过
      const depColor = color.get(dep) ?? WHITE;
      if (depColor === GREY) {
        // 发现环 — 回溯提取环路径
        const cycle: string[] = [dep];
        let current = node;
        while (current !== dep) {
          cycle.push(current);
          current = parent.get(current) ?? dep;
        }
        cycle.push(dep);
        cycle.reverse();
        cycles.push(cycle.map(f => path.relative(rootDir, f)));
      } else if (depColor === WHITE) {
        parent.set(dep, node);
        dfs(dep);
      }
    }
    color.set(node, BLACK);
  }

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) {
      dfs(node);
    }
  }

  return cycles;
}

const rootDir = SRC_DIR;

describe('架构守卫: 循环依赖检测', () => {
  it('应成功构建依赖图', () => {
    const graph = buildDependencyGraph(rootDir);
    expect(graph.size).toBeGreaterThan(0);
  });

  it('不应存在循环依赖', () => {
    const graph = buildDependencyGraph(rootDir);
    const cycles = detectCycles(graph);
    if (cycles.length > 0) {
      const formatted = cycles.map((c, i) =>
        `\n  环 ${i + 1}: ${c.join(' → ')}`
      ).join('');
      expect.fail(`发现 ${cycles.length} 个循环依赖:${formatted}`);
    }
    expect(cycles).toEqual([]);
  });
});
