/**
 * Skill 安全分析器 — 静态扫描 Skill 文件中的危险模式
 *
 * high risk → 阻止安装
 * medium risk → 警告 + 需用户确认
 */

import type { SkillSecurityReport, SkillSecurityFinding } from '@evoclaw/shared';
import fs from 'node:fs';
import path from 'node:path';

/** 危险模式规则 */
interface DangerPattern {
  type: SkillSecurityFinding['type'];
  pattern: RegExp;
  severity: SkillSecurityFinding['severity'];
}

const DANGER_PATTERNS: DangerPattern[] = [
  { type: 'eval', pattern: /\beval\s*\(/, severity: 'high' },
  { type: 'function_constructor', pattern: /new\s+Function\s*\(/, severity: 'high' },
  { type: 'shell_exec', pattern: /\b(?:exec|execSync|spawn|spawnSync)\s*\(/, severity: 'medium' },
  { type: 'fetch', pattern: /\bfetch\s*\(\s*['"`]https?:\/\//, severity: 'medium' },
  { type: 'fs_write', pattern: /\bfs\s*\.\s*(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/, severity: 'medium' },
  { type: 'env_access', pattern: /process\s*\.\s*env\s*\[/, severity: 'low' },
];

/** 扫描单个文件 */
function scanFile(filePath: string, content: string): SkillSecurityFinding[] {
  const findings: SkillSecurityFinding[] = [];
  const lines = content.split('\n');
  const relativePath = path.basename(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of DANGER_PATTERNS) {
      if (rule.pattern.test(line)) {
        findings.push({
          type: rule.type,
          file: relativePath,
          line: i + 1,
          snippet: line.trim().slice(0, 120),
          severity: rule.severity,
        });
      }
    }
  }

  return findings;
}

/** 递归收集目录中的可扫描文件 */
function collectFiles(dirPath: string): string[] {
  const files: string[] = [];
  const scanExtensions = new Set(['.md', '.ts', '.js', '.py', '.sh', '.yaml', '.yml', '.json']);

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // 跳过 node_modules 和隐藏目录
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        files.push(...collectFiles(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (scanExtensions.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // 忽略权限错误
  }

  return files;
}

/** 分析 Skill 目录的安全性 */
export function analyzeSkillSecurity(dirPath: string): SkillSecurityReport {
  const files = collectFiles(dirPath);
  const allFindings: SkillSecurityFinding[] = [];

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      allFindings.push(...scanFile(filePath, content));
    } catch {
      // 跳过不可读文件
    }
  }

  // 确定总体风险等级
  let riskLevel: SkillSecurityReport['riskLevel'] = 'low';
  if (allFindings.some(f => f.severity === 'high')) {
    riskLevel = 'high';
  } else if (allFindings.some(f => f.severity === 'medium')) {
    riskLevel = 'medium';
  }

  return { riskLevel, findings: allFindings };
}
