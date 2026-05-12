# EvoClaw 设计系统

> **生效日期**: 2026-05-12
> **关联**: [M15-UIModernization-Plan.md](../iteration-plans/M15-UIModernization-Plan.md)
> **状态**: PR-U1（暗色主题）落地

---

## 一、设计哲学

EvoClaw 视觉语言走 **2025-2026 Anthropic / Claude / Perplexity AI 极简流派**：

- **大字号** — 根字号 17px（vs 主流 14-16px）
- **大圆角** — modal `rounded-2xl` (16px) / 卡片 `rounded-xl` (12px)
- **单一品牌色** — `#00d4aa` 翠绿，避免多彩工程师感
- **极简层次** — 5 级背景 / 4 级文字 / 3 级边框
- **双主题** — 亮色（默认）+ 暗色 + 系统跟随
- **Inter 字体** + cv02/cv03/cv04/cv11 字形微调

---

## 二、颜色 Token（shadcn 命名）

通过 Tailwind 4 `@theme` + `[data-theme]` 切换 CSS variables 实现双主题。

### 语义 Token 列表

| Tailwind 类 | CSS variable | 亮色 | 暗色 | 用途 |
|---|---|---|---|---|
| `bg-background` | `--color-background` | `#ffffff` | `#0b0f17` | 应用主底 |
| `text-foreground` | `--color-foreground` | `#0f172a` | `#e2e8f0` | 正文 / 标题 |
| `bg-card` | `--color-card` | `#ffffff` | `#11161f` | 卡片底色 |
| `text-card-foreground` | `--color-card-foreground` | `#0f172a` | `#e2e8f0` | 卡片内文字 |
| `bg-popover` | `--color-popover` | `#ffffff` | `#141a24` | 弹窗 / 菜单底 |
| `text-popover-foreground` | `--color-popover-foreground` | `#0f172a` | `#e2e8f0` | 弹窗内文字 |
| `bg-muted` | `--color-muted` | `#f8fafc` | `#1a212d` | 次级背景（边栏 / 占位）|
| `text-muted-foreground` | `--color-muted-foreground` | `#64748b` | `#94a3b8` | 次级文字（描述 / 灰字）|
| `bg-accent` | `--color-accent` | `#f1f5f9` | `#222a37` | hover / 选中态 |
| `text-accent-foreground` | `--color-accent-foreground` | `#0f172a` | `#e2e8f0` | hover 内文字 |
| `border-border` | `--color-border` | `#e2e8f0` | `#2a3340` | 默认边框 |
| `border-input` | `--color-input` | `#e2e8f0` | `#2a3340` | 输入框边框 |
| `ring-ring` | `--color-ring` | `#00d4aa` | `#00e5b8` | 焦点环 |

### 品牌色

| Tailwind 类 | 亮色 | 暗色 |
|---|---|---|
| `bg-brand` / `text-brand` | `#00d4aa` | `#00e5b8`（提亮一档）|
| `bg-brand-hover` / `text-brand-hover` | `#00c39c` | `#00d4aa` |
| `bg-brand-active` / `text-brand-active` | `#00a88a` | `#00c39c` |
| `bg-brand-muted` | `oklch(0.93 0.05 168)` | `oklch(0.25 0.05 168)` |

### 语义色（双主题统一）

| Tailwind 类 | 色值 | 用途 |
|---|---|---|
| `text-success` / `bg-success` | `#22c55e` | 成功 |
| `text-warning` / `bg-warning` | `#f59e0b` | 警告 |
| `text-danger` / `bg-danger` | `#ef4444` | 错误 / 破坏性操作 |
| `text-info` / `bg-info` | `#3b82f6` | 信息 / 提示 |

---

## 三、排版

```css
:root {
  font-size: 17px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text',
               'Segoe UI', system-ui, sans-serif;
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
  letter-spacing: -0.011em;
}
```

字号梯度（Tailwind 默认 9 档）：

| 类 | 字号 | 用途 |
|---|---|---|
| `text-xs` | 12px | 元数据 / 标签 |
| `text-sm` | 14px | 次级文字 |
| `text-base` | 17px | 正文（根字号）|
| `text-lg` | 19.13px | 强调正文 |
| `text-xl` | 21.25px | 副标题 |
| `text-2xl` | 25.5px | 卡片标题 |
| `text-3xl` | 31.88px | 页面标题 |
| `text-4xl` | 38.25px | Hero 标题 |

