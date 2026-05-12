# M15 — UI 现代化 5 件套

## Context

**触发**：Hermes vs EvoClaw UI 对比（2026-05-12 当日完成）发现 EvoClaw 在工业级现代 UI 标准上得 **62 / 100**，Hermes 得 **78 / 100**。差距集中在 5 个工业地基项 — 暗色主题、图标库、Toast/Skeleton、i18n、a11y。EvoClaw 的视觉气质（极简白 + 大圆角 + 17px 根字号）其实更接近 2025-2026 Anthropic/Claude 流派，**只是地基没打**。

**目标**：5 件套全做，把分数推到 **85+**，反超 Hermes 同时保留 EvoClaw 的"AI 极简"视觉气质。

**用户确认**：2026-05-12 选择"全做，现在就开始"。

**范围实测**（grep 数据）：
- 总 tsx 文件：**42 个**（18 pages + 22 components + App + main）
- 硬编码 `bg-white` / `bg-slate-*` 颜色：**384 处** 跨 **37 文件**
- 内联 SVG：**86 处** 跨 **24 文件**
- 中文字面量（粗估）：**2203 处** 跨 ~40 文件
- 现有 aria 标注：**1 处**（基本零）
- 现有零散 toast 实现：**7 文件**（无统一系统）

---

## 一、PR 切分（5 个独立 PR，逐个 merge）

按 ROI 排序，前两个 PR 收益密度最高，先做。

### PR-U1: 暗色主题（3-5d）
**分支**：`feat/ui-dark-mode`

**改动**：
- `apps/desktop/src/index.css` 改造：
  - 新增完整 CSS variables 体系（仿 Hermes `main.css:6-71` 结构）：
    - 5 级背景：`--bg-primary` / `--bg-secondary` / `--bg-tertiary` / `--bg-elevated` / `--bg-hover`
    - 4 级文字：`--text-primary` / `--text-secondary` / `--text-muted` / `--text-tertiary`
    - 3 级边框：`--border-default` / `--border-strong` / `--border-subtle`
    - 品牌色保持 `#00d4aa`，暗色下提亮一档（`#00e5b8`）
    - 语义色：`--color-success/warning/danger/info`
  - 暗色 `[data-theme="dark"]` 段（默认亮色）
- `tailwind.config`（或 Vite plugin 配置）：
  - 启用 `darkMode: 'class'`
  - 把 `bg-surface` / `bg-muted` / `text-fg` / `text-fg-muted` 等语义类映射到 CSS vars
- 新增 `apps/desktop/src/contexts/ThemeProvider.tsx`：
  - 三态：`light` / `dark` / `system`
  - localStorage 持久化（key: `evoclaw:theme`）
  - `matchMedia('(prefers-color-scheme: dark)')` 系统跟随
- `apps/desktop/src/components/ThemeSwitcher.tsx`：图标按钮放到 Settings 顶部
- **Sweep 37 文件**：384 处硬编码颜色 → 语义类
  - `bg-white` → `bg-surface`
  - `bg-slate-50` → `bg-muted`
  - `bg-slate-100` → `bg-hover`
  - `text-slate-900` → `text-fg`
  - `text-slate-600` → `text-fg-muted`
  - `border-slate-200` → `border-default`
- 验证：8 个核心页面截图前后对比（Chat / Agents / Skills / Memory / Settings / Models / Setup / Permission Dialog）

**Verification**：
- pnpm test / pnpm lint 三 OS 绿
- 手测：所有 18 页面 light / dark / system 三模式无样式塌陷
- 切换 mac 系统主题 → 应用自动跟随（system 模式）
- localStorage 残留正确恢复

---

### PR-U2: lucide-react 图标库迁移（1-2d）
**分支**：`feat/ui-lucide-icons`

