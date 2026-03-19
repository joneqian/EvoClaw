import { useState, useCallback } from 'react';

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
  idle: { label: '待执行', dot: 'bg-slate-300', text: 'text-slate-400' },
  running: { label: '执行中', dot: 'bg-blue-400 animate-pulse', text: 'text-blue-500' },
  success: { label: '已完成', dot: 'bg-green-400', text: 'text-green-500' },
  error: { label: '执行失败', dot: 'bg-red-400', text: 'text-red-500' },
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
            <h2 className="text-lg font-bold text-slate-900">定时任务</h2>
            <p className="text-sm text-slate-400 mt-1">配置专家的周期性自动执行任务，让健康管理全天候运转</p>
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
            { label: '今日执行', value: tasks.filter(t => t.lastRun?.startsWith('2026-03-19')).length, color: 'text-blue-500' },
            { label: '已暂停', value: tasks.filter(t => !t.enabled).length, color: 'text-slate-400' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200">
              <span className={`text-xl font-bold ${s.color}`}>{s.value}</span>
              <span className="text-xs text-slate-500">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 创建面板（独占内容区） */}
      {showCreate ? (
        <div className="flex-1 flex items-center justify-center px-6 pb-6">
          <div className="w-full max-w-lg p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-base font-bold text-slate-800 mb-5">新建定时任务</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">任务名称</label>
                <input
                  value={createForm.name}
                  onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="例如：每日健康报告"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50
                    focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand placeholder:text-slate-400"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">执行专家</label>
                  <select
                    value={createForm.expert}
                    onChange={e => setCreateForm({ ...createForm, expert: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50
                      focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand text-slate-700"
                  >
                    <option value="">选择专家</option>
                    <option value="营养膳食专家">营养膳食专家</option>
                    <option value="慢病管理助手">慢病管理助手</option>
                    <option value="运动健身教练">运动健身教练</option>
                    <option value="心理健康顾问">心理健康顾问</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">执行频率</label>
                  <select
                    value={createForm.cronLabel}
                    onChange={e => setCreateForm({ ...createForm, cronLabel: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50
                      focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand text-slate-700"
                  >
                    <option value="">选择频率</option>
                    <option value="每天 08:00">每天 08:00</option>
                    <option value="每天 09:00/15:00/21:00">每天三次</option>
                    <option value="每周一 10:00">每周一次</option>
                    <option value="每月1号 09:00">每月一次</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">任务描述</label>
                <textarea
                  value={createForm.description}
                  onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="描述这个定时任务要做什么..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50
                    focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand placeholder:text-slate-400 resize-none"
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
                  className="px-6 py-2.5 text-sm font-medium text-slate-600
                    bg-white border border-slate-200 rounded-xl
                    hover:bg-slate-50 transition-all"
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
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-slate-500 mb-1">暂无定时任务</p>
            <p className="text-xs text-slate-400">点击右上角创建你的第一个自动化任务</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map(task => {
              const sc = STATUS_CONFIG[task.status];
              return (
                <div key={task.id} className={`bg-white rounded-2xl border p-5 transition-all duration-200
                  ${task.enabled ? 'border-slate-200 hover:shadow-md' : 'border-slate-100 opacity-60'}`}>
                  <div className="flex items-start gap-4">
                    {/* 左侧状态图标 */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      task.enabled ? 'bg-brand/10' : 'bg-slate-100'
                    }`}>
                      <svg className={`w-5 h-5 ${task.enabled ? 'text-brand' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>

                    {/* 中间内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-bold text-slate-800">{task.name}</h4>
                        <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-500 rounded-full">
                          {task.expert}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${sc.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          {sc.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-2">{task.description}</p>
                      <div className="flex items-center gap-4 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                          </svg>
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
                          task.enabled ? 'bg-brand' : 'bg-slate-300'
                        }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                          task.enabled ? 'left-[22px]' : 'left-0.5'
                        }`} />
                      </button>
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
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
