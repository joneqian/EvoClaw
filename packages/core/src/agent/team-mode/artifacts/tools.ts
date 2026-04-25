/**
 * Artifact Builtin Tools —— 3 个跨渠道工具暴露给 Agent（M13 PR3）
 *
 *   - attach_artifact         产出时调，一个任务可多次调（自动 supersedes 旧版）
 *   - list_task_artifacts     任意 Agent 可查
 *   - fetch_artifact          按需取详情，mode=summary（默认）/ full
 *
 * 上下文：
 *   - args 里的 agentId / sessionKey 由 channel-message-handler 自动注入
 *   - 但本组工具不强依赖 sessionKey（任何模式都能用，包括 dm）
 */

import type { ToolDefinition } from '../../../bridge/tool-injector.js';
import { createLogger } from '../../../infrastructure/logger.js';
import type { ArtifactService } from './service.js';
import type { ArtifactKind, AttachArtifactArgs, FetchArtifactArgs } from './types.js';

const logger = createLogger('team-mode/artifact-tools');

const VALID_KINDS: ReadonlyArray<ArtifactKind> = [
  'text',
  'markdown',
  'image',
  'file',
  'doc',
  'link',
];

function getCallerAgentId(args: Record<string, unknown>): string | { error: string } {
  const id = args['agentId'];
  if (typeof id !== 'string' || !id) {
    return { error: '缺少 agentId（应由 channel-message-handler 自动注入）' };
  }
  return id;
}

// ─── attach_artifact ─────────────────────────────────────────

