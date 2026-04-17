/**
 * Skill 安装器 — 两步交互式安装（prepare → confirm）
 *
 * 来源：
 * - ClawHub: GET /api/v1/download?slug=&version= 下载 ZIP
 * - GitHub: git clone --depth 1 或 GitHub API 下载 ZIP
 */

import type { SkillPrepareResult, SkillSource } from '@evoclaw/shared';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { parseSkillMd } from './skill-parser.js';
import { analyzeSkillSecurity } from './skill-analyzer.js';
import { checkGates } from './skill-gate.js';
import { decideInstallPolicy, type SkillInstallPolicyOverride } from './install-policy.js';
import { writeManifest } from './install-manifest.js';

/** ClawHub API 基地址 */
const CLAWHUB_API = 'https://clawhub.ai/api/v1';

/** 待确认的安装会话（内部状态含 identifier 用于 manifest 回写） */
interface PendingInstall extends SkillPrepareResult {
  /** 原始标识：clawhub 是 slug / github 是 owner/repo 或 URL */
  identifier: string;
}
const pendingInstalls = new Map<string, PendingInstall>();

/** Skill 安装器 */
export class SkillInstaller {
  private skillsBaseDir: string;
  private getPolicyOverride?: () => SkillInstallPolicyOverride | undefined;

  constructor(
    skillsBaseDir?: string,
    getPolicyOverride?: () => SkillInstallPolicyOverride | undefined,
  ) {
    this.skillsBaseDir = skillsBaseDir ?? path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');
    this.getPolicyOverride = getPolicyOverride;
  }

  /**
   * 第一步：下载到临时目录 + 分析 → 返回 PrepareResult
   */
  async prepare(source: SkillSource, identifier: string, version?: string): Promise<SkillPrepareResult> {
    const prepareId = crypto.randomUUID();
    const tempDir = path.join(os.tmpdir(), `evoclaw-skill-${prepareId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // 下载到临时目录
      if (source === 'clawhub') {
        await this.downloadFromClawHub(identifier, tempDir, version);
      } else if (source === 'github') {
        await this.downloadFromGitHub(identifier, tempDir);
      } else {
        throw new Error(`不支持的来源: ${source}`);
      }

      // 找 SKILL.md
      const skillMdPath = this.findSkillMd(tempDir);
      if (!skillMdPath) {
        throw new Error('未找到 SKILL.md 文件');
      }

      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const parsed = parseSkillMd(content);
      if (!parsed) {
        throw new Error('SKILL.md 解析失败：缺少 name 或 description');
      }

      // 安全分析
      const securityReport = analyzeSkillSecurity(tempDir);

      // 门控检查
      const gateResults = checkGates(parsed.metadata);

      // M5 T2: 安装策略决策（来源 × 风险等级矩阵 + 可选 IT 管理员覆盖）
      const override = this.getPolicyOverride?.();
      const installPolicy = decideInstallPolicy(source, securityReport.riskLevel, override);

      const result: SkillPrepareResult = {
        prepareId,
        metadata: parsed.metadata,
        source,
        securityReport,
        gateResults,
        tempPath: tempDir,
        installPolicy,
      };

      // 存入待确认（含 identifier 供 confirm 回写 manifest）
      pendingInstalls.set(prepareId, { ...result, identifier });

      return result;
    } catch (err) {
      // 清理临时目录
      this.cleanupDir(tempDir);
      throw err;
    }
  }

  /**
   * 第二步：用户确认后执行安装
   */
  confirm(prepareId: string, agentId?: string): string {
    const pending = pendingInstalls.get(prepareId);
    if (!pending) {
      throw new Error(`未找到待确认的安装: ${prepareId}`);
    }

    pendingInstalls.delete(prepareId);

    // M5 T2: 阻止 block 策略（含高风险默认阻断 + 管理员显式 block 覆盖）
    if (pending.installPolicy?.policy === 'block') {
      this.cleanupDir(pending.tempPath);
      throw new Error(pending.installPolicy.reason || '安装策略拒绝该安装');
    }
    // 兼容旧路径：policy 未计算时仍拦截 high risk
    if (!pending.installPolicy && pending.securityReport.riskLevel === 'high') {
      this.cleanupDir(pending.tempPath);
      throw new Error('安全分析显示高风险，拒绝安装');
    }

    // 确定安装目标路径
    const targetDir = agentId
      ? path.join(this.skillsBaseDir, '..', 'agents', agentId, 'workspace', 'skills', pending.metadata.name)
      : path.join(this.skillsBaseDir, pending.metadata.name);

    // 如果已存在，先删除旧版
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // 移动临时目录到目标
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(pending.tempPath, targetDir);

    // M5 T3: 仅 clawhub 来源写 sidecar manifest（供"有新版可用"比对）
    if (pending.source === 'clawhub') {
      try {
        writeManifest(targetDir, {
          source: 'clawhub',
          slug: pending.identifier,
          installedVersion: pending.metadata.version,
          installedAt: new Date().toISOString(),
        });
      } catch {
        // 非致命：manifest 写入失败不影响安装成功
      }
    }

    return targetDir;
  }

  /** 取消安装并清理 */
  cancel(prepareId: string): void {
    const pending = pendingInstalls.get(prepareId);
    if (pending) {
      pendingInstalls.delete(prepareId);
      this.cleanupDir(pending.tempPath);
    }
  }

  /** 卸载 Skill */
  uninstall(name: string, agentId?: string): boolean {
    const targetDir = agentId
      ? path.join(this.skillsBaseDir, '..', 'agents', agentId, 'workspace', 'skills', name)
      : path.join(this.skillsBaseDir, name);

    if (!fs.existsSync(targetDir)) return false;

    fs.rmSync(targetDir, { recursive: true, force: true });
    return true;
  }

  /** 从 ClawHub 下载 ZIP */
  private async downloadFromClawHub(slug: string, destDir: string, version?: string): Promise<void> {
    const params = new URLSearchParams({ slug });
    if (version) params.set('version', version);

    const url = `${CLAWHUB_API}/download?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });

