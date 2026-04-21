/**
 * 命令与路由清单 —— 单一事实源（M3-T3a）
 *
 * 覆盖：
 * - **HTTP Routes**：所有 sidecar 对外暴露的端点的元数据（method、path、category、
 *   description、所需权限、来源版本），前缀路径由 server.ts 的 app.route() 挂载点决定。
 *   完整 path = 挂载前缀 + 条目中的 subPath（如 '/agents' + '/:id' = '/agents/:id'）。
 * - **Agent 工具**：工具名 → 权限类别映射（原 permission-interceptor.ts 的
 *   TOOL_CATEGORY_MAP，M3-T3a 迁移到这里作为唯一来源）。
 *
 * 本文件是 `/api/commands` 和 `/api/openapi.json` 端点的数据源，前端命令面板
 * 也从这里获取展示数据。新增 route / 调整权限时请同步更新此文件，CLAUDE.md
 * 的约定与 `__tests__/routes/command-manifest.test.ts` 的回归保护提醒。
 */

import type { PermissionCategory } from '@evoclaw/shared';

// ═══════════════════════════════════════════════════════════════════════════
// Route Manifest
// ═══════════════════════════════════════════════════════════════════════════

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';

export interface RouteMeta {
  readonly method: HttpMethod;
  /** 完整路径（含挂载前缀），如 `/agents/:id` */
  readonly path: string;
  /** 分类（便于命令面板分组：agent / chat / config / mcp / memory / ...） */
  readonly category: string;
  /** 一句话中文描述（/help 与命令面板展示） */
  readonly description: string;
  /** 所需权限类别（可选，暂未对所有路由标注，未来接 RBAC） */
  readonly requiredPermission?: PermissionCategory;
  /** 引入版本（M0/M1/...） */
  readonly since: string;
}

function r(
  method: HttpMethod,
  path: string,
  category: string,
  description: string,
  opts: { requiredPermission?: PermissionCategory; since?: string } = {},
): RouteMeta {
  return {
    method,
    path,
    category,
    description,
    requiredPermission: opts.requiredPermission,
    since: opts.since ?? 'M0',
  };
}

/**
 * 所有路由的元数据清单（完整路径）。
 *
 * 注：新增路由 → 必须在此登记；删除路由 → 同步删除；修改 path/method → 同步更新。
 */
