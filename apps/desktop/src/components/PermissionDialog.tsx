import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalA11y } from '../hooks/useModalA11y';
import {
  FileText,
  FilePen,
  Globe,
  Terminal,
  Compass,
  Star,
  Zap,
  Shield,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import AgentAvatar from './AgentAvatar';

/** 权限类别配置 */
interface CategoryConfig {
  label: string;
  Icon: LucideIcon;
  color: string;
  bg: string;
}

const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  file_read: {
    label: '文件读取',
    Icon: FileText,
    color: 'text-info',
    bg: 'bg-info/10',
  },
  file_write: {
    label: '文件修改',
    Icon: FilePen,
    color: 'text-warning',
    bg: 'bg-warning/10',
  },
  network: {
    label: '网络访问',
    Icon: Globe,
    color: 'text-purple-600 dark:text-purple-300',
    bg: 'bg-purple-50 dark:bg-purple-950/40',
  },
  shell: {
    label: '命令执行',
    Icon: Terminal,
    color: 'text-danger',
    bg: 'bg-danger/10',
  },
  browser: {
    label: '浏览器',
    Icon: Compass,
    color: 'text-cyan-600 dark:text-cyan-300',
    bg: 'bg-cyan-50 dark:bg-cyan-950/40',
  },
  mcp: {
    label: 'MCP 工具',
    Icon: Star,
    color: 'text-indigo-600 dark:text-indigo-300',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
  },
  skill: {
    label: '技能调用',
    Icon: Zap,
    color: 'text-success',
    bg: 'bg-success/10',
  },
};

export interface PermissionDialogProps {
  isOpen: boolean;
  agentName: string;
  agentEmoji: string;
  category: string;
  resource: string;
  reason?: string;
  /** Smart Approve escalate 时的 LLM 评估理由（可选） */
  smartApprove?: { decision: 'escalate'; reason: string };
  onDecision: (scope: 'always' | 'deny') => void;
  onClose: () => void;
}

export default function PermissionDialog({
  isOpen,
  agentName,
  category,
  resource,
  reason,
  smartApprove,
  onDecision,
  onClose,
}: PermissionDialogProps) {
  const { t } = useTranslation();
  const handleOverlayClick = useCallback(() => {
    onDecision('deny');
    onClose();
  }, [onDecision, onClose]);

  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const ref = useModalA11y<HTMLDivElement>({ isOpen, onClose: handleOverlayClick });

  if (!isOpen) return null;

  const config: CategoryConfig = CATEGORY_CONFIG[category] ?? {
    label: category, Icon: Shield, color: 'text-muted-foreground', bg: 'bg-muted',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={handleOverlayClick}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-title"
        aria-describedby="permission-desc"
        className="bg-card rounded-2xl shadow-2xl shadow-foreground/10 w-full max-w-[420px] mx-4
          animate-in fade-in zoom-in-95 duration-200"
        onClick={handleDialogClick}
      >
        {/* 顶部安全标识栏 */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/50 rounded-t-2xl">
          <Shield className="w-4 h-4 text-warning" strokeWidth={2} aria-hidden="true" />
          <span id="permission-title" className="text-xs font-medium text-muted-foreground">{t('permission.title')}</span>
        </div>

        {/* 主体 */}
        <div className="px-5 pt-5 pb-5">
          {/* Agent 信息 */}
          <div className="flex items-center gap-3 mb-5">
            <AgentAvatar name={agentName} size="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{agentName}</p>
              <p id="permission-desc" className="text-xs text-muted-foreground mt-0.5">{t('permission.requesting')}</p>
            </div>
          </div>

          {/* 权限详情卡片 */}
          <div className={`rounded-xl p-4 ${config.bg} mb-5`}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-card/80 flex items-center justify-center shrink-0 shadow-sm">
                <config.Icon className={`w-5 h-5 ${config.color}`} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${config.color}`}>{config.label}</p>
                <code className="block mt-1.5 text-xs text-muted-foreground bg-card/60 px-2.5 py-1.5 rounded-md
                  break-all font-mono leading-relaxed">
                  {resource || '*'}
                </code>
              </div>
            </div>
            {reason && (
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed pl-12">
                {reason}
              </p>
            )}
          </div>

          {/* Smart Approve 评估理由（仅 escalate 时展示） */}
          {smartApprove && (
            <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10/60 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-warning" strokeWidth={2} aria-hidden="true" />
                <span className="text-[11px] font-semibold text-warning">{t('permission.smartReview')}</span>
              </div>
              <p className="text-xs text-warning/90 leading-relaxed">
                {smartApprove.reason}
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            {t('permission.permanentHint')}
          </p>

          {/* 两个按钮 */}
          <div className="flex gap-3">
            <button
              onClick={() => { onDecision('deny'); onClose(); }}
              className="flex-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-150
                border border-border text-muted-foreground hover:bg-muted hover:border-border"
            >
              {t('permission.deny')}
            </button>
            <button
              onClick={() => { onDecision('always'); onClose(); }}
              className="flex-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-150
                bg-brand text-white hover:bg-brand-hover shadow-sm"
            >
              {t('permission.allow')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
