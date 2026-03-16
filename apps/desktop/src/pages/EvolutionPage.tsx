import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';
import { get, put, post, del } from '../lib/api';
import type {
  CapabilityNode,
  GrowthEvent,
  GrowthVector,
  HeartbeatConfig,
  CronJobConfig,
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
  const dims = capabilities.length || 1;

  // 预定义的 8 维度（保证顺序一致）
  const allDimensions = ['coding', 'analysis', 'writing', 'research', 'planning', 'debugging', 'data', 'communication'];
  const data = allDimensions.map((dim) => {
    const cap = capabilities.find((c) => c.name === dim);
    return { name: dim, level: cap?.level ?? 0 };
  });

  const maxLevel = Math.max(10, ...data.map((d) => d.level));
  const n = data.length;

  // 计算各顶点坐标
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

  // 网格圆
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[280px] mx-auto">
      {/* 网格 */}
      {gridLevels.map((level) => (
        <circle
          key={level}
          cx={center}
          cy={center}
          r={maxRadius * level}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={0.5}
        />
      ))}
      {/* 轴线 */}
      {points.map((p, i) => (
        <line
          key={i}
          x1={center}
          y1={center}
          x2={center + maxRadius * Math.cos((Math.PI * 2 * i) / n - Math.PI / 2)}
          y2={center + maxRadius * Math.sin((Math.PI * 2 * i) / n - Math.PI / 2)}
          stroke="#e5e7eb"
          strokeWidth={0.5}
        />
      ))}
      {/* 能力多边形 */}
      <polygon points={polygon} fill="rgba(0,212,170,0.15)" stroke="#00d4aa" strokeWidth={1.5} />
      {/* 顶点圆点 */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#00d4aa" />
      ))}
      {/* 标签 */}
      {points.map((p, i) => (
        <text
          key={i}
          x={p.labelX}
          y={p.labelY}
          textAnchor="middle"
          dominantBaseline="central"
          className="text-[9px] fill-slate-500"
        >
          {DIMENSION_LABELS[p.name] ?? p.name}
        </text>
      ))}
    </svg>
  );
}