export const ROUTE_MANIFEST: readonly RouteMeta[] = [
  // ── 系统健康 ──
  r('GET', '/health', 'system', '健康检查（详细状态）'),
  r('GET', '/healthz', 'system', '简易存活探测'),
  r('GET', '/readyz', 'system', '就绪探测'),
  r('GET', '/events', 'system', '全局 SSE 事件总线'),

  // ── Agents ──
  r('GET',    '/agents',                'agent', '列出所有 Agent'),
  r('GET',    '/agents/:id',            'agent', '获取单个 Agent 详情'),
  r('POST',   '/agents',                'agent', '创建 Agent'),
  r('PATCH',  '/agents/:id',            'agent', '更新 Agent 配置'),
  r('DELETE', '/agents/:id',            'agent', '删除 Agent'),
  r('GET',    '/agents/:id/workspace',  'agent', '读取 Agent 工作区文件列表'),
  r('PUT',    '/agents/:id/workspace/:file', 'agent', '写入 Agent 工作区文件', { requiredPermission: 'file_write' }),
  r('POST',   '/agents/create-guided',  'agent', '向导式创建 Agent（LLM 辅助）'),
  r('GET',    '/agents/:id/skills',     'agent', '列出 Agent 已启用的技能'),
  r('PUT',    '/agents/:id/skills/:skillName', 'agent', '启用/禁用 Agent 的单个技能'),

  // ── Chat ──
  r('GET',    '/chat/recents',                'chat', '获取最近会话'),
  r('GET',    '/chat/:agentId/conversations', 'chat', '列出 Agent 的会话'),
  r('GET',    '/chat/:agentId/messages',      'chat', '获取会话消息'),
  r('DELETE', '/chat/:agentId/conversations', 'chat', '删除会话'),
  r('POST',   '/chat/:agentId/send',          'chat', '发送消息（SSE 流式）'),
  r('POST',   '/chat/:agentId/cancel',        'chat', '取消当前流式响应'),
  r('POST',   '/chat/:agentId/fork',          'chat', 'Fork 当前会话'),
  r('POST',   '/chat/:agentId/feedback',      'chat', '对消息打赏/标注（记忆反馈）'),

  // ── Config ──
  r('GET',    '/config',                'config', '读取合并后的配置（API Key 脱敏）'),
  r('GET',    '/config/layers',         'config', '读取各层配置详情（调试）'),
  r('PUT',    '/config',                'config', '更新用户层配置（deep merge patch）'),
  r('GET',    '/config/validate',       'config', '校验配置完整性'),
  r('GET',    '/config/warnings',       'config', '一次性取启动期凭证清理警告（M4.1）'),
  r('POST',   '/config/reload',         'config', '从磁盘重新加载配置'),
  r('PUT',    '/config/provider/:id',   'config', '添加/更新 Provider'),
  r('DELETE', '/config/provider/:id',   'config', '删除 Provider'),
  r('GET',    '/config/env-vars',       'config', '列出环境变量（脱敏）'),
  r('GET',    '/config/env-vars/:key',  'config', '获取单个环境变量明文（编辑用）'),
  r('PUT',    '/config/env-vars',       'config', '批量更新环境变量'),

  // ── Cron ──
  r('POST',   '/cron',     'cron', '创建 Cron 任务'),
  r('GET',    '/cron',     'cron', '列出 Cron 任务'),
  r('PUT',    '/cron/:id', 'cron', '更新 Cron 任务'),
  r('DELETE', '/cron/:id', 'cron', '删除 Cron 任务'),

  // ── Doctor ──
  r('GET', '/doctor',               'doctor', '系统自检'),
  r('GET', '/doctor/memory',        'doctor', '内存占用快照'),
  r('GET', '/doctor/heap-snapshot', 'doctor', '生成 heap dump'),

  // ── Evolution（Agent 进化 / 成长）──
  r('GET', '/evolution/:agentId/capabilities',     'evolution', '查询 Agent 能力图谱'),
  r('GET', '/evolution/:agentId/growth',           'evolution', '查询 Agent 成长轨迹'),
  r('GET', '/evolution/:agentId/growth/vector',    'evolution', '成长轨迹向量视图'),
  r('GET', '/evolution/:agentId/heartbeat',        'evolution', '读取 Agent Heartbeat 配置'),
  r('PUT', '/evolution/:agentId/heartbeat',        'evolution', '更新 Agent Heartbeat 配置'),

  // ── Extension Pack（企业扩展包）──
  r('POST',   '/extension-packs/install',   'extension', '安装扩展包'),
  r('POST',   '/extension-packs/preview',   'extension', '预览扩展包内容'),
  r('GET',    '/extension-packs/installed', 'extension', '列出已安装扩展包'),
  r('DELETE', '/extension-packs/:name',     'extension', '卸载扩展包'),

  // ── Knowledge（知识库）──
  r('POST',   '/knowledge/:agentId/ingest',           'knowledge', '导入知识文件'),
  r('GET',    '/knowledge/:agentId/files',            'knowledge', '列出知识文件'),
  r('DELETE', '/knowledge/:agentId/files/:fileId',    'knowledge', '删除知识文件'),
  r('POST',   '/knowledge/:agentId/reindex',          'knowledge', '重建索引'),

  // ── MCP ──
  r('GET',    '/mcp',                             'mcp', '列出所有 MCP 服务器状态'),
  r('GET',    '/mcp/tools',                       'mcp', '列出所有 MCP 工具'),
  r('GET',    '/mcp/prompts',                     'mcp', '列出所有 MCP prompts'),
  r('POST',   '/mcp/servers',                     'mcp', '添加 MCP 服务器'),
  r('DELETE', '/mcp/servers/:name',               'mcp', '移除 MCP 服务器'),
  r('POST',   '/mcp/servers/:name/reconnect',     'mcp', '手动重连 MCP 服务器（M4.1）'),

  // ── Memory（记忆系统）──
  r('POST',   '/memory/:agentId/search',                      'memory', '混合检索记忆'),
  r('POST',   '/memory/:agentId/units/batch-delete',          'memory', '批量删除记忆'),
  r('GET',    '/memory/:agentId/units',                       'memory', '列出记忆单元'),
  r('GET',    '/memory/:agentId/units/:id',                   'memory', '获取记忆详情（L2）'),
  r('PUT',    '/memory/:agentId/units/:id/pin',               'memory', 'Pin 记忆'),
  r('DELETE', '/memory/:agentId/units/:id/pin',               'memory', '取消 Pin'),
  r('POST',   '/memory/:agentId/units/:id/feedback',          'memory', '对记忆打反馈'),
  r('PUT',    '/memory/:agentId/units/:id',                   'memory', '编辑记忆内容'),
  r('DELETE', '/memory/:agentId/units/:id',                   'memory', '删除记忆（软删）'),
  r('GET',    '/memory/:agentId/knowledge-graph',             'memory', '获取知识图谱'),
  r('GET',    '/memory/:agentId/consolidations',              'memory', '查询整合记忆'),
  r('GET',    '/memory/:agentId/session-summaries',           'memory', '查询会话摘要'),

  // ── Provider ──
  r('GET',    '/provider',                        'provider', '列出已配置 Provider'),
  r('GET',    '/provider/:id/apikey',             'provider', '获取 API Key 明文（编辑用）'),
  r('GET',    '/provider/:id',                    'provider', '获取 Provider 详情'),
  r('PUT',    '/provider/:id',                    'provider', '更新 Provider'),
  r('DELETE', '/provider/:id',                    'provider', '删除 Provider'),
  r('GET',    '/provider/extensions/list',        'provider', '列出扩展 Provider'),
  r('GET',    '/provider/:id/models',             'provider', '列出 Provider 的模型'),
  r('POST',   '/provider/:id/sync-models',        'provider', '同步 Provider 的模型列表'),
  r('POST',   '/provider/:id/test',               'provider', '测试 Provider 连通性'),
  r('GET',    '/provider/default/model',          'provider', '读取默认模型'),
  r('PUT',    '/provider/default/model',          'provider', '设置默认模型'),
  r('GET',    '/provider/default/embedding',      'provider', '读取默认 embedding'),
  r('PUT',    '/provider/default/embedding',      'provider', '设置默认 embedding'),

  // ── Security / Permissions ──
  r('GET',    '/security/:id/permissions',               'security', '列出 Agent 权限'),
  r('POST',   '/security/:id/permissions',               'security', '新增权限授予'),
  r('DELETE', '/security/:id/permissions/:permId',       'security', '撤销权限'),
  r('GET',    '/security/:id/permission-stats',          'security', '权限使用统计'),
  r('POST',   '/security/:id/permissions/bulk-revoke',   'security', '批量撤销权限'),
  r('POST',   '/security/permission-decision',           'security', '前端返回权限决策'),
  r('GET',    '/security/:id/audit-log',                 'security', '查询权限审计日志'),

  // ── Security Policy（IT 管理员扩展安全策略）──
  r('GET',    '/security/policy',       'security-policy', '读取扩展安全策略'),
  r('PUT',    '/security/policy',       'security-policy', '更新扩展安全策略'),
  r('POST',   '/security/policy/check', 'security-policy', '检查扩展是否合规'),

  // ── Skill ──
  r('GET',    '/skill/browse',        'skill', '浏览 ClawHub 技能商店'),
  r('POST',   '/skill/search',        'skill', '搜索技能'),
  r('POST',   '/skill/prepare',       'skill', '下载并预检（沙盒安全扫描）'),
  r('POST',   '/skill/confirm',       'skill', '确认安装预检通过的技能'),
  r('GET',    '/skill/list',          'skill', '列出已安装技能'),
  r('DELETE', '/skill/:name',         'skill', '卸载技能'),
  r('POST',   '/skill/refresh-cache', 'skill', '刷新技能扫描缓存'),

  // ── Skill Usage (M7 Phase 2 调用 telemetry) ──
  r('GET',    '/skill-usage/effectiveness', 'skill', 'Agent 近 N 天所有 Skill 效能排行'),
  r('GET',    '/skill-usage/stats',         'skill', '单 Skill 聚合统计'),
  r('GET',    '/skill-usage/recent',        'skill', '单 Skill 最近调用详情'),
  r('GET',    '/skill-usage/summaries',     'skill', '单 Skill session 摘要列表'),
  r('POST',   '/skill-usage/:id/feedback',  'skill', '用户 👍/👎 反馈回写'),

  // ── Skill Evolution (M7.1 进化日志 + 回滚) ──
  r('GET',    '/skill-evolution/log',          'skill', '进化决策日志列表'),
  r('GET',    '/skill-evolution/log/:id',      'skill', '进化决策详情（含 before/after 内容）'),
  r('POST',   '/skill-evolution/log/:id/rollback', 'skill', '回滚一次 refine 决策'),

  // ── SOP ──
  r('GET',    '/sop/docs',              'sop', '列出 SOP 文档'),
  r('POST',   '/sop/docs/upload',       'sop', '上传 SOP 文档'),
  r('GET',    '/sop/docs/:id/text',     'sop', '读取 SOP 文档文本'),
  r('DELETE', '/sop/docs/:id',          'sop', '删除 SOP 文档'),
  r('GET',    '/sop/tags',              'sop', '列出 SOP 标签'),
  r('PUT',    '/sop/tags',              'sop', '更新 SOP 标签'),
  r('DELETE', '/sop/tags',              'sop', '删除 SOP 标签'),
  r('GET',    '/sop/draft',             'sop', '读取 SOP 草稿'),
  r('PUT',    '/sop/draft',             'sop', '更新 SOP 草稿'),
  r('DELETE', '/sop/draft',             'sop', '清除 SOP 草稿'),
  r('POST',   '/sop/draft/promote',     'sop', '草稿升级为正式 SOP'),
  r('POST',   '/sop/draft/generate',    'sop', 'AI 辅助生成 SOP 草稿'),

  // ── System Events / Tasks ──
  r('POST',   '/system-events/:agentId/events', 'system-events', '向 Agent 注入系统事件'),
  r('GET',    '/system-events/:agentId/events', 'system-events', '查询 Agent 的系统事件'),
  r('GET',    '/tasks',                         'tasks', '列出后台任务'),
  r('GET',    '/tasks/:taskId',                 'tasks', '查询任务详情'),
  r('POST',   '/tasks/:taskId/cancel',          'tasks', '取消任务'),
  r('POST',   '/tasks/prune',                   'tasks', '清理已完成任务'),

  // ── Usage（成本统计）──
  r('GET', '/usage/stats',                 'usage', 'Token 使用总计'),
  r('GET', '/usage/breakdown/:dimension',  'usage', '按维度分组的使用统计'),

  // ── Channel ──
  r('POST', '/channel/connect',              'channel', '连接渠道'),
  r('POST', '/channel/disconnect',           'channel', '断开渠道'),
  r('GET',  '/channel/status',               'channel', '查询所有渠道状态'),
  r('GET',  '/channel/status/:type',         'channel', '查询单个渠道状态'),
  r('GET',  '/channel/bindings',             'channel', '列出渠道绑定'),
  r('POST', '/channel/webhook/feishu',       'channel', '飞书 webhook'),
  r('POST', '/channel/webhook/wecom',        'channel', '企微 webhook'),
  r('GET',  '/channel/weixin/qrcode',        'channel', '获取微信登录二维码'),
  r('GET',  '/channel/weixin/qrcode-status', 'channel', '查询二维码扫描状态'),

  // ── Binding（会话 → Agent 路由绑定）──
  r('POST',   '/binding',         'binding', '新增绑定'),
  r('GET',    '/binding',         'binding', '列出绑定'),
  r('DELETE', '/binding/:id',     'binding', '删除绑定'),
  r('POST',   '/binding/resolve', 'binding', '解析绑定（调试）'),
];

