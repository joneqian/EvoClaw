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
 *
 * 参考 OpenClaw 技能系统设计:
 * - 路径压缩 (~ 替代 home)
 * - 完整/紧凑双模式 + 预算控制
 * - 精准引导语 (mandatory scan → select → read → follow)
 */

import type { ContextPlugin, TurnContext, BootstrapContext } from '../plugin.interface.js';
import type { InstalledSkill } from '@evoclaw/shared';
import type { ChatMessage } from '@evoclaw/shared';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSkillMd } from '../../skill/skill-parser.js';
import { checkGates, allGatesPassed } from '../../skill/skill-gate.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('tool-registry');

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 已加载的 Skill 缓存（agent 级别） */
const skillCache = new Map<string, InstalledSkill[]>();

/** 最大注入技能数 */
const MAX_SKILLS_IN_PROMPT = 150;

/** 最大 prompt 字符数（超过则降级为紧凑模式） */
const MAX_SKILLS_PROMPT_CHARS = 30000;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** Skill 扫描路径配置 */
interface SkillPaths {
  /** 用户级 Skills 目录 */
  userDir: string;
  /** Agent 工作区 Skills 目录模板 */
  agentDirTemplate: string;
}

/** 默认路径（由品牌配置决定） */
const DEFAULT_PATHS: SkillPaths = {
  userDir: path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills'),
  agentDirTemplate: path.join(os.homedir(), DEFAULT_DATA_DIR, 'agents', '{agentId}', 'workspace', 'skills'),
};

/** 禁用技能查询函数（返回该 Agent 禁用的技能名称集合） */
export type DisabledSkillsFn = (agentId: string) => Set<string>;

/** ToolRegistry 插件选项 */
export interface ToolRegistryOptions {
  paths?: Partial<SkillPaths>;
  /** 查询 Agent 禁用的技能 */
  getDisabledSkills?: DisabledSkillsFn;
}

// ---------------------------------------------------------------------------
// 插件创建
// ---------------------------------------------------------------------------