    if (!res.ok) {
      throw new Error(`ClawHub 下载失败: ${res.status} ${res.statusText}`);
    }

    // 写入临时 ZIP
    const zipPath = path.join(destDir, '_download.zip');
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buffer);

    // 解压
    execSync(`unzip -o -q "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' });
    fs.unlinkSync(zipPath);
  }

  /** 从 GitHub 下载 */
  private async downloadFromGitHub(identifier: string, destDir: string): Promise<void> {
    // 支持 owner/repo 简写 或完整 URL
    let repoUrl: string;
    if (identifier.startsWith('https://')) {
      repoUrl = identifier;
    } else {
      repoUrl = `https://github.com/${identifier}.git`;
    }

    try {
      execSync(`git clone --depth 1 "${repoUrl}" "${destDir}/repo"`, {
        stdio: 'pipe',
        timeout: 30000,
      });

      // 将 repo 内容提升到 destDir
      const repoDir = path.join(destDir, 'repo');
      const entries = fs.readdirSync(repoDir);
      for (const entry of entries) {
        if (entry === '.git') continue;
        const src = path.join(repoDir, entry);
        const dst = path.join(destDir, entry);
        fs.renameSync(src, dst);
      }
      fs.rmSync(repoDir, { recursive: true, force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub 下载失败: ${message}`);
    }
  }

  /** 在目录中查找 SKILL.md */
  private findSkillMd(dirPath: string): string | null {
    // 优先查找根目录
    const rootSkillMd = path.join(dirPath, 'SKILL.md');
    if (fs.existsSync(rootSkillMd)) return rootSkillMd;

    // 查找任何 .md 文件（根目录）
    try {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        if (entry.endsWith('.md') && !entry.startsWith('.') && entry !== 'README.md') {
          const fullPath = path.join(dirPath, entry);
          if (fs.statSync(fullPath).isFile()) return fullPath;
        }
      }
    } catch {
      // 忽略
    }

    return null;
  }

  /** 清理临时目录 */
  private cleanupDir(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch {
      // 忽略清理失败
    }
  }
}