**改动**：
- `pnpm add lucide-react` 到 `apps/desktop/package.json`
- 抽样 24 文件 86 处 `<svg>` 内联 → 对应 Lucide 组件（同 Hermes 用法）
- IconNav 改造（最大单文件 30+ 图标）：每个 nav 项用 `MessageSquare` / `Sparkles` / `Users` / `Brain` / `Clock` / `ListChecks` / `Tag` / `RotateCcw` / `Plug` / `Shield` / `Settings` / `Cpu` ...
- 抽 `apps/desktop/src/components/Icon.tsx` 包装（封装 strokeWidth=1.5 + 默认 size + className 默认 `text-current` 自动跟暗色）
- 删除所有 `viewBox / fill / d` 字符串硬编码
- 替换原则：找 Lucide 最接近形状的图标；不存在的（罕见）保留 SVG 但抽到 `components/icons/CustomXxx.tsx`

**Verification**：
- 视觉对比：所有 24 文件改造前后截图，气质一致
- bundle size 变化：lucide-react tree-shake 后增量 < 50KB
- 暗色模式：所有图标自动跟主题（依靠 `text-current`）

---

### PR-U3: Toast + Skeleton 系统（1d）
**分支**：`feat/ui-feedback-system`

**改动**：
- `pnpm add sonner`（业界最现代 toast，shadcn 默认选项）
- 在 `App.tsx` 顶部挂 `<Toaster position="bottom-right" theme="system" richColors />`
- 替换 7 文件零散 toast 实现 → `toast.success() / toast.error() / toast.loading() / toast.promise()`
- 新增 `components/Skeleton.tsx`：
  - 蜜糖渐变动画（仿 shadcn skeleton）
  - 暗色/亮色双适配
  - 支持 `<Skeleton className="h-4 w-32" />` 任意尺寸
- 替换 18 处 `animate-pulse` 占位 → `<Skeleton />`
- 长任务（A-B 进度、Skill 安装、模型拉取）加 `toast.promise()` 包装

**Verification**：
- 4 类 toast 消息（success/error/info/loading）样式正常
- 暗色模式 toast 自动适配
- Skeleton 在 ChatPage 历史加载 / Agents 列表 / Skills 卡片 三处展示

---

### PR-U4: i18n 中英双语（react-i18next，3-4d）
**分支**：`feat/ui-i18n-zh-en`

**改动**：
- `pnpm add i18next react-i18next i18next-browser-languagedetector`
- 新增目录：
  - `apps/desktop/src/locales/zh-CN.json`（基线，2203 个 key）
  - `apps/desktop/src/locales/en-US.json`（人工 + AI 翻译，先全量然后校对）
- `apps/desktop/src/i18n.ts`：i18next 初始化 + 浏览器语言探测 + fallback 中文
- `App.tsx` 顶部 `<I18nextProvider />`
- **Sweep 42 文件**：2203 处中文字面量 → `t('key.path')`
  - 按 page / component 命名空间分组：`chat.placeholder` / `agents.create` / `settings.theme`
  - 工具脚本：写 `scripts/i18n-extract.mjs` 半自动提取 + 人工校对
- `LanguageSwitcher` 组件（中/英下拉，放 Settings 顶部）
- 日期 / 数字格式跟随 locale（`Intl.DateTimeFormat`）

**Verification**：
- pnpm dev 切换中/英，所有页面文案翻译正确
- 浏览器语言英文 → 默认英文，中文 → 默认中文
- 持久化：localStorage 记忆用户选择
- 翻译覆盖率：脚本扫描确保 100% 中文字面量已抽离

---

### PR-U5: ARIA + 键盘导航（2d）
**分支**：`feat/ui-a11y`

**改动**：
- 所有 modal / dialog（约 8 个）：
  - `role="dialog"` + `aria-modal="true"`
  - `aria-labelledby` 指向标题元素
  - `aria-describedby` 指向描述元素
  - Focus trap（用 `focus-trap-react` 或自写 hook）
  - ESC 关闭 + 第一个 input 自动 focus
- 所有图标按钮（约 60+ 处）：加 `aria-label="动作名"`
- 所有 input / select：
  - `aria-invalid` 错误状态
  - `aria-describedby` 关联错误提示 id
- 全局 focus 样式：`focus-visible:` 替代 `focus:` 避免点击残留焦点环
- Tab 顺序检查：用 `tabindex` 修正异常顺序
- IconNav / CommandPalette / Sidebar：键盘上下导航支持

