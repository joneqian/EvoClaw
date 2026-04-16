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
import type { InstalledSkill, NameSecurityPolicy } from '@evoclaw/shared';
import type { ChatMessage } from '@evoclaw/shared';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import { filterByPolicy } from '../../security/extension-security.js';
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
  /** Bundled Skills 目录（编译到包内） */
  bundledDir: string;
}

/** Bundled Skills 目录（相对于当前文件: context/plugins/ → ../../skill/bundled） */
export const BUNDLED_SKILLS_DIR = path.resolve(
  typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : path.dirname(new URL(import.meta.url).pathname),
  '..', '..', 'skill', 'bundled',
);

/** 默认路径（由品牌配置决定） */
const DEFAULT_PATHS: SkillPaths = {
  userDir: path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills'),
  agentDirTemplate: path.join(os.homedir(), DEFAULT_DATA_DIR, 'agents', '{agentId}', 'workspace', 'skills'),
  bundledDir: BUNDLED_SKILLS_DIR,
};

/** 禁用技能查询函数（返回该 Agent 禁用的技能名称集合） */
export type DisabledSkillsFn = (agentId: string) => Set<string>;

/** ToolRegistry 插件选项 */
export interface ToolRegistryOptions {
  paths?: Partial<SkillPaths>;
  /** 查询 Agent 禁用的技能 */
  getDisabledSkills?: DisabledSkillsFn;
  /** Skill 安全策略（白名单/黑名单，由 IT 管理员配置） */
  securityPolicy?: NameSecurityPolicy;
  /** MCP prompts 提供者（返回从 MCP prompts 转换的 InstalledSkill 列表） */
  mcpPromptsProvider?: () => InstalledSkill[];
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
    bundledDir: opts.paths?.bundledDir ?? DEFAULT_PATHS.bundledDir,
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

      // 合并 MCP prompt 技能（低优先级 — 同名本地技能覆盖）
      if (opts.mcpPromptsProvider) {
        const seen = new Set(skills.map(s => s.name));
        const mcpSkills = opts.mcpPromptsProvider().filter(s => !seen.has(s.name));
        if (mcpSkills.length > 0) {
          skills = [...skills, ...mcpSkills];
          log.info(`[${ctx.agentId}] 合并 ${mcpSkills.length} 个 MCP prompt 技能`);
        }
      }

      // 查询该 Agent 禁用的技能
      const disabledSet = opts.getDisabledSkills?.(ctx.agentId) ?? new Set<string>();

      // 过滤：门控通过 + 非 disableModelInvocation + 未被 Agent 禁用
      let activeSkills = skills.filter(s => s.gatesPassed && !s.disableModelInvocation && !disabledSet.has(s.name));

      // 安全策略过滤（IT 管理员白名单/黑名单）
      if (opts.securityPolicy) {
        const { allowed, denied } = filterByPolicy(activeSkills, s => s.name, opts.securityPolicy);
        if (denied.length > 0) {
          log.warn(`[${ctx.agentId}] 安全策略拦截 ${denied.length} 个技能: ${denied.map(d => `${d.item.name}(${d.reason})`).join(', ')}`);
        }
        activeSkills = allowed;
      }

      if (activeSkills.length === 0) {
        log.debug(`[${ctx.agentId}] 无活跃技能可注入`);
        return;
      }

      log.info(`[${ctx.agentId}] 注入 ${activeSkills.length} 个技能: ${activeSkills.map(s => s.name).join(', ')}`);

