/**
 * 扩展包安装器
 *
 * 将解析后的扩展包安装到用户级或 Agent 级目录。
 * Skills → 复制到 skills 目录
 * MCP Servers → 合并到配置文件
 * 安全策略 → 合并到全局策略
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import type { ParsedExtensionPack, ExtensionPackInstallResult } from '@evoclaw/shared';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import { mergeSecurityPolicies } from '../security/extension-security.js';
import { refreshSkillCache } from '../context/plugins/tool-registry.js';
import { registerInstalledPack } from './pack-registry.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('pack-installer');

/**
 * 安装扩展包
 *
 * @param parsed 解析后的扩展包
 * @param configManager 配置管理器
 * @param agentId 目标 Agent ID（为空则安装到用户级）
 */
export async function installExtensionPack(
  parsed: ParsedExtensionPack,
  configManager: ConfigManager,
  agentId?: string,
): Promise<ExtensionPackInstallResult> {
  const { manifest, skillDirs } = parsed;
  const warnings: string[] = [];
  const installedSkills: string[] = [];
  const installedMcpServers: string[] = [];

  // 如果解析有致命错误，拒绝安装
  if (parsed.errors.length > 0) {
    return {
      success: false,
      installedSkills: [],
      installedMcpServers: [],
      securityPolicyApplied: false,
      warnings: [],
      error: `解析错误: ${parsed.errors.join('; ')}`,
    };
  }

  // 1. 安装 Skills
  const targetSkillsDir = agentId
    ? path.join(os.homedir(), DEFAULT_DATA_DIR, 'agents', agentId, 'workspace', 'skills')
    : path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');

  for (const skillDir of skillDirs) {
    const skillName = path.basename(skillDir);
    const destDir = path.join(targetSkillsDir, skillName);

    try {
      // 如果目标已存在，先备份
      if (fs.existsSync(destDir)) {
        warnings.push(`技能 "${skillName}" 已存在，将被覆盖`);
        fs.rmSync(destDir, { recursive: true, force: true });
      }

      fs.mkdirSync(destDir, { recursive: true });
      copyDirRecursive(skillDir, destDir);
      installedSkills.push(skillName);
      log.info(`安装技能 "${skillName}" → ${destDir}`);
    } catch (err) {
      warnings.push(`技能 "${skillName}" 安装失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. 合并 MCP Server 配置
  if (manifest.mcpServers && manifest.mcpServers.length > 0) {
    const config = configManager.getConfig();
    const existing = config.models?.providers ? Object.keys(config.models.providers) : [];

    // MCP 配置存储在 evo_claw.json 中（由 discoverMcpConfigs 读取）
    // 这里通过写入 .mcp.json 到数据目录
    const mcpConfigPath = path.join(os.homedir(), DEFAULT_DATA_DIR, '.mcp.json');
    let existingMcpConfigs: Record<string, unknown> = {};
    try {
      if (fs.existsSync(mcpConfigPath)) {
        existingMcpConfigs = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8')) as Record<string, unknown>;
      }
    } catch { /* ignore */ }

    const mcpServers = (existingMcpConfigs.mcpServers ?? {}) as Record<string, unknown>;

    for (const server of manifest.mcpServers) {
      if (mcpServers[server.name]) {
        warnings.push(`MCP 服务器 "${server.name}" 已存在，跳过`);
        continue;
      }
      mcpServers[server.name] = server;
      installedMcpServers.push(server.name);
      log.info(`安装 MCP 服务器配置 "${server.name}"`);
    }

    existingMcpConfigs.mcpServers = mcpServers;
    fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
    fs.writeFileSync(mcpConfigPath, JSON.stringify(existingMcpConfigs, null, 2), 'utf-8');
  }

  // 3. 合并安全策略
  let securityPolicyApplied = false;
  if (manifest.securityPolicy) {
    const currentPolicy = configManager.getSecurityPolicy() ?? {};
    const merged = {
      skills: mergeSecurityPolicies(currentPolicy.skills, manifest.securityPolicy.skills),
      mcpServers: mergeSecurityPolicies(currentPolicy.mcpServers, manifest.securityPolicy.mcpServers),
    };
    configManager.updateSecurityPolicy(merged);
    securityPolicyApplied = true;
    log.info('安全策略已合并');
  }

  // 4. 刷新 Skill 缓存
  if (agentId) {
    refreshSkillCache(agentId);
  }

  // 5. 记录安装信息
  registerInstalledPack({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    installedAt: new Date().toISOString(),
    agentId,
    skills: installedSkills,
    mcpServers: installedMcpServers,
  });

  // 6. 清理临时目录
  try {
    fs.rmSync(parsed.tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  log.info(`扩展包 "${manifest.name}" v${manifest.version} 安装完成: ${installedSkills.length} skills, ${installedMcpServers.length} MCP servers`);

  return {
    success: true,
    installedSkills,
    installedMcpServers,
    securityPolicyApplied,
    warnings,
  };
}

/** 递归复制目录 */
function copyDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