**Verification**：
- axe-core Chrome 扩展跑分 a11y > 90
- 键盘 only 操作：能不用鼠标走完 "创建 Agent → 发消息 → 切换 Agent" 全流程
- 屏幕阅读器（macOS VoiceOver）：所有交互元素都能正确朗读

---

## 二、节奏与工作量

| PR | 净工时 | 累积 |
|---|---|---|
| **U1** 暗色主题 | 3-5d | 3-5d |
| **U2** lucide-react | 1-2d | 4-7d |
| **U3** Toast + Skeleton | 1d | 5-8d |
| **U4** i18n 中英 | 3-4d | 8-12d |
| **U5** ARIA + 键盘 | 2d | 10-14d |
| **合计** | **10-14d 净** | + buffer 3-4d → 真实 **2.5-3w** |

**节奏**：5 PR 串行 merge（不堆大 PR），每 PR 独立可上线、独立可回滚。U1 → U2 → U3 → U4 → U5 顺序固定（U1 是其他 4 项的视觉基底，必须先做）。

---

## 三、关键文件改动总览

### 新增
- `apps/desktop/src/contexts/ThemeProvider.tsx`
- `apps/desktop/src/components/ThemeSwitcher.tsx`
- `apps/desktop/src/components/LanguageSwitcher.tsx`
- `apps/desktop/src/components/Skeleton.tsx`
- `apps/desktop/src/components/Icon.tsx`（Lucide 包装）
- `apps/desktop/src/i18n.ts`
- `apps/desktop/src/locales/zh-CN.json`
- `apps/desktop/src/locales/en-US.json`
- `scripts/i18n-extract.mjs`
- `docs/iteration-plans/M15-UIModernization-Plan.md`（plan 落地存档）
- `docs/architecture/design-system.md`（CSS variables + 语义 token + 字号 / 间距 / 圆角分级文档）

### 修改
- `apps/desktop/package.json`（加 lucide-react / sonner / i18next 三个依赖）
- `apps/desktop/src/index.css`（完整 dual-theme CSS variables）
- `apps/desktop/vite.config.ts`（Tailwind darkMode: class）
- `apps/desktop/src/App.tsx`（顶部挂 Theme / I18n / Toaster providers）
- `apps/desktop/src/main.tsx`（i18n 初始化）
- **42 个 tsx 文件**（颜色 / 图标 / 文案 / aria 全面 sweep）
- `CLAUDE.md`（当前冲刺加 M15 UI 现代化 5 件套）
- `README.md`（截图换暗色版本）

### 复用（不改）
- React 19 / Tailwind 4 / Zustand / React Router 7 主框架不动
- 既有页面 JSX 结构基本不动（仅替换 className / 文字 / 图标）
- Vite + Tauri bundler 流程不动

---

## 四、决策点汇总

| 编号 | 议题 | 选择 | 理由 |
|---|---|---|---|
| D1 | 暗色实现 | CSS variables + Tailwind `darkMode: 'class'` | 比 Tailwind 自带 dark: 前缀更灵活（可主题化 / 可扩展第二品牌色） |
| D2 | 主题持久化 | localStorage `evoclaw:theme` | 跟其他设置一致，无需走 sidecar |
| D3 | 系统跟随 | `matchMedia` listener | 标准做法，Hermes 已验证 |
| D4 | 图标库 | lucide-react | 跟 Hermes 同款，社区最大，Tailwind 友好 |
| D5 | Toast 库 | sonner | shadcn 钦定，比 react-hot-toast 更现代 |
| D6 | i18n 框架 | react-i18next | Hermes 同款，社区最大，工具链最全 |
| D7 | 默认语言 | 浏览器探测 + fallback zh-CN | 国内为主，海外友好 |
| D8 | 翻译范围 | 仅 UI 文案，不翻 Agent 输出 | LLM 输出由模型 prompt 控制，不在 i18n 范围 |
| D9 | a11y 工具 | axe-core 自测，不上 CI | 本期人工兜底，CI 加 axe 留 PR-U6 |
| D10 | 焦点环 | `focus-visible:` 而非 `focus:` | 标准做法，避免鼠标点击残留 |

---

## 五、风险

