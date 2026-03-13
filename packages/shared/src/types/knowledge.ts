/** 知识库文件状态 */
export type KBFileStatus = 'pending' | 'indexing' | 'indexed' | 'error';

/** 知识库文件 */
export interface KBFile {
  id: string;
  agentId: string;
  fileName: string;
  filePath: string;
  fileHash: string;
  fileSize: number;
  chunkCount: number;
  status: KBFileStatus;
  errorMessage: string | null;
  createdAt: string;
  indexedAt: string | null;
}

/** 分块元数据 */
export interface ChunkMetadata {
  heading?: string;
  lineStart?: number;
  lineEnd?: number;
  language?: string;
}

/** 知识库分块 */
export interface KBChunk {
  id: string;
  fileId: string;
  agentId: string;
  chunkIndex: number;
  content: string;
  metadata: ChunkMetadata;
  tokenCount: number;
  createdAt: string;
}

/** Embedding 配置 */
export interface EmbeddingConfig {
  provider: string;
  model: string;
  dimension: number;
  baseUrl: string;
  apiKey: string;
}

/** Embedding 源类型 */
export type EmbeddingSourceType = 'memory' | 'chunk';
