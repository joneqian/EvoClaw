import { useState, useCallback } from 'react';

type AlertLevel = 'critical' | 'warning' | 'info';
type AlertStatus = 'active' | 'resolved' | 'ignored';

interface AlertItem {
  id: string;
  title: string;
  description: string;
  level: AlertLevel;
  status: AlertStatus;
  source: string;
  patient: string;
  time: string;
  metric?: string;
  value?: string;
  threshold?: string;
}

const MOCK_ALERTS: AlertItem[] = [
  {
    id: '1', title: '血压异常偏高', description: '连续 3 次测量收缩压超过 140mmHg，建议尽快安排就医检查',
    level: 'critical', status: 'active', source: '慢病管理助手', patient: '张明华', time: '10 分钟前',
    metric: '收缩压', value: '152 mmHg', threshold: '> 140 mmHg',
  },
  {
    id: '2', title: '空腹血糖超标', description: '今晨空腹血糖 8.2 mmol/L，已超出正常范围，需关注饮食控制',
    level: 'critical', status: 'active', source: '慢病管理助手', patient: '李秀英', time: '30 分钟前',
    metric: '空腹血糖', value: '8.2 mmol/L', threshold: '> 7.0 mmol/L',
  },
  {
    id: '3', title: '今日饮水量不足', description: '截至当前，今日饮水量仅 600ml，建议及时补充水分',
    level: 'warning', status: 'active', source: '营养膳食专家', patient: '王建国', time: '1 小时前',
    metric: '饮水量', value: '600 ml', threshold: '< 1500 ml',
  },
  {
    id: '4', title: '睡眠质量持续下降', description: '近 7 天平均深睡比例低于 15%，可能影响免疫力和情绪状态',
    level: 'warning', status: 'active', source: '心理健康顾问', patient: '赵丽萍', time: '3 小时前',
    metric: '深睡比例', value: '12%', threshold: '< 15%',
  },
  {
    id: '5', title: '降压药服药遗漏', description: '昨日晚间降压药服用记录缺失，请确认并督促按时服药',
    level: 'info', status: 'active', source: '慢病管理助手', patient: '张明华', time: '12 小时前',
  },
  {
    id: '6', title: '体重趋势异常', description: '近 30 天体重持续上升 2.5kg，已建议调整膳食方案',
    level: 'warning', status: 'resolved', source: '营养膳食专家', patient: '陈志强', time: '1 天前',
    metric: '体重变化', value: '+2.5 kg', threshold: '月增 > 2 kg',
  },
  {
    id: '7', title: '孕期营养达标', description: '本周叶酸、铁、钙摄入均达推荐标准，胎儿发育指标正常',
    level: 'info', status: 'resolved', source: '母婴健康顾问', patient: '刘晓雯', time: '1 天前',
  },
  {
    id: '8', title: '运动量达标', description: '本周运动时长 210 分钟，达到推荐标准，继续保持',
    level: 'info', status: 'resolved', source: '运动健身教练', patient: '王建国', time: '2 天前',
  },
];

const LEVEL_CONFIG: Record<AlertLevel, { label: string; icon: React.ReactNode; bg: string; border: string; text: string; dot: string }> = {
  critical: {
    label: '严重', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-600', dot: 'bg-red-500',
    icon: <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>,
  },
  warning: {
    label: '警告', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', dot: 'bg-amber-500',
    icon: <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>,
  },
  info: {
    label: '提示', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', dot: 'bg-blue-500',
    icon: <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>,
  },
};

const STATUS_TABS = [
  { key: 'all' as const, label: '全部' },
  { key: 'active' as const, label: '待处理' },
  { key: 'resolved' as const, label: '已处理' },
];

