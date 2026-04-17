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
  file_read:  'bg-blue-50 text-blue-700',
  file_write: 'bg-orange-50 text-orange-700',
  network:    'bg-purple-50 text-purple-700',
  shell:      'bg-rose-50 text-rose-700',
  browser:    'bg-cyan-50 text-cyan-700',
  mcp:        'bg-indigo-50 text-indigo-700',
  skill:      'bg-emerald-50 text-emerald-700',
};

const METHOD_COLORS: Record<string, string> = {
  GET:    'bg-emerald-50 text-emerald-700',
  POST:   'bg-blue-50 text-blue-700',
  PUT:    'bg-amber-50 text-amber-700',
  PATCH:  'bg-amber-50 text-amber-700',
  DELETE: 'bg-rose-50 text-rose-700',
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
    return <div className="text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div className="space-y-6">
      {/* 顶部信息卡 */}
      {info && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-slate-900">{info.title}</h3>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">v{info.version}</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{info.description}</p>
          <p className="mt-2 text-xs text-slate-400">
            完整 OpenAPI JSON：<code className="px-1 py-0.5 bg-slate-50 rounded">GET /openapi.json</code>
          </p>
        </div>
      )}

      {/* HTTP 端点按 category 分组 */}
      <div>
        <h4 className="text-sm font-medium text-slate-700 mb-3">HTTP 端点（{routes.length} 个）</h4>
        <div className="space-y-4">
          {routesByCategory.map(([category, arr]) => (
            <div key={category} className="bg-white rounded-xl border border-slate-200">
              <div className="px-4 py-2 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase">
                {category}
              </div>
              <ul className="divide-y divide-slate-50">
                {arr.map((r, i) => (
                  <li key={i} className="px-4 py-2 flex items-center gap-3">
                    <span className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded w-14 text-center shrink-0 ${METHOD_COLORS[r.method] ?? 'bg-slate-100 text-slate-600'}`}>
                      {r.method}
                    </span>
                    <code className="text-xs font-mono text-slate-700 truncate flex-1">{r.path}</code>
                    {r.requiredPermission && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PERMISSION_COLORS[r.requiredPermission] ?? 'bg-slate-100 text-slate-600'}`}>
                        {r.requiredPermission}
                      </span>
                    )}
                    <span className="text-xs text-slate-400 truncate max-w-[240px]">{r.description}</span>
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
          <h4 className="text-sm font-medium text-slate-700 mb-3">Agent 工具（权限类别映射，{tools.length} 个）</h4>
          <div className="bg-white rounded-xl border border-slate-200">
            <ul className="divide-y divide-slate-50">
              {tools.map((t, i) => (
                <li key={i} className="px-4 py-2 flex items-center gap-3">
                  <span className="text-xs font-mono font-medium text-slate-700 w-28 shrink-0 truncate">{t.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PERMISSION_COLORS[t.category] ?? 'bg-slate-100 text-slate-600'}`}>
                    {t.category}
                  </span>
                  {t.destructive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">破坏性</span>
                  )}
                  <span className="text-xs text-slate-400 truncate flex-1">{t.description}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{t.source}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
