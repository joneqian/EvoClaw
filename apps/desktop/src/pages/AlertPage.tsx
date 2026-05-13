import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronDown, Heart, Bell, Users, type LucideIcon } from 'lucide-react';

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

const LEVEL_CONFIG: Record<AlertLevel, { label: string; Icon: LucideIcon; bg: string; border: string; text: string; dot: string }> = {
  critical: {
    label: '严重', bg: 'bg-danger/10', border: 'border-danger/30', text: 'text-danger', dot: 'bg-danger',
    Icon: AlertTriangle,
  },
  warning: {
    label: '警告', bg: 'bg-warning/10', border: 'border-warning/30', text: 'text-warning', dot: 'bg-warning',
    Icon: AlertCircle,
  },
  info: {
    label: '提示', bg: 'bg-info/10', border: 'border-info/30', text: 'text-info', dot: 'bg-info',
    Icon: Info,
  },
};

const STATUS_TABS = [
  { key: 'all' as const, label: '全部' },
  { key: 'active' as const, label: '待处理' },
  { key: 'resolved' as const, label: '已处理' },
];

export default function AlertPage() {
  const { t } = useTranslation();
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
            <h2 className="text-lg font-bold text-foreground">{t('alertPage.title')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('alertPage.titleHint')}</p>
          </div>
          {activeCount > 0 && (
            <button
              onClick={resolveAll}
              className="px-4 py-2 text-sm font-medium text-muted-foreground
                bg-card border border-border rounded-xl
                hover:border-brand/40 hover:text-brand transition-all"
            >
              全部已读
            </button>
          )}
        </div>

        {/* 统计卡片 */}
        <div className="flex gap-4 mt-4">
          <div className="flex items-center gap-3 px-4 py-3 bg-card rounded-xl border border-border flex-1">
            <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-danger" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-bold text-danger">{criticalCount}</p>
              <p className="text-xs text-muted-foreground">严重预警</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-card rounded-xl border border-border flex-1">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Bell className="w-5 h-5 text-warning" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-bold text-warning">{activeCount}</p>
              <p className="text-xs text-muted-foreground">待处理</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-card rounded-xl border border-border flex-1">
            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-brand" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-bold text-brand">{patientCount}</p>
              <p className="text-xs text-muted-foreground">关注对象</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-card rounded-xl border border-border flex-1">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-success" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-bold text-success">{alerts.filter(a => a.status === 'resolved').length}</p>
              <p className="text-xs text-muted-foreground">已处理</p>
            </div>
          </div>
        </div>

        {/* 状态 Tab */}
        <div className="flex gap-1 mt-4 bg-accent rounded-xl p-1 w-fit">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.key === 'active' && activeCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs font-bold bg-danger text-white rounded-full">
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
            <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-success" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">一切正常</p>
            <p className="text-xs text-muted-foreground">当前没有需要关注的预警信息</p>
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
                    isResolved ? 'border-border opacity-60' : `${lc.border} hover:shadow-md`
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
                        <lc.Icon className={`w-5 h-5 ${lc.text}`} strokeWidth={1.5} aria-hidden="true" />
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-accent text-muted-foreground rounded-full">
                            <Heart className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                            {alert.patient}
                          </span>
                          <h4 className="text-sm font-bold text-foreground">{alert.title}</h4>
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${lc.bg} ${lc.text}`}>
                            {lc.label}
                          </span>
                          {isResolved && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-success/10 text-success rounded-full">
                              已处理
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{alert.description}</p>

                        {/* 展开详情 */}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-border space-y-2">
                            {alert.metric && (
                              <div className="flex gap-4">
                                <div className="px-3 py-2 bg-muted rounded-lg flex-1">
                                  <p className="text-xs text-muted-foreground mb-0.5">监测指标</p>
                                  <p className="text-sm font-semibold text-foreground">{alert.metric}</p>
                                </div>
                                <div className="px-3 py-2 bg-muted rounded-lg flex-1">
                                  <p className="text-xs text-muted-foreground mb-0.5">当前值</p>
                                  <p className={`text-sm font-semibold ${lc.text}`}>{alert.value}</p>
                                </div>
                                {alert.threshold && (
                                  <div className="px-3 py-2 bg-muted rounded-lg flex-1">
                                    <p className="text-xs text-muted-foreground mb-0.5">预警阈值</p>
                                    <p className="text-sm font-semibold text-foreground">{alert.threshold}</p>
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
                                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground
                                    border border-border rounded-lg hover:bg-muted transition-colors"
                                >
                                  忽略
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteAlert(alert.id); }}
                                  className="px-3 py-1.5 text-xs font-medium text-danger
                                    border border-danger/30 rounded-lg hover:bg-danger/10 transition-colors"
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
                        <p className="text-xs text-muted-foreground">{alert.time}</p>
                        <p className="text-xs text-muted-foreground mt-1">{alert.source}</p>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground ml-auto mt-2 transition-transform ${isExpanded ? 'rotate-180' : ''}`} strokeWidth={2} aria-hidden="true" />
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