| 风险 | 缓解 |
|---|---|
| 暗色 sweep 漏改导致暗色下某页"白底白字" | 截图前后对比 18 个页面 + 加 ESLint rule 禁 `bg-white` 硬编码（PR-U1 末尾） |
| lucide 找不到完全对应图标 | 罕见，保留 SVG 但抽到 `components/icons/Custom*.tsx`，避免回到内联 |
| sonner 暗色适配 | sonner 内置 `theme="system"` 自动跟随，已验证 |
| i18n 翻译质量（2203 key 一次性翻译） | 先用 AI 全量初稿 → 人工校对核心 200 key（chat / agents / settings 高频）→ 长尾按用户反馈迭代 |
| i18n key 命名冲突 | 按 page / component 命名空间隔离（`chat.*` / `agents.*`） |
| a11y 改造导致 tab 顺序混乱 | PR-U5 改造完用键盘 only 走核心流程验证 |
| ESLint 配置变化破坏 CI | 三 OS matrix 已就位，PR 跑通才合 |
| Bundle size 增长 | lucide tree-shake + sonner 轻量，预计总增量 < 200KB（可接受） |

---

## 六、对其他模块的影响

| 模块 | 影响 |
|---|---|
| M7 自进化 / Curator UI | EvolutionPage / SkillPage 颜色 + 图标 + 文案 sweep（PR-U1/U2/U4） |
| M13 Phase 2 task-plan | PlansPage 占位先 sweep，等业务实装时基底已就绪 |
| M14 Phase 2 Linux | UI 现代化与 Linux 桌面环境天然契合（GNOME / KDE 暗色优先），加分 |
| 飞书 / 微信 channel UI | ChannelPage sweep（PR-U1/U2） |
| Setup 引导 | SetupPage 第一印象，重点 sweep（PR-U1 必须） |
| Tauri 配置 | 不变 |

---

## 七、与 Hermes 对比的预期分数提升

| 维度 | 改造前 EvoClaw | 改造后 EvoClaw | Hermes |
|---|---|---|---|
| 暗色模式 | ❌ | ✅ | ✅ |
| 图标系统 | ❌ 手写 | ✅ lucide | ✅ lucide |
| Toast / Skeleton | ⚠️ 零散 | ✅ sonner | ✅ skeleton-pulse |
| i18n | ❌ | ✅ 中英 | ✅ 四语 |
| a11y | ❌ 1 aria | ✅ 全覆盖 | ⚠️ 未明 |
| Design Token | ⚠️ 浅 | ✅ 全套 | ✅ 全套 |
| 综合分（100 制）| **62** | **85+** | **78** |

预期 PR-U5 完成后 EvoClaw 在工业级 UI 标准上**反超 Hermes**，并保留 AI 极简视觉气质。

---

## 八、Verification（最终验收）

### 自动化
- `pnpm test`（unit + integration）三 OS CI 全绿
- `pnpm lint` 三 OS 通过
- `pnpm build:desktop` 三 OS 编译通过
- `scripts/i18n-extract.mjs` 报告中文残留 0 处
- ESLint rule 检查无 `bg-white` 硬编码

### 手测
- 18 个页面 light / dark / system 三模式截图对比无塌陷
- 8 个 modal a11y 跑分 > 90（axe-core）
- 键盘 only 走完 "创建 Agent → 发消息 → 安装 Skill → 切换主题 → 切换语言" 全流程
- macOS VoiceOver 朗读核心元素正确

---

## 九、落地存档（feedback_design_docs_location 遵守）

PR-U1 第一步：
1. 把本 plan 文件拷贝到 `docs/iteration-plans/M15-UIModernization-Plan.md`
2. 新增 `docs/architecture/design-system.md`（CSS variables / 字号 / 间距 / 圆角 / 阴影 / token 命名规范）
3. CLAUDE.md "当前冲刺" 加 "M15 UI 现代化 5 件套"
4. README.md 截图换暗色版本（PR-U1 完工后）

---

**审批后**按 U1 → U2 → U3 → U4 → U5 顺序串行开发（每 PR 单独建分支，feedback_branch_before_dev 遵守），逐个 review + merge，全部完成后归档 plan 入 docs/iteration-plans/。