      // G1: 截断到最大数量 — bundled 技能享有豁免权，必须全部保留
      // others 占用 MAX_SKILLS_IN_PROMPT 扣除 bundled 后的剩余槽位
      if (activeSkills.length > MAX_SKILLS_IN_PROMPT) {
        const bundled = activeSkills.filter(s => s.source === 'bundled');
        const others = activeSkills.filter(s => s.source !== 'bundled');
        const otherSlots = Math.max(0, MAX_SKILLS_IN_PROMPT - bundled.length);
        activeSkills = [...bundled, ...others.slice(0, otherSlots)];
        log.debug(
          `[${ctx.agentId}] 截断数量: bundled ${bundled.length} 全部保留 + others ${others.length} → ${otherSlots}`,
        );
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
  scanDir(agentDir, skills, seen, 'local');

  // 用户级安装
  scanDir(paths.userDir, skills, seen, 'local');

  // Bundled（最低优先级 — 用户/Agent 同名技能覆盖 bundled）
  scanDir(paths.bundledDir, skills, seen, 'bundled');

  return skills;
}

/** 扫描单个目录 */
function scanDir(dirPath: string, skills: InstalledSkill[], seen: Set<string>, source: InstalledSkill['source']): void {
  if (!fs.existsSync(dirPath)) return;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // 子目录 → 查找 SKILL.md
        const skillMdPath = path.join(fullPath, 'SKILL.md');
        const skill = tryLoadSkill(skillMdPath, fullPath, source);
        if (skill && !seen.has(skill.name)) {
          seen.add(skill.name);
          skills.push(skill);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
        // 根目录 .md 文件直接作为 Skill
        const skill = tryLoadSkill(fullPath, dirPath, source);
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
function tryLoadSkill(filePath: string, installPath: string, source: InstalledSkill['source']): InstalledSkill | null {
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
      source,
      installPath,
      skillMdPath: filePath,
      gatesPassed: allGatesPassed(gateResults),
      disableModelInvocation: parsed.metadata.disableModelInvocation ?? false,
      executionMode: parsed.metadata.executionMode,
      whenToUse: parsed.metadata.whenToUse,
      model: parsed.metadata.model,
      argumentHint: parsed.metadata.argumentHint,
      arguments: parsed.metadata.arguments,
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
 * G1 Bundled 预算豁免：bundled 技能享有不可截断特权。
 * 算法：
 *   1. 切分 bundled / others 两组
 *   2. bundled 始终以 full 模式存在，占用预算优先
 *   3. others 在剩余预算内分级降级（full → compact → 截断）
 *   4. 极端情况 others 被完全舍弃，但 bundled 必须保留
 *
 * 注意：不暴露 SKILL.md 文件路径，引导模型通过 invoke_skill 工具加载技能
 */
function buildSkillsPrompt(skills: InstalledSkill[]): string {
  const header = `## Skills (optional reference library)
Built-in tools are your **primary** action interface — prefer them for any direct action you can do yourself.

Skills are pre-written task templates for *complex multi-step workflows* that no single built-in tool can complete on its own. Only invoke a skill when **all** of the following hold:
- The user task genuinely requires multi-step orchestration beyond what a single built-in tool provides
- A specific skill in <available_skills> below clearly matches the workflow
- You actually need its detailed instructions (not just its name as a hint)

If a built-in tool can do the job, use the built-in tool. Do NOT invoke a skill just because the keyword sounds related.

Constraint: invoke at most one skill per turn.

`;

  // 先尝试完整模式（含 description）— 快路径：整体不超预算时直接返回
  const fullEntries = skills.map(skillToFullEntry);
  const fullCatalog = `<available_skills>\n${fullEntries.join('\n')}\n</available_skills>`;
  const fullPrompt = header + fullCatalog;

  if (fullPrompt.length <= MAX_SKILLS_PROMPT_CHARS) {
    log.debug(`技能 prompt 模式: 完整 (${fullPrompt.length} chars, ${skills.length} skills)`);
    return fullPrompt;
  }

  // G1: 切分 bundled / others，bundled 享有截断豁免
  const bundled = skills.filter(s => s.source === 'bundled');
  const others = skills.filter(s => s.source !== 'bundled');

  // bundled 始终 full 模式（无 <available_skills> 包裹的内部条目）
  const bundledEntries = bundled.map(skillToFullEntry);
  const bundledEntriesStr = bundledEntries.join('\n');

  // 计算剩余预算：总预算 - header - XML 包裹标签 - bundled 条目 - 两组之间的换行
  const wrapperOverhead = '<available_skills>\n\n</available_skills>'.length + 2; // <open>\n...\n</close>
  const bundledCost = bundledEntriesStr.length + (bundledEntries.length > 0 ? 1 : 0); // + 分隔换行
  const fixedCost = header.length + wrapperOverhead + bundledCost;
  const remainingBudget = MAX_SKILLS_PROMPT_CHARS - fixedCost;

  // 构造最终 prompt 的辅助函数
  const assemble = (otherEntries: string[]): string => {
    const allEntries = [...bundledEntries, ...otherEntries];
    return `${header}<available_skills>\n${allEntries.join('\n')}\n</available_skills>`;
  };

  // 尝试 others full 模式
  const othersFullEntries = others.map(skillToFullEntry);
  const othersFullCost = othersFullEntries.join('\n').length;
  if (othersFullCost <= remainingBudget) {
    const prompt = assemble(othersFullEntries);
    log.debug(`技能 prompt 模式: 完整 (bundled 豁免) (${prompt.length} chars, ${skills.length} skills)`);
    return prompt;
  }

  // 降级：others 转 compact 模式
  const othersCompactEntries = others.map(skillToCompactEntry);
  const othersCompactCost = othersCompactEntries.join('\n').length;
  if (othersCompactCost <= remainingBudget) {
    const prompt = assemble(othersCompactEntries);
    log.info(
      `技能 prompt 降级为紧凑模式 (bundled 豁免) ` +
      `(${prompt.length} chars, ${bundled.length} bundled full + ${others.length} others compact)`,
    );
    return prompt;
  }

  // 进一步降级：others 按比例截断（仅截 others，bundled 完整保留）
  if (remainingBudget <= 0) {
    log.warn(
      `技能 prompt 预算被 bundled 完全占用，others 全部舍弃 ` +
      `(${bundled.length} bundled full + 0 / ${others.length} others)`,
    );
    return assemble([]);
  }

  const ratio = remainingBudget / othersCompactCost;
  const truncatedCount = Math.max(0, Math.floor(others.length * ratio * 0.9));
  log.warn(
    `技能 prompt 截断: others ${others.length} → ${truncatedCount} ` +
    `(bundled ${bundled.length} 全部豁免)`,
  );
  return assemble(othersCompactEntries.slice(0, truncatedCount));
}

/**
 * 完整模式条目 — name + description + whenToUse + mode + argument-hint
 *
 * G3 argument-hint：当技能声明 argumentHint 时，注入 <argument-hint> 子节点，
 * 引导 LLM 在缺参调用时向用户追问具体参数（对非技术用户的"填空式"提示）。
 */
function skillToFullEntry(s: InstalledSkill): string {
  const modeTag = s.executionMode === 'fork' ? '\n    <mode>fork</mode>' : '';
  const whenTag = s.whenToUse ? `\n    <when>${escapeXml(s.whenToUse)}</when>` : '';
  const hintTag = s.argumentHint ? `\n    <argument-hint>${escapeXml(s.argumentHint)}</argument-hint>` : '';
  const argNamesTag = s.arguments && s.arguments.length > 0
    ? `\n    <arguments>${s.arguments.map(escapeXml).join(', ')}</arguments>`
    : '';
  return `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>${whenTag}${hintTag}${argNamesTag}${modeTag}\n  </skill>`;
}

/** 紧凑模式条目 — 仅 name（省略 description + 路径，最省 token） */
function skillToCompactEntry(s: InstalledSkill): string {
  return `  <skill><name>${escapeXml(s.name)}</name></skill>`;
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
