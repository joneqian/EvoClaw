/**
 * Artifact URI Resolver —— 跨渠道 URI 分发器（M13 PR3）
 *
 * Artifact 用统一 URI schema 标识资源位置：
 *   evoclaw-artifact://{id}   本服务管理（DB 内存或本地文件）
 *   feishu-doc://{token}      飞书云文档 — 需 FeishuArtifactBridge 实现
 *   feishu-image://{key}      飞书图片 — 需 FeishuArtifactBridge 实现
 *   feishu-file://{token}     飞书文件 — 需 FeishuArtifactBridge 实现
 *   ilink-image://...         iLink 微信（Phase 2）
 *   slack-file://...          Slack（Phase 3）
 *   file://{abs_path}         本地文件
 *   https://...               外部链接（不下载，仅返回 URL）
 *
 * 跨渠道方案：每个渠道在自己的 adapter 里注册一个 ArtifactURIResolver，
 * artifacts/service.ts 收到 fetch 请求时按 URI 前缀分发。
 */

import { createLogger } from '../../../infrastructure/logger.js';

const logger = createLogger('team-mode/artifact-uri');

/**
 * 单个 URI 的取内容结果
 */
export interface FetchUriResult {
  /** 文本内容（doc 全文 / 图片描述 / 文件元信息提示等），用于 LLM context 注入 */
  content: string;
  /** 实际 mime（可选） */
  mimeType?: string;
  /** 实际大小 */
  sizeBytes?: number;
  /** 是否成功取到完整内容；false 时 content 为降级文本 */
  fullLoaded: boolean;
  /** 降级原因（fullLoaded=false 时填） */
  fallbackReason?: string;
}

/**
 * URI 解析器接口（每个渠道实现一个）
 */
export interface ArtifactURIResolver {
  /** 该 resolver 处理的 URI scheme 前缀（不含 ://），如 'feishu-doc' / 'feishu-image' */
  readonly schemes: ReadonlyArray<string>;

  /** 取一个 URI 的完整内容 */
  fetchUri(uri: string): Promise<FetchUriResult>;
}

/**
 * URI Registry —— 按 scheme 前缀分发（agent 层全局单例）
 */
export class ArtifactURIRegistry {
  private resolvers = new Map<string, ArtifactURIResolver>();

  register(resolver: ArtifactURIResolver): void {
    for (const scheme of resolver.schemes) {
      if (this.resolvers.has(scheme)) {
        logger.warn(`重复注册 URI resolver scheme=${scheme}，旧实例被替换`);
      }
      this.resolvers.set(scheme, resolver);
      logger.info(`注册 URI resolver scheme=${scheme}`);
    }
  }

  unregister(scheme: string): void {
    if (this.resolvers.delete(scheme)) {
      logger.info(`注销 URI resolver scheme=${scheme}`);
    }
  }

  /**
   * 取 URI 的 scheme 部分（不含 ://），例如 "feishu-doc"
   */
  static parseScheme(uri: string): string | null {
    const idx = uri.indexOf('://');
    if (idx <= 0) return null;
    return uri.slice(0, idx);
  }

  /**
   * 解析 URI（按 scheme 找 resolver）
   *
   * @returns FetchUriResult；找不到 resolver 时返回降级结果
   */
  async fetchUri(uri: string): Promise<FetchUriResult> {
    const scheme = ArtifactURIRegistry.parseScheme(uri);
    if (!scheme) {
      logger.warn(`fetchUri 无法解析 scheme: ${uri}`);
      return {
        content: `[无法识别的 URI: ${uri}]`,
        fullLoaded: false,
        fallbackReason: 'invalid-scheme',
      };
    }

    // 内置 schemes 优先（避免 https / file 被外部 resolver 误注册）
    if (scheme === 'https' || scheme === 'http') {
      logger.debug(`URI 是外部链接，仅返回 URL 不下载: ${uri}`);
      return {
        content: `外部链接（未下载）：${uri}`,
        fullLoaded: false,
        fallbackReason: 'external-link-not-fetched',
      };
    }

    const resolver = this.resolvers.get(scheme);
    if (!resolver) {
      logger.warn(`fetchUri 找不到 ${scheme} 的 resolver: ${uri}`);
      return {
        content: `[scheme=${scheme} 未注册解析器: ${uri}]`,
        fullLoaded: false,
        fallbackReason: 'no-resolver',
      };
    }

    try {
      const result = await resolver.fetchUri(uri);
      logger.debug(
        `fetchUri ok scheme=${scheme} fullLoaded=${result.fullLoaded} bytes=${result.sizeBytes ?? 'n/a'}`,
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`fetchUri 失败 uri=${uri} err=${msg}`);
      return {
        content: `[fetch failed: ${msg}]`,
        fullLoaded: false,
        fallbackReason: `error: ${msg}`,
      };
    }
  }

  /** 重置（测试用） */
  reset(): void {
    this.resolvers.clear();
  }

  listSchemes(): string[] {
    return Array.from(this.resolvers.keys());
  }
}

/** 全局单例 */
export const artifactURIRegistry = new ArtifactURIRegistry();
