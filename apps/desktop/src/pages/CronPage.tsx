import { useState, useCallback } from 'react';
import { Clock, RefreshCw, Trash2 } from 'lucide-react';
import Select from '../components/Select';

interface CronTask {
  id: string;
  name: string;
  expert: string;
  cron: string;
  cronLabel: string;
  description: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string;
  status: 'idle' | 'running' | 'success' | 'error';
}

const MOCK_TASKS: CronTask[] = [
  {
    id: '1', name: '每日健康报告', expert: '营养膳食专家', cron: '0 8 * * *', cronLabel: '每天 08:00',
    description: '根据用户最新健康数据生成每日膳食建议和运动提醒',
    enabled: true, lastRun: '2026-03-19 08:00', nextRun: '2026-03-20 08:00', status: 'success',
  },
  {
    id: '2', name: '血压监测提醒', expert: '慢病管理助手', cron: '0 9,15,21 * * *', cronLabel: '每天 09:00/15:00/21:00',
    description: '定时提醒用户测量血压并记录数据，异常时触发预警',
    enabled: true, lastRun: '2026-03-19 09:00', nextRun: '2026-03-19 15:00', status: 'running',
  },
  {
    id: '3', name: '周度体检数据分析', expert: '数据分析师', cron: '0 10 * * 1', cronLabel: '每周一 10:00',
    description: '汇总一周健康指标数据，生成趋势分析报告并推送到邮箱',
    enabled: false, lastRun: '2026-03-17 10:00', nextRun: '2026-03-24 10:00', status: 'idle',
  },
  {
    id: '4', name: '用药提醒', expert: '慢病管理助手', cron: '0 7,19 * * *', cronLabel: '每天 07:00/19:00',
    description: '按照处方用药计划，定时提醒服药并记录用药情况',
    enabled: true, lastRun: '2026-03-19 07:00', nextRun: '2026-03-19 19:00', status: 'success',
  },
];

const STATUS_CONFIG = {
  idle: { label: '待执行', dot: 'bg-border', text: 'text-muted-foreground' },
  running: { label: '执行中', dot: 'bg-info animate-pulse', text: 'text-info' },
  success: { label: '已完成', dot: 'bg-success', text: 'text-success' },
  error: { label: '执行失败', dot: 'bg-danger', text: 'text-danger' },
};