export default function AlertPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>(MOCK_ALERTS);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'resolved'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = activeTab === 'all' ? alerts : alerts.filter(a => a.status === activeTab);

  const resolveAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'resolved' as AlertStatus } : a));
  }, []);

  const ignoreAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'ignored' as AlertStatus } : a));
  }, []);

  const deleteAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const resolveAll = useCallback(() => {
    setAlerts(prev => prev.map(a => a.status === 'active' ? { ...a, status: 'resolved' as AlertStatus } : a));
  }, []);

  const activeCount = alerts.filter(a => a.status === 'active').length;
  const criticalCount = alerts.filter(a => a.level === 'critical' && a.status === 'active').length;
  const patientCount = new Set(alerts.filter(a => a.status === 'active').map(a => a.patient)).size;

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-6 pt-5 pb-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">预警中心</h2>
            <p className="text-sm text-slate-400 mt-1">集中展示服务对象的健康预警信息，及时跟进处理</p>
          </div>
          {activeCount > 0 && (
            <button
              onClick={resolveAll}
              className="px-4 py-2 text-sm font-medium text-slate-600
                bg-white border border-slate-200 rounded-xl
                hover:border-brand/40 hover:text-brand transition-all"
            >
              全部已读
            </button>
          )}
        </div>

        {/* 统计卡片 */}
        <div className="flex gap-4 mt-4">
          <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-slate-200 flex-1">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-red-500">{criticalCount}</p>
              <p className="text-xs text-slate-400">严重预警</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-slate-200 flex-1">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-amber-500">{activeCount}</p>
              <p className="text-xs text-slate-400">待处理</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-slate-200 flex-1">
            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-brand">{patientCount}</p>
              <p className="text-xs text-slate-400">关注对象</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-slate-200 flex-1">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-green-500">{alerts.filter(a => a.status === 'resolved').length}</p>
              <p className="text-xs text-slate-400">已处理</p>
            </div>
          </div>
        </div>

        {/* 状态 Tab */}
        <div className="flex gap-1 mt-4 bg-slate-100 rounded-xl p-1 w-fit">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {tab.key === 'active' && activeCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full">
                  {activeCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 预警列表 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-slate-500 mb-1">一切正常</p>
            <p className="text-xs text-slate-400">当前没有需要关注的预警信息</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(alert => {
              const lc = LEVEL_CONFIG[alert.level];
              const isExpanded = expandedId === alert.id;
              const isResolved = alert.status === 'resolved' || alert.status === 'ignored';
              return (
                <div
                  key={alert.id}
                  className={`rounded-2xl border transition-all duration-200 ${
                    isResolved ? 'border-slate-100 opacity-60' : `${lc.border} hover:shadow-md`
                  }`}
                >
                  {/* 顶部色条 */}
                  {!isResolved && (
                    <div className={`h-1 rounded-t-2xl ${
                      alert.level === 'critical' ? 'bg-gradient-to-r from-red-400 to-red-500' :
                      alert.level === 'warning' ? 'bg-gradient-to-r from-amber-400 to-amber-500' :
                      'bg-gradient-to-r from-blue-400 to-blue-500'
                    }`} />
                  )}

                  <div
                    className="p-5 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                  >
                    <div className="flex items-start gap-4">
                      {/* 图标 */}
                      <div className={`w-10 h-10 rounded-xl ${lc.bg} flex items-center justify-center shrink-0`}>
                        {lc.icon}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600 rounded-full">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                            </svg>
                            {alert.patient}
                          </span>
                          <h4 className="text-sm font-bold text-slate-800">{alert.title}</h4>
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${lc.bg} ${lc.text}`}>
                            {lc.label}
                          </span>
                          {isResolved && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-green-50 text-green-500 rounded-full">
                              已处理
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{alert.description}</p>

                        {/* 展开详情 */}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                            {alert.metric && (
                              <div className="flex gap-4">
                                <div className="px-3 py-2 bg-slate-50 rounded-lg flex-1">
                                  <p className="text-xs text-slate-400 mb-0.5">监测指标</p>
                                  <p className="text-sm font-semibold text-slate-700">{alert.metric}</p>
                                </div>
                                <div className="px-3 py-2 bg-slate-50 rounded-lg flex-1">
                                  <p className="text-xs text-slate-400 mb-0.5">当前值</p>
                                  <p className={`text-sm font-semibold ${lc.text}`}>{alert.value}</p>
                                </div>
                                {alert.threshold && (
                                  <div className="px-3 py-2 bg-slate-50 rounded-lg flex-1">
                                    <p className="text-xs text-slate-400 mb-0.5">预警阈值</p>
                                    <p className="text-sm font-semibold text-slate-700">{alert.threshold}</p>
                                  </div>
                                )}
                              </div>
                            )}
                            {!isResolved && (
                              <div className="flex gap-2 pt-1">
                                <button
                                  onClick={(e) => { e.stopPropagation(); resolveAlert(alert.id); }}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-brand rounded-lg
                                    hover:bg-brand-hover transition-colors"
                                >
                                  标记已处理
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); ignoreAlert(alert.id); }}
                                  className="px-3 py-1.5 text-xs font-medium text-slate-500
                                    border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                  忽略
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteAlert(alert.id); }}
                                  className="px-3 py-1.5 text-xs font-medium text-red-500
                                    border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                                >
                                  删除
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 右侧信息 */}
                      <div className="text-right shrink-0">
                        <p className="text-xs text-slate-400">{alert.time}</p>
                        <p className="text-xs text-slate-400 mt-1">{alert.source}</p>
                        <svg className={`w-4 h-4 text-slate-300 ml-auto mt-2 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
