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
  /** 允许预批准的工具列表（实验性） */
  allowedTools?: string[];
  /** 禁用模型自主调用（仅 /skill:name 可触发） */
  disableModelInvocation?: boolean;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  /** EvoClaw 扩展：门控要求 */
  requires?: SkillRequires;
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
export type SkillSource = 'clawhub' | 'github' | 'local';

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
  type: 'eval' | 'function_constructor' | 'fetch' | 'fs_write' | 'shell_exec' | 'env_access';
  file: string;
  line: number;
  snippet: string;
  severity: 'low' | 'medium' | 'high';
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
}
