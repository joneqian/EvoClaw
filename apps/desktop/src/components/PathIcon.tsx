/**
 * PathIcon — 兼容 path 字符串图标的薄 wrapper
 *
 * M15 PR-U2 过渡组件：
 *   - 现状：部分页面（SecurityPage / SkillPage / ChatPage 等）使用 config-driven 图标，
 *     icon 字段存的是 SVG path 字符串。Lucide 不直接支持此模式，
 *     完全迁移需要重写所有 config 数组。
 *   - 目标：先把所有内联 <svg> 收编到这个 wrapper，统一加 aria-hidden=true
 *     + viewBox / strokeWidth / stroke / fill 标准化，
 *     后续 PR-U2b 可以逐个 config 迁移到 Lucide。
 *
 * 用法：
 *   <PathIcon d="M3 12..." className="w-4 h-4 text-muted-foreground" />
 *   <PathIcon d={['M3 12...', 'M5 6...']} ... />   // 多 path
 */

interface PathIconProps {
  d: string | readonly string[];
  className?: string;
  strokeWidth?: number;
}

export default function PathIcon({ d, className = 'w-4 h-4', strokeWidth = 1.5 }: PathIconProps) {
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      aria-hidden="true"
    >
      {paths.map((path, idx) => (
        <path key={idx} strokeLinecap="round" strokeLinejoin="round" d={path} />
      ))}
    </svg>
  );
}
