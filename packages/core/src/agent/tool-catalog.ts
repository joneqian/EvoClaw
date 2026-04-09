/**
 * 工具目录 — 规范化的工具 ID、分区、描述定义
 * 参考 OpenClaw tool-catalog.ts
 */

/** 工具功能分区 */
export type ToolSection = 'fs' | 'runtime' | 'web' | 'memory' | 'agent' | 'media' | 'channel';

/** 核心工具定义 */
export interface CoreToolMeta {
  id: string;
  section: ToolSection;
  label: string;
  description: string;
}

/** 所有核心工具元数据 */
export const CORE_TOOLS: readonly CoreToolMeta[] = [
  // fs
  { id: 'read', section: 'fs', label: '读取', description: '读取文件内容（支持文本和图片）' },
  { id: 'write', section: 'fs', label: '写入', description: '写入新文件或覆盖文件' },
  { id: 'edit', section: 'fs', label: '编辑', description: '精确编辑文件（需匹配原文）' },
  { id: 'apply_patch', section: 'fs', label: '补丁', description: '应用多文件统一补丁' },
  // runtime
  { id: 'bash', section: 'runtime', label: '命令', description: '执行 shell 命令' },
  { id: 'exec_background', section: 'runtime', label: '后台', description: '后台启动长时间任务' },
  { id: 'process', section: 'runtime', label: '进程', description: '管理后台进程' },
  // web
  { id: 'web_search', section: 'web', label: '搜索', description: '网页搜索（Brave API）' },
  { id: 'web_fetch', section: 'web', label: '抓取', description: '抓取网页转换为 Markdown' },
  // memory
  { id: 'memory_search', section: 'memory', label: '记忆搜索', description: '语义搜索记忆（L0/L1 混合索引）' },
  { id: 'memory_get', section: 'memory', label: '记忆获取', description: '获取记忆详情（L2 完整内容）' },
  { id: 'memory_write', section: 'memory', label: '记忆写入', description: '即时写入新记忆到 DB（用户说"记住"时调用）' },
  { id: 'memory_update', section: 'memory', label: '记忆更新', description: '修改现有记忆的 L1/L2 内容（L0 锁死）' },
  { id: 'memory_delete', section: 'memory', label: '记忆删除', description: '软删除一条记忆' },
  { id: 'memory_forget_topic', section: 'memory', label: '话题遗忘', description: '按关键词批量软删除相关记忆' },
  { id: 'memory_pin', section: 'memory', label: '记忆置顶', description: '钉选/取消钉选记忆，免疫热度衰减' },
  { id: 'knowledge_query', section: 'memory', label: '知识查询', description: '查询知识图谱（实体关系）' },
  // agent
  { id: 'spawn_agent', section: 'agent', label: '派生', description: '创建子 Agent 并行处理任务' },
  { id: 'list_agents', section: 'agent', label: '列表', description: '查看子 Agent 状态' },
  { id: 'kill_agent', section: 'agent', label: '终止', description: '终止子 Agent' },
  { id: 'steer_agent', section: 'agent', label: '纠偏', description: '纠偏运行中的子 Agent' },
  { id: 'yield_agents', section: 'agent', label: '等待', description: '等待子 Agent 完成' },
  { id: 'todo_write', section: 'agent', label: '任务', description: '更新结构化任务列表（最多20项，同时仅1个进行中）' },
  // media
  { id: 'image', section: 'media', label: '图片', description: '分析图片内容（vision）' },
  { id: 'pdf', section: 'media', label: 'PDF', description: '阅读和分析 PDF 文档' },
  { id: 'browser', section: 'web', label: '浏览器', description: '浏览器自动化（导航、截图、交互）' },
  { id: 'image_generate', section: 'media', label: '生成图片', description: '使用 AI 生成图片（DALL-E）' },
  // channel（动态，按 session 注入）
  { id: 'desktop_notify', section: 'channel', label: '通知', description: '发送桌面通知' },
  { id: 'feishu_send', section: 'channel', label: '飞书', description: '通过飞书发送文本消息' },
  { id: 'feishu_card', section: 'channel', label: '飞书卡片', description: '通过飞书发送卡片消息' },
  { id: 'wecom_send', section: 'channel', label: '企微', description: '通过企业微信发送消息' },
  { id: 'weixin_send', section: 'channel', label: '微信', description: '通过微信发送文本消息' },
  { id: 'weixin_send_media', section: 'channel', label: '微信媒体', description: '通过微信发送媒体文件' },
] as const;

/** 按分区获取工具列表 */
export function listToolsBySection(section: ToolSection): CoreToolMeta[] {
  return CORE_TOOLS.filter(t => t.section === section);
}

/** 获取工具元数据 */
export function getToolMeta(toolId: string): CoreToolMeta | undefined {
  return CORE_TOOLS.find(t => t.id === toolId);
}

/** 获取所有工具 ID */
export function getAllToolIds(): string[] {
  return CORE_TOOLS.map(t => t.id);
}

// ─── 工具 Profile 系统 ───

/** 工具 Profile — 按场景预配置工具集 */
export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

/** Profile → 允许的工具 ID 列表（null = 允许所有） */
export const TOOL_PROFILES: Record<ToolProfileId, readonly string[] | null> = {
  minimal: ['read', 'ls', 'find', 'grep'],
  coding: [
    'read', 'write', 'edit', 'apply_patch',
    'bash', 'exec_background', 'process',
    'web_search', 'web_fetch',
    'memory_search', 'memory_get',
    'memory_write', 'memory_update', 'memory_delete', 'memory_forget_topic', 'memory_pin',
    'knowledge_query',
    'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent', 'yield_agents',
    'image', 'pdf',
    'browser', 'image_generate',
    'todo_write',
  ],
  messaging: [
    'read', 'memory_search', 'memory_get',
    'memory_write', 'memory_update', 'memory_delete', 'memory_forget_topic', 'memory_pin',
    'web_search', 'web_fetch',
    'todo_write',
    // channel 工具是动态的，运行时添加
  ],
  full: null, // null = 允许所有工具
};

/** 获取 Profile 的允许工具列表 (null = 全部允许) */
export function getProfileAllowList(profile: ToolProfileId): readonly string[] | null {
  return TOOL_PROFILES[profile] ?? null;
}

/** 按 Profile 过滤工具 */
export function filterToolsByProfile<T extends { name: string }>(tools: T[], profile: ToolProfileId): T[] {
  const allowList = TOOL_PROFILES[profile];
  if (!allowList) return tools; // full profile = 不过滤
  const allowSet = new Set(allowList);
  return tools.filter(t => allowSet.has(t.name));
}
