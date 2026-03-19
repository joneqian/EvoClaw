import { useState } from 'react';

interface ProtectionItem {
  id: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  tag: string;
  tagColor: string;
  desc: string;
  enabled: boolean;
}

export default function SecurityGuardPage() {
  const [items, setItems] = useState<ProtectionItem[]>([
    {
      id: 'env',
      icon: (
        <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
      iconBg: 'bg-orange-50',
      title: '电脑环境安全防护',
      tag: '主动防御',
      tagColor: 'border-orange-300 text-orange-500 bg-orange-50',
      desc: '当智能体调用各类工具时，系统会进行全过程的安全管控。识别并拦截可能破坏系统、窃取数据、尝试提权的高风险行为，保障您的电脑环境安全。',
      enabled: true,
    },
    {
      id: 'info',
      icon: (
        <svg className="w-6 h-6 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
      iconBg: 'bg-brand/10',
      title: '用户信息安全保护',
      tag: '智能识别',
      tagColor: 'border-green-300 text-green-600 bg-green-50',
      desc: '对输入给智能体的任务、提示词进行智能安全识别，自动检测是否包含个人隐私、敏感密钥、账号凭证等高风险信息，保障用户信息安全。',
      enabled: true,
    },
    {
      id: 'skill',
      icon: (
        <svg className="w-6 h-6 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
        </svg>
      ),
      iconBg: 'bg-teal-50',
      title: 'Skill 技能安全扫描',
      tag: '多层检测',
      tagColor: 'border-teal-300 text-teal-600 bg-teal-50',
      desc: '所有 Skill 在安装和接入前，系统都会进行多层安全检测，包括来源可信度、代码审查、权限评估等，确保所有接入的技能纯净无害。',
      enabled: true,
    },
  ]);

  const toggleItem = (id: string) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, enabled: !item.enabled } : item
    ));
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-4 shrink-0">
        <h2 className="text-lg font-bold text-slate-900">安全防护</h2>
        <p className="text-sm text-slate-400 mt-1">全方位保护您的系统环境和数据安全</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="max-w-3xl space-y-4">
          {items.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl border border-slate-200 p-6
                hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start gap-5">
                {/* 左侧图标 */}
                <div className={`w-12 h-12 rounded-xl ${item.iconBg} flex items-center justify-center shrink-0`}>
                  {item.icon}
                </div>

                {/* 中间内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-2">
                    <h3 className="text-base font-bold text-slate-800">{item.title}</h3>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border ${item.tagColor}`}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75" />
                      </svg>
                      {item.tag}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
                </div>

                {/* 右侧开关 + 状态 */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <button
                    onClick={() => toggleItem(item.id)}
                    className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                      item.enabled ? 'bg-brand' : 'bg-slate-300'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                      item.enabled ? 'left-[26px]' : 'left-0.5'
                    }`} />
                  </button>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                    item.enabled ? 'text-brand' : 'text-slate-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${item.enabled ? 'bg-brand' : 'bg-slate-300'}`} />
                    {item.enabled ? '保护中' : '已关闭'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 底部安全提示 */}
        <div className="flex items-center justify-center gap-2 mt-8 text-slate-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span className="text-sm">您的每一次操作都在系统严格保护之下</span>
        </div>
      </div>
    </div>
  );
}
