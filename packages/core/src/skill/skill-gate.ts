/**
 * Skill 门控检查 — EvoClaw 自定义扩展
 *
 * PI/AgentSkills 规范本身不实现门控。EvoClaw 解析 SKILL.md frontmatter
 * 中的 requires 字段，检查系统环境是否满足要求。
 */

import type { SkillMetadata, SkillGateResult, SkillRequires } from '@evoclaw/shared';
import { execSync } from 'node:child_process';

/** 执行门控检查 */
export function checkGates(metadata: SkillMetadata): SkillGateResult[] {
  const requires = metadata.requires;
  if (!requires) return [];

  const results: SkillGateResult[] = [];

  if (requires.bins) {
    for (const bin of requires.bins) {
      results.push(checkBin(bin));
    }
  }

  if (requires.env) {
    for (const envVar of requires.env) {
      results.push(checkEnv(envVar));
    }
  }

  if (requires.os) {
    results.push(checkOs(requires.os));
  }

  return results;
}

/** 检查所有门控是否通过 */
export function allGatesPassed(results: SkillGateResult[]): boolean {
  return results.length === 0 || results.every(r => r.satisfied);
}

/** 检查二进制工具是否存在 */
function checkBin(bin: string): SkillGateResult {
  try {
    execSync(`which ${bin}`, { stdio: 'pipe' });
    return { type: 'bin', name: bin, satisfied: true };
  } catch {
    return {
      type: 'bin',
      name: bin,
      satisfied: false,
      message: `未找到命令: ${bin}`,
    };
  }
}

/** 检查环境变量是否存在 */
function checkEnv(envVar: string): SkillGateResult {
  const exists = process.env[envVar] !== undefined;
  return {
    type: 'env',
    name: envVar,
    satisfied: exists,
    message: exists ? undefined : `未设置环境变量: ${envVar}`,
  };
}

/** 检查操作系统是否匹配 */
function checkOs(supportedOs: string[]): SkillGateResult {
  // 标准化平台名称映射
  const platformMap: Record<string, string> = {
    darwin: 'macos',
    win32: 'windows',
    linux: 'linux',
  };
  const current = platformMap[process.platform] ?? process.platform;
  const satisfied = supportedOs.some(os =>
    os.toLowerCase() === current || os.toLowerCase() === process.platform,
  );
  return {
    type: 'os',
    name: process.platform,
    satisfied,
    message: satisfied ? undefined : `当前系统 ${process.platform} 不在支持列表: ${supportedOs.join(', ')}`,
  };
}
