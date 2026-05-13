/**
 * Skeleton — 加载占位组件（M15 PR-U3）
 *
 * 蜜糖渐变动画 + 双主题自动适配。替代 `animate-pulse` 简单占位。
 *
 * 用法：
 *   <Skeleton className="h-4 w-32" />              // 单条
 *   <Skeleton className="h-12 w-12 rounded-full" />// 圆形头像
 *   <SkeletonText lines={3} />                     // 多行文字
 *   <SkeletonCard />                                // 卡片占位
 */

interface SkeletonProps {
  className?: string;
}

/** 单条骨架（任意尺寸通过 className 控制） */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-accent rounded ${className}`}
      role="status"
      aria-label="加载中"
      aria-busy="true"
    >
      <span className="sr-only">加载中…</span>
    </div>
  );
}

/** 多行文本骨架 */
interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

/** 卡片骨架（头像 + 标题 + 两行文本） */
export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`p-4 bg-card border border-border rounded-xl ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

export default Skeleton;
