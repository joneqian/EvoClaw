/**
 * ToolRegistry 插件 — 渐进式 Skill 注入
 *
 * priority: 60（在 RAG(50) 之后执行）
 *
 * PI 渐进式两级注入模式：
 * - Tier 1: 生成 <available_skills> XML 目录注入 system prompt (~50-100 tokens/skill)
 * - Tier 2: 模型用 Read 工具按需加载完整 SKILL.md
 *
 * Skill 不注册新工具 — 通过指令引导模型使用已有工具
 */

import type { ContextPlugin, TurnContext, BootstrapContext } from '../plugin.interface.js';
import type { InstalledSkill } from '@evoclaw/shared';
import type { ChatMessage } from '@evoclaw/shared';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSkillMd } from '../../skill/skill-parser.js';
import { checkGates, allGatesPassed } from '../../skill/skill-gate.js';

/** 已加载的 Skill 缓存（agent 级别） */
const skillCache = new Map<string, InstalledSkill[]>();

/** Skill 扫描路径配置 */
interface SkillPaths {
  /** 用户级 Skills 目录 */
  userDir: string;
  /** Agent 工作区 Skills 目录模板 */
  agentDirTemplate: string;
}

/** 默认路径 */
const DEFAULT_PATHS: SkillPaths = {
  userDir: path.join(os.homedir(), '.evoclaw', 'skills'),
  agentDirTemplate: path.join(os.homedir(), '.evoclaw', 'agents', '{agentId}', 'workspace', 'skills'),
};

/** 创建 ToolRegistry 插件 */
export function createToolRegistryPlugin(paths?: Partial<SkillPaths>): ContextPlugin {
  const skillPaths: SkillPaths = {
    userDir: paths?.userDir ?? DEFAULT_PATHS.userDir,
    agentDirTemplate: paths?.agentDirTemplate ?? DEFAULT_PATHS.agentDirTemplate,
  };

  return {
    name: 'tool-registry',
    priority: 60,

    async bootstrap(ctx: BootstrapContext) {
      // 扫描并缓存已安装的 Skills
      const skills = scanSkills(ctx.agentId, skillPaths);
      skillCache.set(ctx.agentId, skills);
    },

    async beforeTurn(ctx: TurnContext) {
      // 获取缓存的 Skills（如果没缓存则重新扫描）
      let skills = skillCache.get(ctx.agentId);
      if (!skills) {
        skills = scanSkills(ctx.agentId, skillPaths);
        skillCache.set(ctx.agentId, skills);
      }

      // 过滤：仅包含门控通过 + 非 disableModelInvocation 的 Skill
      const activeSkills = skills.filter(s => s.gatesPassed && !s.disableModelInvocation);

      if (activeSkills.length === 0) return;

      // Tier 1: 生成 XML 目录
      const catalog = formatSkillsCatalog(activeSkills);
      ctx.injectedContext.push(catalog);

      // 估算 token 消耗（~50-100 tokens/skill）
      ctx.estimatedTokens += activeSkills.length * 75;
    },

    async compact(): Promise<ChatMessage[]> {
      // 不压缩 skill 目录（在 beforeTurn 重新注入）
      return [];
    },
  };
}

/** 扫描已安装的 Skills */
function scanSkills(agentId: string, paths: SkillPaths): InstalledSkill[] {
  const skills: InstalledSkill[] = [];
  const seen = new Set<string>();

  // Agent 工作区优先（覆盖同名）
  const agentDir = paths.agentDirTemplate.replace('{agentId}', agentId);
  scanDir(agentDir, skills, seen);

  // 用户级安装
  scanDir(paths.userDir, skills, seen);

  return skills;
}

/** 扫描单个目录 */
function scanDir(dirPath: string, skills: InstalledSkill[], seen: Set<string>): void {
  if (!fs.existsSync(dirPath)) return;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // 子目录 → 查找 SKILL.md
        const skillMdPath = path.join(fullPath, 'SKILL.md');
        const skill = tryLoadSkill(skillMdPath, fullPath);
        if (skill && !seen.has(skill.name)) {
          seen.add(skill.name);
          skills.push(skill);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
        // 根目录 .md 文件直接作为 Skill
        const skill = tryLoadSkill(fullPath, dirPath);
        if (skill && !seen.has(skill.name)) {
          seen.add(skill.name);
          skills.push(skill);
        }
      }
    }
  } catch {
    // 忽略权限错误
  }
}

/** 尝试加载 Skill */
function tryLoadSkill(filePath: string, installPath: string): InstalledSkill | null {
  try {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseSkillMd(content);
    if (!parsed) return null;

    const gateResults = checkGates(parsed.metadata);

    return {
      name: parsed.metadata.name,
      description: parsed.metadata.description,
      version: parsed.metadata.version,
      author: parsed.metadata.author,
      source: 'local',
      installPath,
      gatesPassed: allGatesPassed(gateResults),
      disableModelInvocation: parsed.metadata.disableModelInvocation ?? false,
    };
  } catch {
    return null;
  }
}

/** 生成 <available_skills> XML 目录（Tier 1 注入） */
function formatSkillsCatalog(skills: InstalledSkill[]): string {
  const entries = skills.map(s => {
    const parts = [`  <skill name="${escapeXml(s.name)}" description="${escapeXml(s.description)}"`,];
    if (s.version) parts.push(` version="${escapeXml(s.version)}"`);
    parts.push(` location="${escapeXml(s.installPath)}" />`);
    return parts.join('');
  });

  return `<available_skills>\n${entries.join('\n')}\n</available_skills>\n\n提示: 如果某个 Skill 可能对当前任务有帮助，请使用 Read 工具加载其完整内容来获取详细指令。`;
}

/** 转义 XML 特殊字符 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 刷新 Agent 的 Skill 缓存 */
export function refreshSkillCache(agentId: string): void {
  skillCache.delete(agentId);
}

/** 获取 Agent 已加载的 Skills（用于 API 返回） */
export function getLoadedSkills(agentId: string): InstalledSkill[] {
  return skillCache.get(agentId) ?? [];
}