export function createAttachArtifactTool(svc: ArtifactService): ToolDefinition {
  return {
    name: 'attach_artifact',
    description:
      '把任务的中间产物（文档/图片/文件/链接）登记到 artifact 表，让其他 Agent 能引用。一个任务可多次调用，相同 task+title 会自动建版本链。kind=text/markdown 可填 content（内联），其他 kind 必须填 uri。',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '任务 DB 主键' },
        kind: {
          type: 'string',
          enum: VALID_KINDS as unknown as string[],
          description: '产物类型',
        },
        title: { type: 'string', description: '简短标题（同 task+title 会建版本链）' },
        summary: { type: 'string', description: '一行摘要（必填，所有 kind）；后续 Agent 看到 prompt 注入时只看这个' },
        content: {
          type: 'string',
          description: '仅 kind=text/markdown 用：内联文本（text ≤4KB / markdown ≤64KB）',
        },
        uri: {
          type: 'string',
          description:
            'kind=image/file/doc/link 必填：渠道原生 URI（feishu-doc:// / feishu-image:// / feishu-file:// / file:// / https://）',
        },
        mime_type: { type: 'string', description: '可选 MIME（如 application/pdf / image/png）' },
        size_bytes: { type: 'number', description: '可选大小（bytes）' },
        metadata: {
          type: 'object',
          description: '可选元数据（如 image 的 width/height、doc 的 owner_id）',
        },
      },
      required: ['task_id', 'kind', 'title', 'summary'],
    },
    execute: async (args) => {
      const callerOrErr = getCallerAgentId(args);
      if (typeof callerOrErr !== 'string') return `错误：${callerOrErr.error}`;

      const taskId = args['task_id'];
      const kindArg = args['kind'];
      const title = args['title'];
      const summary = args['summary'];
      if (typeof taskId !== 'string' || !taskId) return '错误：task_id 必填';
      if (typeof kindArg !== 'string' || !VALID_KINDS.includes(kindArg as ArtifactKind)) {
        return `错误：kind 非法，合法值：${VALID_KINDS.join('/')}`;
      }
      if (typeof title !== 'string' || !title.trim()) return '错误：title 必填';
      if (typeof summary !== 'string' || !summary.trim()) return '错误：summary 必填';

      const content = typeof args['content'] === 'string' ? (args['content'] as string) : undefined;
      const uri = typeof args['uri'] === 'string' ? (args['uri'] as string) : undefined;
      const mimeType = typeof args['mime_type'] === 'string' ? (args['mime_type'] as string) : undefined;
      const sizeBytes = typeof args['size_bytes'] === 'number' ? (args['size_bytes'] as number) : undefined;
      const metadata = (args['metadata'] && typeof args['metadata'] === 'object')
        ? (args['metadata'] as Record<string, unknown>)
        : undefined;

      const attachArgs: AttachArtifactArgs = {
        taskId,
        kind: kindArg as ArtifactKind,
        title,
        summary,
        content,
        uri,
        mimeType,
        sizeBytes,
        metadata,
      };

      try {
        const artifact = await svc.attachArtifact(attachArgs, callerOrErr);
        logger.info(
          `tool attach_artifact ok agent=${callerOrErr} artifact=${artifact.id} task=${taskId} kind=${kindArg}`,
        );
        const versionNote = artifact.supersedesId ? `（取代旧版 ${artifact.supersedesId}）` : '';
        return `✅ 已登记产出：[${artifact.kind}] "${artifact.title}" id=${artifact.id} uri=${artifact.uri}${versionNote}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`tool attach_artifact 失败 agent=${callerOrErr} task=${taskId} err=${msg}`);
        return `错误：${msg}`;
      }
    },
  };
}

// ─── list_task_artifacts ─────────────────────────────────────

export function createListTaskArtifactsTool(svc: ArtifactService): ToolDefinition {
  return {
    name: 'list_task_artifacts',
    description:
      '列出任务或计划的所有产出（artifact）。必须传 task_id 或 plan_id 之一。默认仅展示最新版（被 supersede 的旧版默认隐藏）；传 include_history=true 看完整历史。',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '按 task 查询' },
        plan_id: { type: 'string', description: '按 plan 查询（含该 plan 所有 task 的产出）' },
        include_history: { type: 'boolean', description: '默认 false，仅最新版；true 时含旧版' },
      },
    },
    execute: async (args) => {
      const callerOrErr = getCallerAgentId(args);
      if (typeof callerOrErr !== 'string') return `错误：${callerOrErr.error}`;

      const taskId = typeof args['task_id'] === 'string' ? (args['task_id'] as string) : undefined;
      const planId = typeof args['plan_id'] === 'string' ? (args['plan_id'] as string) : undefined;
      const includeHistory = args['include_history'] === true;

      if (!taskId && !planId) return '错误：必须传 task_id 或 plan_id 之一';

      let artifacts;
      if (taskId) {
        artifacts = includeHistory ? svc.listByTask(taskId) : svc.listLatestByTask(taskId);
      } else {
        const all = svc.listByPlan(planId!);
        if (includeHistory) {
          artifacts = all;
        } else {
          // 按 task 分组取最新
          const supersededIds = new Set<string>();
          for (const a of all) if (a.supersedesId) supersededIds.add(a.supersedesId);
          artifacts = all.filter((a) => !supersededIds.has(a.id));
        }
      }

      if (artifacts.length === 0) {
        return taskId ? `task=${taskId} 暂无产出` : `plan=${planId} 暂无产出`;
      }

      const lines = artifacts.map((a) => {
        const ver = a.supersedesId ? ' [新版]' : '';
        const size = a.sizeBytes ? ` (${a.sizeBytes}B)` : '';
        return `[${a.kind}]${ver} id=${a.id} task=${a.taskId} title="${a.title}"${size}\n  uri: ${a.uri}\n  摘要: ${a.summary}`;
      });
      logger.debug(`tool list_task_artifacts agent=${callerOrErr} count=${artifacts.length}`);
      return lines.join('\n');
    },
  };
}

// ─── fetch_artifact ──────────────────────────────────────────

export function createFetchArtifactTool(svc: ArtifactService): ToolDefinition {
  return {
    name: 'fetch_artifact',
    description:
      '取一个 artifact 的具体内容。mode=summary（默认）只返回一行摘要（便宜）；mode=full 拉取完整内容（doc 走渠道 API、image/file 走渠道下载、外部链接不下载只返回 URL）。',
    parameters: {
      type: 'object',
      properties: {
        artifact_id: { type: 'string', description: 'artifact ID（list_task_artifacts 输出的 id）' },
        mode: {
          type: 'string',
          enum: ['summary', 'full'],
          description: '默认 summary。仅在确实需要详情时用 full 以节省 token / 网络',
        },
      },
      required: ['artifact_id'],
    },
    execute: async (args) => {
      const callerOrErr = getCallerAgentId(args);
      if (typeof callerOrErr !== 'string') return `错误：${callerOrErr.error}`;

      const artifactId = args['artifact_id'];
      const mode = args['mode'];
      if (typeof artifactId !== 'string' || !artifactId) return '错误：artifact_id 必填';
      const fetchArgs: FetchArtifactArgs = {
        artifactId,
        mode: mode === 'full' ? 'full' : 'summary',
      };

      const result = await svc.fetchArtifact(fetchArgs);
      if (!result) return `错误：artifact 不存在 ${artifactId}`;
      logger.debug(
        `tool fetch_artifact agent=${callerOrErr} id=${artifactId} mode=${fetchArgs.mode} fullLoaded=${result.fullLoaded}`,
      );
      const header = `[${result.artifact.kind}] "${result.artifact.title}" uri=${result.artifact.uri}`;
      const fallback = result.fallbackReason ? `\n（降级原因：${result.fallbackReason}）` : '';
      return `${header}\n\n${result.content}${fallback}`;
    },
  };
}

// ─── 一站式构造 ──────────────────────────────────────────────

export function createArtifactTools(svc: ArtifactService): ToolDefinition[] {
  return [
    createAttachArtifactTool(svc),
    createListTaskArtifactsTool(svc),
    createFetchArtifactTool(svc),
  ];
}
