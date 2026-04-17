/**
 * OpenAPI 3.0 文档端点（M3-T3b）
 *
 * `GET /api/openapi.json` 从 ROUTE_MANIFEST 动态生成 OpenAPI 3.0 文档。
 * 简易生成器：不引入第三方 openapi 库，仅做 ROUTE_MANIFEST → OpenAPI JSON 的纯转换。
 * requestSchema / responseSchema 留给未来 M3.x 扩展（通过 zod-to-json-schema 引入）。
 */

import { Hono } from 'hono';
import { ROUTE_MANIFEST, type RouteMeta } from './command-manifest.js';

/** Hono path `/agents/:id` → OpenAPI `/agents/{id}` */
function honoPathToOpenApi(path: string): string {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

/** 从 Hono path 中提取 path 参数 */
function extractPathParams(path: string): string[] {
  const matches = path.match(/:[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  return matches.map(m => m.slice(1));
}

interface OpenApiOperation {
  summary: string;
  tags: string[];
  parameters?: Array<{
    name: string;
    in: 'path';
    required: true;
    schema: { type: 'string' };
  }>;
  responses: {
    '200': { description: string };
    default?: { description: string };
  };
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
}

export interface OpenApiDocument {
  openapi: '3.0.0';
  info: {
    title: string;
    version: string;
    description: string;
  };
  paths: Record<string, OpenApiPathItem>;
}

/**
 * 从 ROUTE_MANIFEST 构建 OpenAPI 3.0 JSON。
 *
 * 导出为纯函数便于测试。
 */
export function buildOpenApiDocument(routes: readonly RouteMeta[] = ROUTE_MANIFEST): OpenApiDocument {
  const paths: Record<string, OpenApiPathItem> = {};

  for (const r of routes) {
    const oapiPath = honoPathToOpenApi(r.path);
    const pathParams = extractPathParams(r.path);
    const operation: OpenApiOperation = {
      summary: r.description,
      tags: [r.category],
      responses: {
        '200': { description: 'Success' },
      },
    };
    if (pathParams.length > 0) {
      operation.parameters = pathParams.map(name => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
    }

    const method = r.method.toLowerCase() as keyof OpenApiPathItem;
    paths[oapiPath] = { ...paths[oapiPath], [method]: operation };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'EvoClaw Sidecar API',
      version: '1.0.0',
      description: 'EvoClaw 桌面应用 Sidecar（Bun + Hono）对外提供的本地 HTTP API。由 ROUTE_MANIFEST 自动生成，新增/修改路由请同步更新 routes/command-manifest.ts。',
    },
    paths,
  };
}

export function createOpenApiRoutes(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.json(buildOpenApiDocument()));
  return app;
}
