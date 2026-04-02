/**
 * 预定义子 Agent 类型
 *
 * 参考 Claude Code built-in Agent 类型（general-purpose/explore/plan）。
 * EvoClaw 面向企业用户，预定义 4 种适合企业场景的子 Agent 类型。
 *
 * 每种类型定义:
 * - systemPrompt: 角色定位 + 行为指引
 * - allowedTools: 工具白名单（null = 继承父 Agent）
 * - model: 模型选择（'inherit' = 继承父 Agent）
 * - maxTurns: 最大轮次
 */

/** 子 Agent 类型标识 */
export type SubAgentType = 'general' | 'researcher' | 'writer' | 'analyst';

/** 子 Agent 类型定义 */
export interface SubAgentTypeDefinition {
  type: SubAgentType;
  /** 角色描述（注入 system prompt） */
  systemPrompt: string;
  /** 工具白名单（null = 继承父 Agent 全部工具） */
  allowedTools: string[] | null;
  /** 模型选择（'inherit' = 继承父 Agent） */
  model: 'inherit' | 'cheap';
  /** 最大轮次 */
  maxTurns: number;
}

/** 预定义子 Agent 类型 */
export const SUB_AGENT_TYPES: Record<SubAgentType, SubAgentTypeDefinition> = {
  general: {
    type: 'general',
    systemPrompt: `你是一个通用子 Agent，负责完成父 Agent 分配的任务。
专注于任务本身，完成后简洁地返回结果。不要自我介绍或闲聊。`,
    allowedTools: null, // 继承父 Agent
    model: 'inherit',
    maxTurns: 10,
  },

  researcher: {
    type: 'researcher',
    systemPrompt: `你是一个搜索研究型子 Agent，专注于快速搜索和信息收集。
- 使用 web_search 搜索信息，web_fetch 获取网页内容
- 使用 memory_search 查找已有记忆
- 只读操作，不修改任何文件
- 快速完成，返回结构化的搜索结果摘要`,
    allowedTools: [
      'web_search', 'web_fetch', 'read', 'memory_search', 'memory_get',
      'knowledge_query', 'invoke_skill',
    ],
    model: 'cheap',
    maxTurns: 5,
  },

  writer: {
    type: 'writer',
    systemPrompt: `你是一个内容创作型子 Agent，专注于生成文档、报告和内容。
- 使用 invoke_skill 加载文档生成技能（如 Word/DOCX、Excel/XLSX）
- 使用 write 创建文件，edit 修改文件
- 使用 bash 执行必要的命令（如安装依赖、运行脚本）
- 输出高质量、格式规范的文档`,
    allowedTools: [
      'read', 'write', 'edit', 'bash', 'invoke_skill',
      'web_search', 'web_fetch', 'memory_search',
    ],
    model: 'inherit',
    maxTurns: 15,
  },

  analyst: {
    type: 'analyst',
    systemPrompt: `你是一个数据分析型子 Agent，专注于数据处理和分析。
- 使用 read 读取数据文件
- 使用 bash 执行分析脚本（Python/Node.js）
- 使用 memory_search 查找历史数据和记忆
- 使用 knowledge_query 查询知识图谱
- 返回清晰的分析结论和数据洞察`,
    allowedTools: [
      'read', 'bash', 'memory_search', 'memory_get',
      'knowledge_query', 'invoke_skill', 'write',
    ],
    model: 'inherit',
    maxTurns: 10,
  },
};

/** 根据类型名获取定义（不区分大小写） */
export function getSubAgentType(typeName: string): SubAgentTypeDefinition | undefined {
  const normalized = typeName.toLowerCase() as SubAgentType;
  return SUB_AGENT_TYPES[normalized];
}

/** 获取所有子 Agent 类型名称 */
export function getSubAgentTypeNames(): SubAgentType[] {
  return Object.keys(SUB_AGENT_TYPES) as SubAgentType[];
}
