import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAgentStore } from '../stores/agent-store';
import AgentSelect from '../components/AgentSelect';
import { get } from '../lib/api';
import { parseUtcDate } from '../lib/date';
import type {
  CapabilityNode,
  GrowthEvent,
  GrowthVector,
} from '@evoclaw/shared';

/** 能力维度中文映射 */
const DIMENSION_LABELS: Record<string, string> = {
  coding: '编程',
  analysis: '分析',
  writing: '写作',
  research: '研究',
  planning: '规划',
  debugging: '调试',
  data: '数据',
  communication: '沟通',
};

/** 成长事件类型标签 */
const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  capability_up: { label: '提升', color: 'text-green-600' },
  capability_down: { label: '下降', color: 'text-red-500' },
  new_capability: { label: '新能力', color: 'text-blue-600' },
  milestone: { label: '里程碑', color: 'text-yellow-600' },
};

/** 趋势箭头 */
function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') return <span className="text-green-500">↑</span>;
  if (trend === 'down') return <span className="text-red-500">↓</span>;
  return <span className="text-slate-400">→</span>;
}

/** SVG 雷达图 */
function RadarChart({ capabilities }: { capabilities: CapabilityNode[] }) {
  const size = 240;
  const center = size / 2;
  const maxRadius = size / 2 - 30;

  const allDimensions = ['coding', 'analysis', 'writing', 'research', 'planning', 'debugging', 'data', 'communication'];
  const data = allDimensions.map((dim) => {
    const cap = capabilities.find((c) => c.name === dim);
    return { name: dim, level: cap?.level ?? 0 };
  });

  const maxLevel = Math.max(10, ...data.map((d) => d.level));
  const n = data.length;

  const points = data.map((d, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (d.level / maxLevel) * maxRadius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      labelX: center + (maxRadius + 18) * Math.cos(angle),
      labelY: center + (maxRadius + 18) * Math.sin(angle),
      name: d.name,
    };
  });

  const polygon = points.map((p) => `${p.x},${p.y}`).join(' ');
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[280px] mx-auto">
      {gridLevels.map((level) => (
        <circle key={level} cx={center} cy={center} r={maxRadius * level} fill="none" stroke="#e5e7eb" strokeWidth={0.5} />
      ))}
      {points.map((p, i) => (
        <line key={i} x1={center} y1={center} x2={center + maxRadius * Math.cos((Math.PI * 2 * i) / n - Math.PI / 2)} y2={center + maxRadius * Math.sin((Math.PI * 2 * i) / n - Math.PI / 2)} stroke="#e5e7eb" strokeWidth={0.5} />
      ))}
      <polygon points={polygon} fill="rgba(0,212,170,0.15)" stroke="#00d4aa" strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#00d4aa" />
      ))}
      {points.map((p, i) => (
        <text key={i} x={p.labelX} y={p.labelY} textAnchor="middle" dominantBaseline="central" className="text-[9px] fill-slate-500">
          {DIMENSION_LABELS[p.name] ?? p.name}
        </text>
      ))}
    </svg>
  );
}

/** 进化仪表盘 — 能力图谱 + 成长追踪 */
export default function EvolutionPage() {
  const { agents } = useAgentStore();
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [capabilities, setCapabilities] = useState<CapabilityNode[]>([]);
  const [events, setEvents] = useState<GrowthEvent[]>([]);
  const [vector, setVector] = useState<GrowthVector[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  const fetchData = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoading(true);
    try {
      const [capRes, eventRes, vecRes] = await Promise.all([
        get<{ capabilities: CapabilityNode[] }>(`/evolution/${selectedAgentId}/capabilities`),
        get<{ events: GrowthEvent[] }>(`/evolution/${selectedAgentId}/growth`),
        get<{ vector: GrowthVector[] }>(`/evolution/${selectedAgentId}/growth/vector`),
      ]);
      setCapabilities(capRes.capabilities);
      setEvents(eventRes.events);
      setVector(vecRes.vector);
    } catch {
      // 容错
    } finally {
      setLoading(false);
    }
  }, [selectedAgentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const stats = useMemo(() => {
    const total = capabilities.length;
    const avgLevel = total > 0 ? capabilities.reduce((s, c) => s + c.level, 0) / total : 0;
    const totalUses = capabilities.reduce((s, c) => s + c.useCount, 0);
    return { total, avgLevel: avgLevel.toFixed(1), totalUses };
  }, [capabilities]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">进化仪表盘</h2>
          <AgentSelect agents={agents} value={selectedAgentId} onChange={setSelectedAgentId} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!selectedAgentId ? (
          <div className="text-center text-slate-400 mt-20"><p className="text-lg">请先创建一个 Agent</p></div>
        ) : loading ? (
          <div className="text-center text-slate-400 mt-20"><p className="text-sm">加载中...</p></div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* 统计卡片 */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <p className="text-xs text-slate-400 mb-1">能力维度</p>
                <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <p className="text-xs text-slate-400 mb-1">平均等级</p>
                <p className="text-2xl font-bold text-brand">{stats.avgLevel}</p>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <p className="text-xs text-slate-400 mb-1">总使用次数</p>
                <p className="text-2xl font-bold text-slate-900">{stats.totalUses}</p>
              </div>
            </div>

            {/* 雷达图 + 成长向量 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-medium text-slate-700 mb-3">能力雷达</h3>
                <RadarChart capabilities={capabilities} />
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-medium text-slate-700 mb-3">7 日成长向量</h3>
                {vector.length === 0 ? (
                  <p className="text-sm text-slate-400 mt-8 text-center">暂无数据</p>
                ) : (
                  <div className="space-y-2">
                    {vector.map((v) => (
                      <div key={v.dimension} className="flex items-center justify-between px-2 py-1.5 rounded bg-slate-50">
                        <span className="text-sm text-slate-700">{DIMENSION_LABELS[v.dimension] ?? v.dimension}</span>
                        <div className="flex items-center gap-2">
                          <TrendIcon trend={v.trend} />
                          <span className={`text-sm font-mono ${v.delta > 0 ? 'text-green-600' : v.delta < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                            {v.delta > 0 ? '+' : ''}{v.delta.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 最近进化事件 */}
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-medium text-slate-700 mb-3">最近进化事件</h3>
              {events.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">暂无事件</p>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {events.map((e, i) => {
                    const typeInfo = EVENT_TYPE_LABELS[e.type] ?? { label: e.type, color: 'text-slate-600' };
                    return (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded bg-slate-50 text-sm">
                        <div className="flex items-center gap-3">
                          <span className={`font-medium ${typeInfo.color}`}>{typeInfo.label}</span>
                          <span className="text-slate-700">{DIMENSION_LABELS[e.capability] ?? e.capability}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-mono ${e.delta > 0 ? 'text-green-600' : e.delta < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                            {e.delta > 0 ? '+' : ''}{e.delta.toFixed(2)}
                          </span>
                          <span className="text-xs text-slate-400">{parseUtcDate(e.timestamp).toLocaleString('zh-CN')}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
