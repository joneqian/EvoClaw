/**
 * Task Artifacts 类型定义
 */

import type { ArtifactKind, ArtifactSummary } from '../../../channel/team-mode/team-channel.js';
export type { ArtifactKind, ArtifactSummary };

/** task_artifacts 表行（与 migration 031 对齐） */
export interface TaskArtifactRow {
  id: string;
  task_id: string;
  plan_id: string;
  kind: ArtifactKind;
  title: string;
  uri: string;
  mime_type: string | null;
  size_bytes: number | null;
  inline_content: string | null;
  summary: string;
  created_by_agent_id: string;
  created_at: string;
  supersedes_id: string | null;
  metadata: string | null;
}

/** 完整 artifact 视图（service 返回值） */
export interface Artifact {
  id: string;
  taskId: string;
  planId: string;
  kind: ArtifactKind;
  title: string;
  uri: string;
  mimeType?: string;
  sizeBytes?: number;
  inlineContent?: string;
  summary: string;
  createdByAgentId: string;
  createdAt: string;
  supersedesId?: string;
  metadata?: Record<string, unknown>;
}

/** attach_artifact 入参 */
export interface AttachArtifactArgs {
  taskId: string;
  kind: ArtifactKind;
  title: string;
  summary: string;
  /** 内联文本（text / markdown 用），与 uri 二选一 */
  content?: string;
  /** 已存在的资源 URI（image_key / file_token / 外部链接），与 content 二选一 */
  uri?: string;
  mimeType?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

/** fetch_artifact 入参 */
export interface FetchArtifactArgs {
  artifactId: string;
  mode?: 'summary' | 'full';
}

/** fetch_artifact 返回 */
export interface FetchedArtifact {
  artifact: Artifact;
  /** mode='summary' 时 = artifact.summary；mode='full' 时 = 实际取出的全文 / 文件描述 */
  content: string;
  /** 是否取到了完整内容 */
  fullLoaded: boolean;
  /** 取不到原内容时的降级原因 */
  fallbackReason?: string;
}
