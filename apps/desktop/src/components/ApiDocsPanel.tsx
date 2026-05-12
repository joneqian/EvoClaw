/**
 * API 文档面板（M3-T3c）
 *
 * Settings "API 文档" Tab 的内容。从 GET /commands + GET /openapi.json 聚合展示。
 * 按 category 分组列出端点 + 权限徽章，点击展开更多详情。
 */

import { useState, useEffect, useMemo } from 'react';
import { get } from '../lib/api';

// ─── 类型 ───

interface RouteMeta {
  method: string;
  path: string;
  category: string;
  description: string;
  requiredPermission?: string;
  since: string;
}

interface ToolMeta {
  name: string;
  category: string;
  description: string;
  destructive?: boolean;
  source: string;
}

interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
}

// ─── 配色 ───

const PERMISSION_COLORS: Record<string, string> = {
  file_read:  'bg-info/10 text-info',
  file_write: 'bg-warning/10 text-warning',
  network:    'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300',
  shell:      'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  browser:    'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300',
  mcp:        'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300',
  skill:      'bg-success/10 text-success',
};

const METHOD_COLORS: Record<string, string> = {
  GET:    'bg-success/10 text-success',
  POST:   'bg-info/10 text-info',
  PUT:    'bg-warning/10 text-warning',
  PATCH:  'bg-warning/10 text-warning',
  DELETE: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
};

// ─── 组件 ───

export default function ApiDocsPanel() {
  const [info, setInfo] = useState<OpenApiInfo | null>(null);
  const [routes, setRoutes] = useState<RouteMeta[]>([]);
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [cmds, oapi] = await Promise.all([
          get<{ routes: RouteMeta[]; tools: ToolMeta[] }>('/commands'),
          get<{ info: OpenApiInfo }>('/openapi.json'),
        ]);
        setRoutes(cmds.routes);
        setTools(cmds.tools);
        setInfo(oapi.info);
      } catch { /* Sidecar 可能未就绪 */ }
      finally { setLoading(false); }
    })();
  }, []);

  const routesByCategory = useMemo(() => {
    const map = new Map<string, RouteMeta[]>();
    for (const r of routes) {
      const arr = map.get(r.category) ?? [];
      arr.push(r);
      map.set(r.category, arr);
    }
    // 按 category 字母序
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [routes]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  return (
    <div className="space-y-6">
      {/* 顶部信息卡 */}
      {info && (
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground">{info.title}</h3>
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent text-muted-foreground">v{info.version}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{info.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            完整 OpenAPI JSON：<code className="px-1 py-0.5 bg-muted rounded">GET /openapi.json</code>
          </p>
        </div>
      )}

      {/* HTTP 端点按 category 分组 */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-3">HTTP 端点（{routes.length} 个）</h4>
        <div className="space-y-4">
          {routesByCategory.map(([category, arr]) => (
            <div key={category} className="bg-card rounded-xl border border-border">
              <div className="px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase">
                {category}
              </div>
              <ul className="divide-y divide-border">
                {arr.map((r, i) => (
                  <li key={i} className="px-4 py-2 flex items-center gap-3">
                    <span className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded w-14 text-center shrink-0 ${METHOD_COLORS[r.method] ?? 'bg-accent text-muted-foreground'}`}>
                      {r.method}
                    </span>
                    <code className="text-xs font-mono text-foreground truncate flex-1">{r.path}</code>
                    {r.requiredPermission && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PERMISSION_COLORS[r.requiredPermission] ?? 'bg-accent text-muted-foreground'}`}>
                        {r.requiredPermission}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground truncate max-w-[240px]">{r.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Agent 工具 */}
      {tools.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-3">Agent 工具（权限类别映射，{tools.length} 个）</h4>
          <div className="bg-card rounded-xl border border-border">
            <ul className="divide-y divide-border">
              {tools.map((t, i) => (
                <li key={i} className="px-4 py-2 flex items-center gap-3">
                  <span className="text-xs font-mono font-medium text-foreground w-28 shrink-0 truncate">{t.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PERMISSION_COLORS[t.category] ?? 'bg-accent text-muted-foreground'}`}>
                    {t.category}
                  </span>
                  {t.destructive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning shrink-0">破坏性</span>
                  )}
                  <span className="text-xs text-muted-foreground truncate flex-1">{t.description}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{t.source}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
