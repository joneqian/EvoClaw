import { useCallback } from 'react';
import AgentAvatar from './AgentAvatar';

/** 权限类别配置 */
const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  file_read: {
    label: '文件读取',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  file_write: {
    label: '文件修改',
    icon: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
  },
  network: {
    label: '网络访问',
    icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  shell: {
    label: '命令执行',
    icon: 'M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z',
    color: 'text-red-600',
    bg: 'bg-red-50',
  },
  browser: {
    label: '浏览器',
    icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3',
    color: 'text-cyan-600',
    bg: 'bg-cyan-50',
  },
  mcp: {
    label: 'MCP 工具',
    icon: 'M11.42 15.17l-5.658 3.286a1.125 1.125 0 01-1.674-1.087l1.058-6.3L.343 6.37a1.125 1.125 0 01.638-1.92l6.328-.924L10.14.706a1.125 1.125 0 012.02 0l2.83 5.82 6.328.924a1.125 1.125 0 01.638 1.92l-4.797 4.7 1.058 6.3a1.125 1.125 0 01-1.674 1.087L12 15.17z',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  skill: {
    label: '技能调用',
    icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
};

export interface PermissionDialogProps {
  isOpen: boolean;
  agentName: string;
  agentEmoji: string;
  category: string;
  resource: string;
  reason?: string;
  onDecision: (scope: 'always' | 'deny') => void;
  onClose: () => void;
}

export default function PermissionDialog({
  isOpen,
  agentName,
  category,
  resource,
  reason,
  onDecision,
  onClose,
}: PermissionDialogProps) {
  const handleOverlayClick = useCallback(() => {
    onDecision('deny');
    onClose();
  }, [onDecision, onClose]);

  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) return null;

  const config = CATEGORY_CONFIG[category] ?? {
    label: category, icon: '', color: 'text-slate-600', bg: 'bg-slate-50',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl shadow-slate-900/10 w-full max-w-[420px] mx-4
          animate-in fade-in zoom-in-95 duration-200"
        onClick={handleDialogClick}
      >
        {/* 顶部安全标识栏 */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
          <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span className="text-xs font-medium text-slate-500">权限请求</span>
        </div>

        {/* 主体 */}
        <div className="px-5 pt-5 pb-5">
          {/* Agent 信息 */}
          <div className="flex items-center gap-3 mb-5">
            <AgentAvatar name={agentName} size="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{agentName}</p>
              <p className="text-xs text-slate-400 mt-0.5">请求以下操作权限</p>
            </div>
          </div>

          {/* 权限详情卡片 */}
          <div className={`rounded-xl p-4 ${config.bg} mb-5`}>
            <div className="flex items-start gap-3">
              {config.icon && (
                <div className="w-9 h-9 rounded-lg bg-white/80 flex items-center justify-center shrink-0 shadow-sm">
                  <svg className={`w-5 h-5 ${config.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={config.icon} />
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${config.color}`}>{config.label}</p>
                <code className="block mt-1.5 text-xs text-slate-600 bg-white/60 px-2.5 py-1.5 rounded-md
                  break-all font-mono leading-relaxed">
                  {resource || '*'}
                </code>
              </div>
            </div>
            {reason && (
              <p className="mt-3 text-xs text-slate-500 leading-relaxed pl-12">
                {reason}
              </p>
            )}
          </div>

          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            允许后该专家将永久获得此类权限，你可以随时在安全中心撤销。
          </p>

          {/* 两个按钮 */}
          <div className="flex gap-3">
            <button
              onClick={() => { onDecision('deny'); onClose(); }}
              className="flex-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-150
                border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
            >
              拒绝
            </button>
            <button
              onClick={() => { onDecision('always'); onClose(); }}
              className="flex-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-150
                bg-brand text-white hover:bg-brand-hover shadow-sm"
            >
              允许
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
