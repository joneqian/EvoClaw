/**
 * 扩展包类型定义
 *
 * ExtensionPackManifest 从 Zod Schema 推断（单一事实来源）
 * 其余类型为纯结构体，手写即可
 */

import type { z } from 'zod';
import type { extensionPackManifestSchema } from '../schemas/extension-pack.schema.js';

/** 扩展包 manifest (evoclaw-pack.json) — 从 Schema 推断 */
export type ExtensionPackManifest = z.infer<typeof extensionPackManifestSchema>;

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