/** 创建 ToolRegistry 插件 */
export function createToolRegistryPlugin(options?: ToolRegistryOptions): ContextPlugin;
/** @deprecated 使用 options 对象形式 */
export function createToolRegistryPlugin(paths?: Partial<SkillPaths>): ContextPlugin;
export function createToolRegistryPlugin(arg?: Partial<SkillPaths> | ToolRegistryOptions): ContextPlugin {
  // 兼容旧签名：直接传 paths 对象
  const isOptions = arg && ('getDisabledSkills' in arg || 'paths' in arg);
  const opts: ToolRegistryOptions = isOptions ? (arg as ToolRegistryOptions) : { paths: arg as Partial<SkillPaths> | undefined };

  const skillPaths: SkillPaths = {
    userDir: opts.paths?.userDir ?? DEFAULT_PATHS.userDir,
    agentDirTemplate: opts.paths?.agentDirTemplate ?? DEFAULT_PATHS.agentDirTemplate,
  };

  return {
    name: 'tool-registry',
    priority: 60,

    async bootstrap(ctx: BootstrapContext) {
      // 扫描并缓存已安装的 Skills
      const skills = scanSkills(ctx.agentId, skillPaths);
      skillCache.set(ctx.agentId, skills);
      log.info(`[${ctx.agentId}] 扫描到 ${skills.length} 个技能: ${skills.map(s => s.name).join(', ') || '(无)'}`);
    },

    async beforeTurn(ctx: TurnContext) {
      // 获取缓存的 Skills（如果没缓存则重新扫描）
      let skills = skillCache.get(ctx.agentId);
      if (!skills) {
        skills = scanSkills(ctx.agentId, skillPaths);
        skillCache.set(ctx.agentId, skills);
      }

      // 查询该 Agent 禁用的技能
      const disabledSet = opts.getDisabledSkills?.(ctx.agentId) ?? new Set<string>();

      // 过滤：仅包含门控通过 + 非 disableModelInvocation + 未被 Agent 禁用的 Skill
      let activeSkills = skills.filter(s => s.gatesPassed && !s.disableModelInvocation && !disabledSet.has(s.name));

      if (activeSkills.length === 0) {
        log.debug(`[${ctx.agentId}] 无活跃技能可注入`);
        return;
      }

      log.info(`[${ctx.agentId}] 注入 ${activeSkills.length} 个技能: ${activeSkills.map(s => s.name).join(', ')}`);

      // 截断到最大数量
      if (activeSkills.length > MAX_SKILLS_IN_PROMPT) {
        activeSkills = activeSkills.slice(0, MAX_SKILLS_IN_PROMPT);
      }

      // Tier 1: 生成 XML 目录（自动降级）
      const catalog = buildSkillsPrompt(activeSkills);
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

// ---------------------------------------------------------------------------
// 扫描
// ---------------------------------------------------------------------------

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
      skillMdPath: filePath,
      gatesPassed: allGatesPassed(gateResults),
      disableModelInvocation: parsed.metadata.disableModelInvocation ?? false,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt 格式化
// ---------------------------------------------------------------------------

/**
 * 构建技能 prompt — 含引导语 + XML 目录
 * 自动在完整模式和紧凑模式之间降级
 *
 * 注意：不暴露 SKILL.md 文件路径，引导模型通过 invoke_skill 工具加载技能
 */
function buildSkillsPrompt(skills: InstalledSkill[]): string {
  const header = `## Skills (mandatory)
Before replying: scan <available_skills> entries.
- If exactly one skill clearly applies: invoke it with \`invoke_skill({ skill: "name" })\`, then follow the returned instructions.
- If multiple could apply: choose the most specific one, then invoke it.
- If none clearly apply: proceed without invoking any skill.
Constraints: never invoke more than one skill up front; only invoke after selecting.

`;

  // 先尝试完整模式（含 description）
  const fullCatalog = formatSkillsFull(skills);
  const fullPrompt = header + fullCatalog;

  if (fullPrompt.length <= MAX_SKILLS_PROMPT_CHARS) {
    log.debug(`技能 prompt 模式: 完整 (${fullPrompt.length} chars, ${skills.length} skills)`);
    return fullPrompt;
  }

  // 超预算 → 降级为紧凑模式（无 description）
  const compactCatalog = formatSkillsCompact(skills);
  const compactPrompt = header + compactCatalog;

  if (compactPrompt.length <= MAX_SKILLS_PROMPT_CHARS) {
    log.info(`技能 prompt 降级为紧凑模式 (${compactPrompt.length} chars, ${skills.length} skills)`);
    return compactPrompt;
  }

  // 紧凑模式仍然超预算 → 按比例截断技能数量
  const ratio = MAX_SKILLS_PROMPT_CHARS / compactPrompt.length;
  const truncatedCount = Math.max(1, Math.floor(skills.length * ratio * 0.9));
  log.warn(`技能 prompt 截断: ${skills.length} → ${truncatedCount} skills`);
  const truncatedCatalog = formatSkillsCompact(skills.slice(0, truncatedCount));
  return header + truncatedCatalog;
}

/** 完整模式 — name + description（不含文件路径，引导用 invoke_skill） */
function formatSkillsFull(skills: InstalledSkill[]): string {
  const entries = skills.map(s =>
    `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>\n  </skill>`,
  );
  return `<available_skills>\n${entries.join('\n')}\n</available_skills>`;
}

/** 紧凑模式 — 仅 name（省略 description + 路径，最省 token） */
function formatSkillsCompact(skills: InstalledSkill[]): string {
  const entries = skills.map(s =>
    `  <skill><name>${escapeXml(s.name)}</name></skill>`,
  );
  return `<available_skills>\n${entries.join('\n')}\n</available_skills>`;
}

/** 转义 XML 特殊字符 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/** 刷新 Agent 的 Skill 缓存 */
export function refreshSkillCache(agentId: string): void {
  skillCache.delete(agentId);
}

/** 获取 Agent 已加载的 Skills（用于 API 返回） */
export function getLoadedSkills(agentId: string): InstalledSkill[] {
  return skillCache.get(agentId) ?? [];
}