/** 进化仪表盘 */
export default function EvolutionPage() {
  const { agents } = useAgentStore();
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [capabilities, setCapabilities] = useState<CapabilityNode[]>([]);
  const [events, setEvents] = useState<GrowthEvent[]>([]);
  const [vector, setVector] = useState<GrowthVector[]>([]);
  const [heartbeat, setHeartbeat] = useState<HeartbeatConfig>({
    intervalMinutes: 30,
    activeHours: { start: '08:00', end: '22:00' },
    enabled: false,
  });
  const [cronJobs, setCronJobs] = useState<CronJobConfig[]>([]);
  const [loading, setLoading] = useState(false);

  // Cron 创建表单
  const [showCronForm, setShowCronForm] = useState(false);
  const [cronForm, setCronForm] = useState({ name: '', cronExpression: '0 * * * *', actionType: 'prompt', prompt: '' });

  // 默认选中第一个 agent
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  /** 加载数据 */
  const fetchData = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoading(true);
    try {
      const [capRes, eventRes, vecRes, hbRes, cronRes] = await Promise.all([
        get<{ capabilities: CapabilityNode[] }>(`/evolution/${selectedAgentId}/capabilities`),
        get<{ events: GrowthEvent[] }>(`/evolution/${selectedAgentId}/growth`),
        get<{ vector: GrowthVector[] }>(`/evolution/${selectedAgentId}/growth/vector`),
        get<{ config: HeartbeatConfig }>(`/evolution/${selectedAgentId}/heartbeat`),
        get<{ jobs: CronJobConfig[] }>(`/cron?agentId=${selectedAgentId}`),
      ]);
      setCapabilities(capRes.capabilities);
      setEvents(eventRes.events);
      setVector(vecRes.vector);
      setHeartbeat(hbRes.config);
      setCronJobs(cronRes.jobs);
    } catch {
      // 容错
    } finally {
      setLoading(false);
    }
  }, [selectedAgentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** 更新 Heartbeat 配置 */
  const saveHeartbeat = useCallback(async (config: HeartbeatConfig) => {
    if (!selectedAgentId) return;
    setHeartbeat(config);
    await put(`/evolution/${selectedAgentId}/heartbeat`, config);
  }, [selectedAgentId]);

  /** 创建 Cron 任务 */
  const createCronJob = useCallback(async () => {
    if (!selectedAgentId) return;
    try {
      await post('/cron', {
        agentId: selectedAgentId,
        name: cronForm.name,
        cronExpression: cronForm.cronExpression,
        actionType: cronForm.actionType,
        actionConfig: { prompt: cronForm.prompt },
      });
      setCronForm({ name: '', cronExpression: '0 * * * *', actionType: 'prompt', prompt: '' });
      setShowCronForm(false);
      fetchData();
    } catch {
      // 错误处理
    }
  }, [selectedAgentId, cronForm, fetchData]);

  /** 删除 Cron 任务 */
  const deleteCronJob = useCallback(async (id: string) => {
    await del(`/cron/${id}`);
    fetchData();
  }, [fetchData]);

  /** 能力统计 */
  const stats = useMemo(() => {
    const total = capabilities.length;
    const avgLevel = total > 0 ? capabilities.reduce((s, c) => s + c.level, 0) / total : 0;
    const totalUses = capabilities.reduce((s, c) => s + c.useCount, 0);
    return { total, avgLevel: avgLevel.toFixed(1), totalUses };
  }, [capabilities]);

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">进化仪表盘</h2>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            {agents.length === 0 && <option value="">暂无 Agent</option>}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedAgentId ? (
          <div className="text-center text-slate-400 mt-20">
            <p className="text-lg">请先创建一个 Agent</p>
          </div>
        ) : loading ? (
          <div className="text-center text-slate-400 mt-20">
            <p className="text-sm">加载中...</p>
          </div>
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
                          <span className="text-xs text-slate-400">{new Date(e.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Heartbeat 配置 */}
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-medium text-slate-700 mb-3">Heartbeat 心跳</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={heartbeat.enabled}
                    onChange={(e) => saveHeartbeat({ ...heartbeat, enabled: e.target.checked })}
                    className="rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  <span className="text-sm text-slate-700">启用心跳</span>
                </label>

                <div className="flex items-center gap-4">
                  <label className="text-sm text-slate-600">
                    间隔
                    <input
                      type="number"
                      min={5}
                      max={1440}
                      value={heartbeat.intervalMinutes}
                      onChange={(e) => saveHeartbeat({ ...heartbeat, intervalMinutes: Number(e.target.value) })}
                      className="ml-2 w-20 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                    <span className="ml-1 text-slate-400">分钟</span>
                  </label>

                  <label className="text-sm text-slate-600">
                    活跃时段
                    <input
                      type="text"
                      value={heartbeat.activeHours.start}
                      onChange={(e) => saveHeartbeat({ ...heartbeat, activeHours: { ...heartbeat.activeHours, start: e.target.value } })}
                      className="ml-2 w-16 px-2 py-1 text-sm border border-slate-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-brand"
                      placeholder="08:00"
                    />
                    <span className="mx-1">-</span>
                    <input
                      type="text"
                      value={heartbeat.activeHours.end}
                      onChange={(e) => saveHeartbeat({ ...heartbeat, activeHours: { ...heartbeat.activeHours, end: e.target.value } })}
                      className="w-16 px-2 py-1 text-sm border border-slate-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-brand"
                      placeholder="22:00"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Cron 定时任务 */}
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-700">定时任务</h3>
                <button
                  onClick={() => setShowCronForm(!showCronForm)}
                  className="px-3 py-1 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-active transition-colors"
                >
                  {showCronForm ? '取消' : '新建'}
                </button>
              </div>

              {/* 创建表单 */}
              {showCronForm && (
                <div className="mb-4 p-3 bg-slate-50 rounded-lg space-y-2">
                  <input
                    type="text"
                    value={cronForm.name}
                    onChange={(e) => setCronForm({ ...cronForm, name: e.target.value })}
                    placeholder="任务名称"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <input
                    type="text"
                    value={cronForm.cronExpression}
                    onChange={(e) => setCronForm({ ...cronForm, cronExpression: e.target.value })}
                    placeholder="Cron 表达式 (如 0 * * * *)"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <textarea
                    value={cronForm.prompt}
                    onChange={(e) => setCronForm({ ...cronForm, prompt: e.target.value })}
                    placeholder="执行 prompt"
                    rows={2}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand resize-none"
                  />
                  <button
                    onClick={createCronJob}
                    disabled={!cronForm.name || !cronForm.cronExpression}
                    className="px-4 py-1.5 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-active disabled:opacity-50 transition-colors"
                  >
                    创建
                  </button>
                </div>
              )}

              {/* 任务列表 */}
              {cronJobs.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">暂无定时任务</p>
              ) : (
                <div className="space-y-2">
                  {cronJobs.map((job) => (
                    <div key={job.id} className="flex items-center justify-between px-3 py-2 rounded bg-slate-50">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{job.name}</p>
                        <p className="text-xs text-slate-400">
                          {job.cronExpression} · {job.enabled ? '启用' : '禁用'}
                          {job.nextRunAt && ` · 下次: ${new Date(job.nextRunAt).toLocaleString()}`}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteCronJob(job.id)}
                        className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
