/**
 * skill_manage 工具 — M7 Phase 1
 *
 * 让 Agent 在对话中沉淀/修改/删除自己的 Skill。
 * 目标：Agent 调用后，下一轮对话的 <available_skills> 目录中即可出现新 Skill。
 *
 * 4 个 action：
 * - create: 创建新 Skill（要求 name 在用户目录不存在）
 * - edit:   覆盖既有 Skill 的 SKILL.md（创建 .bak 备份）
 * - patch:  对 SKILL.md 做字符串级替换（patch_old 必须是当前内容的精确子串）
 * - delete: 删除 Skill 目录（要求 confirm=true）
 *
 * 安全：
 * - Zod schema 严格校验输入
 * - 路径沙箱：必须在 <userSkillsDir> 内
 * - scanSkillMd 扫描：high 风险 → FAIL-CLOSED 拒绝
 * - atomic write：temp + rename + .bak 回滚
 * - 写入后调用 refreshSkillCache 热更新
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import { createLogger } from '../infrastructure/logger.js';
import { scanSkillMd, SKILL_NAME_REGEX, type SkillContentScanResult } from './skill-content-scanner.js';
import {
  computeSkillHash,
  readManifest,
  removeManifestEntry,
  upsertManifestEntry,
  type SkillManifestEntry,
} from './skill-manifest.js';

const log = createLogger('skill-manage');

/** 单 SKILL.md 最大字节数（32 KiB） */
const MAX_CONTENT_BYTES = 32 * 1024;

/** 输入 schema */
const SkillManageInputSchema = z.object({
  action: z.enum(['create', 'edit', 'patch', 'delete']),
  name: z.string().regex(SKILL_NAME_REGEX),
  content: z.string().max(MAX_CONTENT_BYTES).optional(),
  patch_old: z.string().optional(),
  patch_new: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type SkillManageAction = 'create' | 'edit' | 'patch' | 'delete';

export interface SkillManageResult {
  success: boolean;
  action: SkillManageAction;
  name: string;
  path: string;
  scan?: {
    riskLevel: SkillContentScanResult['riskLevel'];
    findings: number;
  };
  error?: string;
}

export interface SkillManageOptions {
  /** 用户 Skills 根目录（默认 ~/.evoclaw/skills） */
  userSkillsDir?: string;
  /** 写入成功后刷新 Skill 缓存的回调（通常传 tool-registry.refreshSkillCache） */
  refreshCache?: (agentId: string) => void;
  /** 当前 Agent ID（供 refreshCache 使用，也写入元数据） */
  agentId?: string;
}

/** 默认用户 Skills 根目录 */
export function defaultUserSkillsDir(): string {
  return path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');
}

/** 创建 skill_manage 工具定义 */
export function createSkillManageTool(options: SkillManageOptions = {}): ToolDefinition {
  return {
    name: 'skill_manage',
    description:
      '管理当前 Agent 可用的 Skill（技能）。action=create 新建，edit 覆盖，' +
      'patch 局部替换，delete 删除。用于在对话中沉淀重复流程为可复用 Skill，' +
      '下一轮对话起 <available_skills> 目录中即可使用。注意：写入会触发安全扫描，' +
      '命中高危模式（eval / 硬编码凭据 / 持久化等）将被拒绝。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'edit', 'patch', 'delete'],
          description: '操作类型',
        },
        name: {
          type: 'string',
          description: 'Skill 名（2-64 位小写字母/数字/连字符，如 "arxiv-search"），与 frontmatter.name 必须一致',
        },
        content: {
          type: 'string',
          description: 'create/edit 时必填：完整 SKILL.md 内容（含 --- frontmatter --- + body，最多 32 KiB）',
        },
        patch_old: {
          type: 'string',
          description: 'patch 时必填：要替换的原始子串（必须是当前 SKILL.md 的精确子串）',
        },
        patch_new: {
          type: 'string',
          description: 'patch 时必填：替换成的新内容',
        },
        confirm: {
          type: 'boolean',
          description: 'delete 时必须为 true（防误删）',
        },
      },
      required: ['action', 'name'],
    },
    execute: async (args) => {
      const parsed = SkillManageInputSchema.safeParse(args);
      if (!parsed.success) {
        const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        return formatResult({
          success: false,
          action: (args['action'] as SkillManageAction) ?? 'create',
          name: String(args['name'] ?? ''),
          path: '',
          error: `参数校验失败: ${msg}`,
        });
      }

      const input = parsed.data;
      const baseDir = options.userSkillsDir ?? defaultUserSkillsDir();
      const result = await performAction(input, baseDir);

      if (result.success && options.refreshCache && options.agentId) {
        try {
          options.refreshCache(options.agentId);
        } catch (err) {
          log.warn('skill_manage: refreshCache 失败', { err: String(err) });
        }
      }

      return formatResult(result);
    },
  };
}