export default function CronPage() {
  const [tasks, setTasks] = useState<CronTask[]>(MOCK_TASKS);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', expert: '', cronLabel: '', description: '' });

  const toggleTask = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  }, []);

  const runNow = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'running' as const } : t));
    setTimeout(() => {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'success' as const, lastRun: new Date().toLocaleString('zh-CN') } : t));
    }, 2000);
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleCreate = useCallback(() => {
    if (!createForm.name.trim()) return;
    const newTask: CronTask = {
      id: Date.now().toString(),
      name: createForm.name,
      expert: createForm.expert || '营养膳食专家',
      cron: '0 8 * * *',
      cronLabel: createForm.cronLabel || '每天 08:00',
      description: createForm.description || '自定义定时任务',
      enabled: true,
      lastRun: null,
      nextRun: '即将执行',
      status: 'idle',
    };
    setTasks(prev => [newTask, ...prev]);
    setCreateForm({ name: '', expert: '', cronLabel: '', description: '' });
    setShowCreate(false);
  }, [createForm]);

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-6 pt-5 pb-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">定时任务</h2>
            <p className="text-sm text-muted-foreground mt-1">配置专家的周期性自动执行任务，让健康管理全天候运转</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-xl
              hover:bg-brand-hover shadow-sm transition-all"
          >
            {showCreate ? '取消' : '+ 新建任务'}
          </button>
        </div>

        {/* 统计条 */}
        <div className="flex gap-4 mt-4">
          {[
            { label: '运行中', value: tasks.filter(t => t.enabled).length, color: 'text-brand' },
            { label: '今日执行', value: tasks.filter(t => t.lastRun?.startsWith('2026-03-19')).length, color: 'text-info' },
            { label: '已暂停', value: tasks.filter(t => !t.enabled).length, color: 'text-muted-foreground' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 px-4 py-2 bg-card rounded-xl border border-border">
              <span className={`text-xl font-bold ${s.color}`}>{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 创建面板（独占内容区） */}
      {showCreate ? (
        <div className="flex-1 flex items-center justify-center px-6 pb-6">
          <div className="w-full max-w-lg p-6 bg-card rounded-2xl border border-border shadow-sm">
            <h3 className="text-base font-bold text-foreground mb-5">新建定时任务</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">任务名称</label>
                <input
                  value={createForm.name}
                  onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="例如：每日健康报告"
                  className="w-full px-3.5 py-2.5 text-sm border border-border rounded-xl bg-muted
                    focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand placeholder:text-muted-foreground"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">执行专家</label>
                  <Select
                    value={createForm.expert}
                    onChange={(val) => setCreateForm({ ...createForm, expert: val })}
                    placeholder="选择专家"
                    options={[
                      { value: '营养膳食专家', label: '营养膳食专家' },
                      { value: '慢病管理助手', label: '慢病管理助手' },
                      { value: '运动健身教练', label: '运动健身教练' },
                      { value: '心理健康顾问', label: '心理健康顾问' },
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">执行频率</label>
                  <Select
                    value={createForm.cronLabel}
                    onChange={(val) => setCreateForm({ ...createForm, cronLabel: val })}
                    placeholder="选择频率"
                    options={[
                      { value: '每天 08:00', label: '每天 08:00' },
                      { value: '每天 09:00/15:00/21:00', label: '每天三次' },
                      { value: '每周一 10:00', label: '每周一次' },
                      { value: '每月1号 09:00', label: '每月一次' },
                    ]}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">任务描述</label>
                <textarea
                  value={createForm.description}
                  onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="描述这个定时任务要做什么..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 text-sm border border-border rounded-xl bg-muted
                    focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand placeholder:text-muted-foreground resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreate}
                  disabled={!createForm.name.trim()}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-brand rounded-xl
                    hover:bg-brand-hover disabled:opacity-40 shadow-sm transition-all"
                >
                  创建任务
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-6 py-2.5 text-sm font-medium text-muted-foreground
                    bg-card border border-border rounded-xl
                    hover:bg-muted transition-all"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
      /* 任务列表 */
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mb-4">
              <Clock className="w-8 h-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">暂无定时任务</p>
            <p className="text-xs text-muted-foreground">点击右上角创建你的第一个自动化任务</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map(task => {
              const sc = STATUS_CONFIG[task.status];
              return (
                <div key={task.id} className={`bg-card rounded-2xl border p-5 transition-all duration-200
                  ${task.enabled ? 'border-border hover:shadow-md' : 'border-border opacity-60'}`}>
                  <div className="flex items-start gap-4">
                    {/* 左侧状态图标 */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      task.enabled ? 'bg-brand/10' : 'bg-accent'
                    }`}>
                      <Clock className={`w-5 h-5 ${task.enabled ? 'text-brand' : 'text-muted-foreground'}`} strokeWidth={1.5} aria-hidden="true" />
                    </div>

                    {/* 中间内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-bold text-foreground">{task.name}</h4>
                        <span className="px-2 py-0.5 text-xs font-medium bg-accent text-muted-foreground rounded-full">
                          {task.expert}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${sc.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          {sc.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{task.description}</p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                          {task.cronLabel}
                        </span>
                        {task.lastRun && <span>上次: {task.lastRun}</span>}
                        <span>下次: {task.nextRun}</span>
                      </div>
                    </div>

                    {/* 右侧操作 */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => runNow(task.id)}
                        disabled={task.status === 'running'}
                        className="px-3 py-1.5 text-xs font-medium text-brand border border-brand/30 rounded-lg
                          hover:bg-brand/5 disabled:opacity-40 transition-colors"
                        title="立即执行"
                      >
                        执行
                      </button>
                      <button
                        onClick={() => toggleTask(task.id)}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                          task.enabled ? 'bg-brand' : 'bg-border'
                        }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-card rounded-full shadow transition-transform duration-200 ${
                          task.enabled ? 'left-[22px]' : 'left-0.5'
                        }`} />
                      </button>
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-1.5 text-muted-foreground hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
