/**
 * 扩展包类型定义
 *
 * IT 管理员将 skills + MCP servers + 安全策略打成 ZIP 包，
 * 一键分发到企业内部 Agent。
 */

import type { McpServerConfig } from './mcp.js';
import type { ExtensionSecurityPolicy } from './extension-security.js';

/** 扩展包 manifest (evoclaw-pack.json) */
export interface ExtensionPackManifest {
  /** Manifest 版本（当前固定为 1） */
  manifestVersion: 1;
  /** 包名称 */
  name: string;
  /** 包描述 */
  description: string;
  /** 版本号 (semver) */
  version: string;
  /** 作者 */
  author?: string;
  /** 包含的 Skills（目录名列表，对应 ZIP 中 skills/ 子目录） */
  skills?: string[];
  /** 包含的 MCP Server 配置 */
  mcpServers?: McpServerConfig[];
  /** 安全策略覆盖（安装后合并到全局策略） */
  securityPolicy?: ExtensionSecurityPolicy;
}

/** 解析后的扩展包 */
export interface ParsedExtensionPack {
  /** 解析出的 manifest */
  manifest: ExtensionPackManifest;
  /** 临时解压目录 */
  tempDir: string;
  /** 实际存在的 skill 目录路径 */
  skillDirs: string[];
  /** 解析过程中的错误 */
  errors: string[];
}

/** 扩展包安装结果 */
export interface ExtensionPackInstallResult {
  success: boolean;
  /** 安装的 Skills */
  installedSkills: string[];
  /** 安装的 MCP Servers */
  installedMcpServers: string[];
  /** 是否应用了安全策略 */
  securityPolicyApplied: boolean;
  /** 警告信息 */
  warnings: string[];
  /** 错误信息 */
  error?: string;
}

/** 已安装扩展包记录 */
export interface InstalledExtensionPack {
  name: string;
  version: string;
  description: string;
  author?: string;
  installedAt: string;
  /** 安装到的 Agent ID（undefined = 用户级） */
  agentId?: string;
  /** 包含的 Skills */
  skills: string[];
  /** 包含的 MCP Servers */
  mcpServers: string[];
}
