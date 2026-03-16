/**
 * AgentAvatar — 专业的 Agent 头像组件
 * 基于名称生成确定性渐变色 + 首字母
 */

/** 渐变色板 — 12 组专业配色 */
const GRADIENTS = [
  ['#6366f1', '#818cf8'], // indigo
  ['#8b5cf6', '#a78bfa'], // violet
  ['#ec4899', '#f472b6'], // pink
  ['#f43f5e', '#fb7185'], // rose
  ['#f97316', '#fb923c'], // orange
  ['#eab308', '#facc15'], // yellow
  ['#22c55e', '#4ade80'], // green
  ['#14b8a6', '#2dd4bf'], // teal
  ['#06b6d4', '#22d3ee'], // cyan
  ['#3b82f6', '#60a5fa'], // blue
  ['#0ea5e9', '#38bdf8'], // sky
  ['#a855f7', '#c084fc'], // purple
];

/** 根据名称生成确定性 hash */
function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** 提取首字母（支持中英文） */
function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // 中文：取第一个字
  if (/[\u4e00-\u9fff]/.test(trimmed[0]!)) {
    return trimmed[0]!;
  }
  // 英文：取首字母大写，最多两个
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  }
  return trimmed[0]!.toUpperCase();
}

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<AvatarSize, { container: string; text: string }> = {
  xs: { container: 'w-5 h-5 rounded', text: 'text-[9px]' },
  sm: { container: 'w-7 h-7 rounded-lg', text: 'text-[11px]' },
  md: { container: 'w-9 h-9 rounded-xl', text: 'text-sm' },
  lg: { container: 'w-11 h-11 rounded-xl', text: 'text-base' },
  xl: { container: 'w-14 h-14 rounded-2xl', text: 'text-lg' },
};

interface AgentAvatarProps {
  name: string;
  size?: AvatarSize;
  className?: string;
}

export default function AgentAvatar({ name, size = 'md', className = '' }: AgentAvatarProps) {
  const hash = hashName(name);
  const [from, to] = GRADIENTS[hash % GRADIENTS.length]!;
  const initials = getInitials(name);
  const sizeStyle = SIZE_MAP[size];

  return (
    <div
      className={`${sizeStyle.container} flex items-center justify-center font-semibold text-white shrink-0
        shadow-sm ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <span className={sizeStyle.text}>{initials}</span>
    </div>
  );
}
