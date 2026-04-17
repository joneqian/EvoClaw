/**
 * M5 UI: 统一 Skill 来源徽章
 *
 * 5 类来源使用不同色系区分信任边界：
 * - bundled: 靛色（内置可信）
 * - local:   石板色（用户自管）
 * - clawhub: 品牌紫（官方市场）
 * - github:  琥珀色（第三方，需警惕）
 * - mcp:     蓝色（MCP prompts 桥接）
 */

type Source = 'clawhub' | 'github' | 'local' | 'bundled' | 'mcp' | string;

const STYLES: Record<string, { label: string; color: string; icon: string }> = {
  bundled: { label: '内置', color: 'bg-indigo-50 text-indigo-700 border border-indigo-100', icon: '📦' },
  local: { label: '本地', color: 'bg-slate-50 text-slate-600 border border-slate-200', icon: '🗂️' },
  clawhub: { label: 'ClawHub', color: 'bg-violet-50 text-violet-700 border border-violet-100', icon: '✨' },
  github: { label: 'GitHub', color: 'bg-amber-50 text-amber-800 border border-amber-100', icon: '⚠' },
  mcp: { label: 'MCP', color: 'bg-sky-50 text-sky-700 border border-sky-100', icon: '🔌' },
};

interface Props {
  source: Source;
  size?: 'sm' | 'xs';
}

export default function SkillSourceBadge({ source, size = 'xs' }: Props) {
  const style = STYLES[source] ?? STYLES.local;
  const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-1.5 py-0.5';
  const textSize = size === 'sm' ? 'text-xs' : 'text-[10px]';
  return (
    <span className={`inline-flex items-center gap-1 ${padding} rounded-full font-medium ${textSize} ${style.color}`}>
      <span>{style.icon}</span>
      <span>{style.label}</span>
    </span>
  );
}
