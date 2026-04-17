/** Skill 元数据 — 从 SKILL.md YAML frontmatter 解析 */
export interface SkillMetadata {
  /** Skill 名称（必需） */
  name: string;
  /** Skill 描述（必需，无则不加载） */
  description: string;
  /** 版本号 */
  version?: string;
  /** 作者 */
  author?: string;
  /** 兼容性说明（信息性，最多 500 字符） */
  compatibility?: string;
  /**
   * 允许预批准的工具列表 — auto-approval 语义（减少审批弹窗），非限制语义。
   *
   * ⚠️ 当前仅 fork 模式生效：fork 子代理启动时会把该列表注入子会话的自动放行规则。
   * inline 模式下该字段**不会被运行时消费**（只是被解析存储），声明了也不会触发自动放行，
   * 仍然走主会话的默认权限流程。如需在 inline 模式下生效，需要实现 contextModifier
   * runtime 注入（属 P1 增强，非当前行为）。
   */
  allowedTools?: string[];
  /** 禁用模型自主调用（仅 /skill:name 可触发） */
  disableModelInvocation?: boolean;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  /** EvoClaw 扩展：门控要求 */
  requires?: SkillRequires;
  /** 执行模式: inline(注入当前上下文) / fork(子代理独立执行)。默认 inline */
  executionMode?: SkillExecutionMode;
  /** 触发条件描述（比 description 更聚焦于使用场景，引导模型精准触发） */
  whenToUse?: string;
  /** 建议使用的模型（格式: provider/modelId，未配置时降级为当前默认模型） */
  model?: string;
  /**
   * 参数提示（面向非技术用户的"填空式"示例）。
   * 示例：`argument-hint: "month=4 week=1"` 或 `argument-hint: "<文件路径>"`
   * 渲染到 system prompt 的 <argument-hint> 节点，引导 LLM 在缺参时主动向用户追问。
   */
  argumentHint?: string;
  /**
   * 命名参数列表（可选）。声明后支持：
   * 1. 模型在 body 中使用 `${name}` 占位符
   * 2. 纯位置参数调用（`args: "4 1"`）自动按顺序映射到命名参数
   * 3. kv 风格调用（`args: "month=4 week=1"`）直接按名匹配
   */
  arguments?: string[];
}

/** EvoClaw 扩展门控要求（PI/AgentSkills 规范不定义此字段） */
export interface SkillRequires {
  /** 需要的二进制工具 */
  bins?: string[];
  /** 需要的环境变量 */
  env?: string[];
  /** 支持的操作系统 */
  os?: string[];
}

/** Skill 来源 */
export type SkillSource = 'clawhub' | 'github' | 'local' | 'bundled' | 'mcp';

/** Skill 执行模式 */
export type SkillExecutionMode = 'inline' | 'fork';

/** Skill 搜索结果 */
export interface SkillSearchResult {
  name: string;
  slug?: string;
  description: string;
  /** 中文描述 */
  descriptionZh?: string;
  version?: string;
  author?: string;
  downloads?: number;
  /** 安装数 */
  installs?: number;
  /** 收藏数 */
  stars?: number;
  /** 热度分数 */
  score?: number;
  /** 分类 */
  category?: string;
  source: SkillSource;
  /** 本地路径（仅 local 有值） */
  localPath?: string;
}

/** Skill 安全分析结果 */
export interface SkillSecurityReport {
  riskLevel: 'low' | 'medium' | 'high';
  findings: SkillSecurityFinding[];
}

/** 安全分析发现项 */
export interface SkillSecurityFinding {
  type:
    | 'eval'
    | 'function_constructor'
    | 'fetch'
    | 'fs_write'
    | 'shell_exec'
    | 'env_access'
    /** 访问系统级凭据存储（macOS Keychain / Windows Credential Vault / Linux libsecret 等） */
    | 'keystore'
    /** 疑似隐蔽外传（base64/hex 编码拼 URL、图片 beacon、模板字面量注入查询串等） */
    | 'exfiltration'
    /** 疑似 DNS 隧道（变量插值的 dns.resolve / nslookup / dig） */
    | 'dns_tunnel'
    /** 疑似持久化（写入 shell rc / crontab / launchd / systemd user unit） */
    | 'persistence';
  file: string;
  line: number;
  snippet: string;
  severity: 'low' | 'medium' | 'high';
}

/** 安装策略决策
 * - auto: 直接允许（bundled/local 或 clawhub+low 等可信场景）
 * - require-confirm: 允许但要求用户显式确认"我理解风险"
 * - block: 无条件拒绝（一般是 high risk 或被管理员黑名单）
 */
export type SkillInstallPolicy = 'auto' | 'require-confirm' | 'block';

/** 安装策略附带的原因（UI 展示用） */
export interface SkillInstallPolicyDecision {
  policy: SkillInstallPolicy;
  /** 人类可读的原因（中文），如"来自第三方 GitHub 仓库，未经审核" */
  reason: string;
}

/** Skill 安装准备结果 */
export interface SkillPrepareResult {
  prepareId: string;
  metadata: SkillMetadata;
  source: SkillSource;
  securityReport: SkillSecurityReport;
  /** 门控检查结果 */
  gateResults?: SkillGateResult[];
  /** 临时目录路径 */
  tempPath: string;
  /** M5 T2: 安装策略决策（由 decideInstallPolicy(source, riskLevel, override) 得出） */
  installPolicy?: SkillInstallPolicyDecision;
}

/** 门控检查结果 */
export interface SkillGateResult {
  type: 'bin' | 'env' | 'os';
  name: string;
  satisfied: boolean;
  message?: string;
}

/** 已安装的 Skill 信息 */
export interface InstalledSkill {
  name: string;
  description: string;
  version?: string;
  author?: string;
  source: SkillSource;
  installPath: string;
  /** SKILL.md 文件的完整路径 */
  skillMdPath?: string;
  /** 门控状态 */
  gatesPassed: boolean;
  /** 是否禁用模型自主调用 */
  disableModelInvocation: boolean;
  /** 执行模式 */
  executionMode?: SkillExecutionMode;
  /** 触发条件描述 */
  whenToUse?: string;
  /** 建议使用的模型 (provider/modelId) */
  model?: string;
  /** 参数提示（面向用户的"填空式"示例） */
  argumentHint?: string;
  /** 命名参数列表 */
  arguments?: string[];
}