---

## 四、空间 / 圆角 / 阴影

### 空间（Tailwind 4px 网格）
- 紧凑：`gap-1` / `gap-2` (4-8px)
- 标准：`gap-3` / `gap-4` (12-16px)
- 宽松：`gap-6` / `gap-8` (24-32px)

### 圆角
| 类 | 半径 | 用途 |
|---|---|---|
| `rounded-md` | 6px | 小控件 / input |
| `rounded-lg` | 8px | 标准按钮 |
| `rounded-xl` | 12px | 卡片 / 导航项 |
| `rounded-2xl` | 16px | 对话气泡 / Modal |

### 阴影
| 类 | 用途 |
|---|---|
| `shadow-sm` | 卡片轻微抬升 |
| `shadow-md` | dropdown / popover |
| `shadow-lg` | 对话框 / 重要弹窗 |
| `shadow-2xl shadow-slate-900/10` | Modal 大对话框 |

---

## 五、主题切换实现

### CSS 层
```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

@theme {
  --color-background: var(--theme-background);
  --color-foreground: var(--theme-foreground);
  /* ... */
}

:root {
  --theme-background: #ffffff;
  --theme-foreground: #0f172a;
  /* ... 亮色变量 ... */
}

[data-theme="dark"] {
  --theme-background: #0b0f17;
  --theme-foreground: #e2e8f0;
  /* ... 暗色变量 ... */
}
```

### React 层
- `ThemeProvider`（`apps/desktop/src/contexts/ThemeProvider.tsx`）
  - 三态：`light` / `dark` / `system`
  - localStorage key: `evoclaw:theme`
  - `matchMedia('(prefers-color-scheme: dark)')` 系统跟随
  - 写入 `<html data-theme>` 触发 CSS variables 切换
- `ThemeSwitcher`（`apps/desktop/src/components/ThemeSwitcher.tsx`）
  - 三态切换按钮，挂在 Settings 顶部

---

## 六、命名约定

- **不要** 在 className 里硬编码颜色（`bg-white` / `bg-slate-*` / `text-slate-*`）
- **务必** 用语义 token（`bg-background` / `text-foreground` / `border-border`）
- **品牌色** 通过 `bg-brand` / `text-brand` 引用，不写 `#00d4aa`
- **状态色** 通过 `text-danger` / `text-success` 引用，不写 `text-red-500` / `text-green-500`

### ESLint 规则（PR-U1 收尾加）

```js
// .eslintrc 加 no-restricted-syntax
{
  "selector": "Literal[value=/\\b(bg|text|border)-(white|black|slate-[0-9]+)\\b/]",
  "message": "Use semantic tokens (bg-background / text-foreground / border-border) instead of hardcoded slate/white/black."
}
```

---

## 七、迁移指南

旧硬编码 → 新语义 token：

| 旧 | 新 |
|---|---|
| `bg-white` | `bg-background` 或 `bg-card` |
| `bg-slate-50` | `bg-muted` |
| `bg-slate-100` / `bg-slate-200` | `bg-accent` |
| `text-slate-900` / `text-slate-800` | `text-foreground` |
| `text-slate-700` / `text-slate-600` | `text-foreground` 或 `text-muted-foreground` |
| `text-slate-500` / `text-slate-400` | `text-muted-foreground` |
| `border-slate-200` / `border-slate-100` | `border-border` |
| `bg-red-500` | `bg-danger` |
| `text-red-600` | `text-danger` |
| `bg-emerald-500` / `text-green-600` | `bg-success` / `text-success` |
| `bg-amber-500` | `bg-warning` |
| `bg-blue-500` | `bg-info` |

---

## 八、参考

- [shadcn/ui design tokens](https://ui.shadcn.com/docs/theming)
- [Tailwind CSS 4 dark mode](https://tailwindcss.com/docs/dark-mode)
- [Hermes-desktop main.css](https://github.com/hermes-agent/hermes-desktop/blob/main/src/renderer/src/assets/main.css)（CSS variables 结构灵感来源）