// ═══════════════════════════════════════════════════════════════════════════
// Tool Manifest（M3-T3a 迁移自 permission-interceptor.ts TOOL_CATEGORY_MAP）
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolMeta {
  readonly name: string;
  readonly category: PermissionCategory;
  readonly description: string;
  /** 是否潜在破坏性（删/改/发送等） */
  readonly destructive?: boolean;
  /** 工具来源：内置 / 增强（web_search / pdf 等）/ MCP / Skill */
  readonly source: 'builtin' | 'enhanced' | 'mcp' | 'skill';
}

/**
 * 需要拦截的 Agent 工具清单。
 *
 * 与 permission-interceptor.ts 的 AUTO_ALLOW_TOOLS 互补：AUTO_ALLOW 列表中的工具
 * 不走权限拦截（纯只读或 Agent 自管理），不在此清单中。
 */
export const TOOL_MANIFEST: readonly ToolMeta[] = [
  // 文件修改
  { name: 'write',       category: 'file_write', description: '写入文件',           destructive: true,  source: 'builtin' },
  { name: 'edit',        category: 'file_write', description: '编辑文件（行级替换）', destructive: true,  source: 'builtin' },
  { name: 'apply_patch', category: 'file_write', description: '多文件 diff 应用',   destructive: true,  source: 'enhanced' },
  // 命令执行
  { name: 'bash',             category: 'shell', description: 'Shell 命令执行',       destructive: true,  source: 'builtin' },
  { name: 'shell',            category: 'shell', description: 'Shell 命令执行（别名）', destructive: true,  source: 'builtin' },
  { name: 'exec_background',  category: 'shell', description: '后台进程执行',          destructive: true,  source: 'enhanced' },
  { name: 'process',          category: 'shell', description: '进程管理（列表/停止）', destructive: false, source: 'enhanced' },
  // 网络
  { name: 'web_search', category: 'network', description: 'Brave Web 搜索',       destructive: false, source: 'enhanced' },
  { name: 'web_fetch',  category: 'network', description: 'URL 抓取 → Markdown',  destructive: false, source: 'enhanced' },
  { name: 'fetch',      category: 'network', description: 'HTTP 请求（通用）',    destructive: false, source: 'enhanced' },
  { name: 'http',       category: 'network', description: 'HTTP 请求（别名）',    destructive: false, source: 'enhanced' },
  // 浏览器
  { name: 'browse', category: 'browser', description: '浏览器自动化', destructive: false, source: 'enhanced' },
  // Skill 自管理（M7 Phase 1）
  { name: 'skill_manage', category: 'skill', description: '创建/修改/删除用户级 Skill', destructive: true, source: 'enhanced' },
];

/** 工具权限类别映射（供 permission-interceptor.ts 读取） */
export const TOOL_CATEGORY_MAP: Readonly<Record<string, PermissionCategory>> = Object.freeze(
  Object.fromEntries(TOOL_MANIFEST.map(t => [t.name, t.category])),
);

/**
 * 查工具类别（回落到 `'skill'` 表示需按 skill 分类走权限流）。
 *
 * 供 permission-interceptor.ts inferPermissionCategory 使用。
 */
export function getToolCategory(toolName: string): PermissionCategory {
  return TOOL_CATEGORY_MAP[toolName] ?? 'skill';
}