function formatResult(r: SkillManageResult): string {
  return JSON.stringify(r);
}

async function performAction(
  input: z.infer<typeof SkillManageInputSchema>,
  userSkillsDir: string,
): Promise<SkillManageResult> {
  // 路径沙箱：name 已经 regex 校验过，但再拼一次 resolve 防御
  const skillDir = path.resolve(userSkillsDir, input.name);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  const resolvedBase = path.resolve(userSkillsDir);
  if (!skillDir.startsWith(resolvedBase + path.sep) && skillDir !== resolvedBase) {
    return {
      success: false,
      action: input.action,
      name: input.name,
      path: skillMdPath,
      error: `路径越界：${skillDir} 不在 Skills 根目录 ${resolvedBase} 内`,
    };
  }

  try {
    fs.mkdirSync(userSkillsDir, { recursive: true });
  } catch (err) {
    return {
      success: false,
      action: input.action,
      name: input.name,
      path: skillMdPath,
      error: `无法创建 Skills 根目录: ${String(err)}`,
    };
  }

  switch (input.action) {
    case 'create':
      return doCreate(input, userSkillsDir, skillDir, skillMdPath);
    case 'edit':
      return doEdit(input, userSkillsDir, skillDir, skillMdPath);
    case 'patch':
      return doPatch(input, userSkillsDir, skillDir, skillMdPath);
    case 'delete':
      return doDelete(input, userSkillsDir, skillDir, skillMdPath);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════════

function doCreate(
  input: z.infer<typeof SkillManageInputSchema>,
  userSkillsDir: string,
  skillDir: string,
  skillMdPath: string,
): SkillManageResult {
  if (input.content === undefined) {
    return fail(input, skillMdPath, 'create 操作必须提供 content 参数');
  }

  if (fs.existsSync(skillMdPath)) {
    return fail(input, skillMdPath, `Skill "${input.name}" 已存在，请用 edit 或 patch`);
  }

  const scan = scanSkillMd(input.content, { expectedName: input.name });
  if (!scan.ok) {
    return {
      success: false,
      action: 'create',
      name: input.name,
      path: skillMdPath,
      scan: { riskLevel: scan.riskLevel, findings: scan.findings.length },
      error:
        scan.frontmatterError ??
        `安全扫描拒绝：命中 ${scan.findings.filter(f => f.severity === 'high').length} 项高危模式`,
    };
  }

  const writeResult = atomicWriteSkillMd({
    skillDir,
    skillMdPath,
    content: input.content,
    preserveBackup: false,
  });
  if (writeResult.error) {
    return fail(input, skillMdPath, writeResult.error, scan);
  }

  try {
    upsertManifestEntry(userSkillsDir, buildManifestEntry(input.name, input.content, 'agent-created'));
  } catch (err) {
    // manifest 写入失败 → 回滚文件
    rollbackWrite(skillDir, skillMdPath, writeResult.backupPath);
    return fail(input, skillMdPath, `manifest 写入失败: ${String(err)}`, scan);
  }

  log.info(`skill_manage create: ${input.name}`, { riskLevel: scan.riskLevel });
  return {
    success: true,
    action: 'create',
    name: input.name,
    path: skillMdPath,
    scan: { riskLevel: scan.riskLevel, findings: scan.findings.length },
  };
}

function doEdit(
  input: z.infer<typeof SkillManageInputSchema>,
  userSkillsDir: string,
  skillDir: string,
  skillMdPath: string,
): SkillManageResult {
  if (input.content === undefined) {
    return fail(input, skillMdPath, 'edit 操作必须提供 content 参数');
  }
  if (!fs.existsSync(skillMdPath)) {
    return fail(input, skillMdPath, `Skill "${input.name}" 不存在，请用 create 创建`);
  }

  const scan = scanSkillMd(input.content, { expectedName: input.name });
  if (!scan.ok) {
    return {
      success: false,
      action: 'edit',
      name: input.name,
      path: skillMdPath,
      scan: { riskLevel: scan.riskLevel, findings: scan.findings.length },
      error:
        scan.frontmatterError ??
        `安全扫描拒绝：命中 ${scan.findings.filter(f => f.severity === 'high').length} 项高危模式`,
    };
  }

  const writeResult = atomicWriteSkillMd({
    skillDir,
    skillMdPath,
    content: input.content,
    preserveBackup: true,
  });
  if (writeResult.error) {
    return fail(input, skillMdPath, writeResult.error, scan);
  }

  try {
    const manifest = readManifest(userSkillsDir);
    const prev = manifest.get(input.name);
    const source = prev?.source ?? 'agent-created';
    const createdAt = prev?.createdAt ?? new Date().toISOString();
    upsertManifestEntry(userSkillsDir, {
      name: input.name,
      sha256: computeSkillHash(input.content),
      source,
      createdAt,
    });
  } catch (err) {
    rollbackWrite(skillDir, skillMdPath, writeResult.backupPath);
    return fail(input, skillMdPath, `manifest 写入失败: ${String(err)}`, scan);
  }

  log.info(`skill_manage edit: ${input.name}`, { riskLevel: scan.riskLevel });
  return {
    success: true,
    action: 'edit',
    name: input.name,
    path: skillMdPath,
    scan: { riskLevel: scan.riskLevel, findings: scan.findings.length },
  };
}

function doPatch(
  input: z.infer<typeof SkillManageInputSchema>,
  userSkillsDir: string,
  skillDir: string,
  skillMdPath: string,
): SkillManageResult {
  if (input.patch_old === undefined || input.patch_new === undefined) {
    return fail(input, skillMdPath, 'patch 操作必须提供 patch_old 和 patch_new 参数');
  }
  if (!fs.existsSync(skillMdPath)) {
    return fail(input, skillMdPath, `Skill "${input.name}" 不存在`);
  }

  let current: string;
  try {
    current = fs.readFileSync(skillMdPath, 'utf-8');
  } catch (err) {
    return fail(input, skillMdPath, `读取失败: ${String(err)}`);
  }

  if (!input.patch_old) {
    return fail(input, skillMdPath, 'patch_old 不能为空字符串');
  }

  const firstIdx = current.indexOf(input.patch_old);
  if (firstIdx === -1) {
    return fail(input, skillMdPath, 'patch_old 不是当前 SKILL.md 的子串，无法匹配');
  }
  const lastIdx = current.lastIndexOf(input.patch_old);
  if (firstIdx !== lastIdx) {
    return fail(input, skillMdPath, 'patch_old 在 SKILL.md 中出现多次，请使用 edit 或提供更具体的 patch_old');
  }

  const newContent =
    current.slice(0, firstIdx) + input.patch_new + current.slice(firstIdx + input.patch_old.length);

  if (Buffer.byteLength(newContent, 'utf-8') > MAX_CONTENT_BYTES) {
    return fail(input, skillMdPath, `patch 后超出 ${MAX_CONTENT_BYTES} 字节上限`);
  }

  const scan = scanSkillMd(newContent, { expectedName: input.name });
  if (!scan.ok) {
    return {
      success: false,
      action: 'patch',
      name: input.name,
      path: skillMdPath,
      scan: { riskLevel: scan.riskLevel, findings: scan.findings.length },
      error:
        scan.frontmatterError ??
        `安全扫描拒绝：命中 ${scan.findings.filter(f => f.severity === 'high').length} 项高危模式`,
    };
  }

  const writeResult = atomicWriteSkillMd({
    skillDir,
    skillMdPath,
    content: newContent,
    preserveBackup: true,
  });
  if (writeResult.error) {
    return fail(input, skillMdPath, writeResult.error, scan);
  }

  try {
    const manifest = readManifest(userSkillsDir);
    const prev = manifest.get(input.name);
    const source = prev?.source ?? 'agent-created';
    const createdAt = prev?.createdAt ?? new Date().toISOString();
    upsertManifestEntry(userSkillsDir, {
      name: input.name,
      sha256: computeSkillHash(newContent),
      source,
      createdAt,
    });
  } catch (err) {
    rollbackWrite(skillDir, skillMdPath, writeResult.backupPath);
    return fail(input, skillMdPath, `manifest 写入失败: ${String(err)}`, scan);
  }

  log.info(`skill_manage patch: ${input.name}`, { riskLevel: scan.riskLevel });
  return {
    success: true,
    action: 'patch',
    name: input.name,
    path: skillMdPath,
    scan: { riskLevel: scan.riskLevel, findings: scan.findings.length },
  };
}

function doDelete(
  input: z.infer<typeof SkillManageInputSchema>,
  userSkillsDir: string,
  skillDir: string,
  skillMdPath: string,
): SkillManageResult {
  if (input.confirm !== true) {
    return fail(input, skillMdPath, 'delete 必须提供 confirm=true（防误删）');
  }
  if (!fs.existsSync(skillMdPath)) {
    return fail(input, skillMdPath, `Skill "${input.name}" 不存在`);
  }

  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
  } catch (err) {
    return fail(input, skillMdPath, `删除失败: ${String(err)}`);
  }

  try {
    removeManifestEntry(userSkillsDir, input.name);
  } catch (err) {
    log.warn(`skill_manage delete: manifest 清理失败`, { err: String(err) });
  }

  log.info(`skill_manage delete: ${input.name}`);
  return {
    success: true,
    action: 'delete',
    name: input.name,
    path: skillMdPath,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Atomic write helpers
// ═══════════════════════════════════════════════════════════════════════════

interface AtomicWriteResult {
  error?: string;
  /** 若 preserveBackup=true，这里是备份路径；调用方回滚时用 */
  backupPath?: string;
}

function atomicWriteSkillMd(params: {
  skillDir: string;
  skillMdPath: string;
  content: string;
  preserveBackup: boolean;
}): AtomicWriteResult {
  const { skillDir, skillMdPath, content, preserveBackup } = params;

  try {
    fs.mkdirSync(skillDir, { recursive: true });
  } catch (err) {
    return { error: `创建 Skill 目录失败: ${String(err)}` };
  }

  let backupPath: string | undefined;
  if (preserveBackup && fs.existsSync(skillMdPath)) {
    backupPath = `${skillMdPath}.bak`;
    try {
      fs.copyFileSync(skillMdPath, backupPath);
    } catch (err) {
      return { error: `备份失败: ${String(err)}` };
    }
  }

  const tmp = `${skillMdPath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, skillMdPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    // 若写失败且已备份，尝试恢复（但原文件可能还在）
    return { error: `写入失败: ${String(err)}`, backupPath };
  }

  return { backupPath };
}

function rollbackWrite(skillDir: string, skillMdPath: string, backupPath?: string): void {
  if (backupPath && fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(backupPath, skillMdPath);
    } catch (err) {
      log.warn('skill_manage rollback 失败', { err: String(err) });
    }
  } else {
    // 新建场景：删除整个目录
    try {
      fs.rmSync(skillDir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
}

function buildManifestEntry(
  name: string,
  content: string,
  source: SkillManifestEntry['source'],
): SkillManifestEntry {
  return {
    name,
    sha256: computeSkillHash(content),
    source,
    createdAt: new Date().toISOString(),
  };
}

function fail(
  input: z.infer<typeof SkillManageInputSchema>,
  skillMdPath: string,
  error: string,
  scan?: SkillContentScanResult,
): SkillManageResult {
  return {
    success: false,
    action: input.action,
    name: input.name,
    path: skillMdPath,
    scan: scan ? { riskLevel: scan.riskLevel, findings: scan.findings.length } : undefined,
    error,
  };
}
