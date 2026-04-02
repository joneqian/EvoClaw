/**
 * SkillTool — 模型主动调用 Skill 的 KernelTool
 *
 * 参考 Claude Code SkillTool 桥接模式:
 * - 模型通过 { skill: "web-search", args: "query" } 调用 Skill
 * - SkillTool 加载对应 SKILL.md，执行参数替换，返回指令内容
 * - 内容注入当前轮次上下文，模型按指令执行
 *
 * 与被动 Tier 1/Tier 2 注入的区别:
 * - Tier 1: system prompt 中 <available_skills> 目录（总是注入）
 * - Tier 2: 模型用 read 工具手动加载 SKILL.md（被动）
 * - SkillTool: 模型调用此工具主动加载 + 参数替换（主动）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseSkillMd } from './skill-parser.js';
import { substituteArguments } from './skill-arguments.js';

// 避免跨层导入 agent/kernel/types.ts — 使用兼容接口
// 返回的对象兼容 KernelTool，由调用方做 type assertion
interface ToolLike {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly searchHint?: string;
  call(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }>;
  isReadOnly(): boolean;
  isConcurrencySafe(): boolean;
}

/**
 * 创建 SkillTool
 *
 * @param skillPaths Skill 搜索路径列表
 * @returns 兼容 KernelTool 接口的工具（调用方用 as KernelTool 转换）
 */
export function createSkillTool(skillPaths: string[]): ToolLike {
  return {
    name: 'invoke_skill',
    description: `执行一个已安装的 Skill（技能）。

当用户请求的任务与 <available_skills> 中列出的技能匹配时，使用此工具加载该技能的完整指令，然后按指令执行。
Skill 提供专业的多步工作流，比直接使用基础工具更可靠、更全面。

使用方式:
- invoke_skill({ skill: "技能名称" }) — 加载技能指令
- invoke_skill({ skill: "技能名称", args: "参数" }) — 加载并传入参数

示例:
- 用户要搜索信息 → invoke_skill({ skill: "web-search", args: "搜索内容" })
- 用户要生成文档 → invoke_skill({ skill: "Word / DOCX", args: "文档要求" })
- 用户要分析数据 → invoke_skill({ skill: "Excel / XLSX", args: "数据需求" })

如果 <available_skills> 中没有匹配的技能，直接使用基础工具即可。`,
    searchHint: 'skill invoke command prompt workflow',
    inputSchema: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Skill 名称（从 <available_skills> 目录中选择）',
        },
        args: {
          type: 'string',
          description: '传递给 Skill 的参数（可选，用于替换 SKILL.md 中的 $ARGUMENTS 占位符）',
        },
      },
      required: ['skill'],
    },

    async call(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      const skillName = String(input.skill ?? '').trim();
      const args = String(input.args ?? '').trim();

      if (!skillName) {
        return { content: '请指定 Skill 名称', isError: true };
      }

      // 在所有 skill 路径中搜索匹配的 SKILL.md
      const skillMdContent = findSkillContent(skillName, skillPaths);
      if (!skillMdContent) {
        return { content: `未找到 Skill: ${skillName}。请检查名称是否正确，或使用 ToolSearch 搜索可用 Skill。`, isError: true };
      }

      const parsed = parseSkillMd(skillMdContent);
      if (!parsed) {
        return { content: `Skill ${skillName} 的 SKILL.md 格式无效`, isError: true };
      }

      // 参数替换
      let body = parsed.body;
      if (args) {
        body = substituteArguments(body, args);
      }

      // 返回指令内容（模型将按此执行）
      const header = `# Skill: ${parsed.metadata.name}\n> ${parsed.metadata.description}\n\n`;
      return { content: header + body };
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  };
}

/**
 * 在 skill 路径中搜索指定名称的 SKILL.md
 */
function findSkillContent(skillName: string, skillPaths: string[]): string | null {
  const normalizedName = skillName.toLowerCase();

  for (const basePath of skillPaths) {
    if (!fs.existsSync(basePath)) continue;

    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // 目录名匹配（不区分大小写）
        if (entry.name.toLowerCase() === normalizedName) {
          const skillMdPath = path.join(basePath, entry.name, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            return fs.readFileSync(skillMdPath, 'utf-8');
          }
        }
      }
    } catch {
      // 目录不可读，跳过
    }
  }

  return null;
}
