# 33 — 发布流程 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/33-release-process.md`（272 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`scripts/release.py` ~768 行，CalVer + GitHub Release + 贡献者追踪
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`package.json` 硬编码 `0.1.0`，无发布脚本、无 CI/CD 工作流、无变更日志
> **综合判定**: 🔴 **EvoClaw 整体落后**（完整缺失发布基础设施，补齐需 1-2 人周）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 发布能力缺失，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes 发布流程** — 周期自动化驱动：
- **CalVer 标签**（`v{年}.{月}.{日}[.{N}]`）与 SemVer（`major.minor.patch`）双轨制
- **Git 日志解析**（提交分类、贡献者追踪、共同作者过滤）
- **Changelog 自动生成**（Markdown 按类别组织，含 PR 链接）
- **版本号同步**（`__version__` + `pyproject.toml` 保持一致）
- **构件自动构建**（`python -m build` → wheel + sdist）
- **GitHub Release 创建**（tag + 发行说明 + 上传产物）
- **CI/CD 多工作流**（tests.yml / docker-publish.yml / supply-chain-audit.yml）
- **贡献者致敬**（AUTHOR_MAP 映射 + Co-authored-by 提取 + AI 助手过滤）
- **发布频率**：周发布（~400 commits/week，v0.2.0 ~ v0.9.0 共 8 个版本）

**EvoClaw 发布现状** — 零自动化：
- **版本号**：多处硬编码 `0.1.0`（`package.json:3` + `apps/desktop/package.json:3` + `packages/core/package.json:3` + `Cargo.toml:3`）
- **无发布脚本**：没有 `scripts/release.*`
- **无 CHANGELOG**：无版本历史或变更日志文件
- **无 GitHub 工作流**：`.github/workflows/` 完全空白（无 CI/CD）
- **无版本同步机制**：修改版本号需手动改 4 个地方
- **DMG 静态产物**：无 auto-update 框架，无 GitHub Release 集成

**量级对比**：hermes 发布代码 ~1000 行（release.py + CI/CD 脚本），EvoClaw 为零。差异来自**库 vs 应用**的发布策略差异：hermes 需跨多发行通道同步版本，EvoClaw 当前仅 DMG 单通道但缺乏自动化。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 版本号策略 | 🔴 | hermes CalVer + SemVer 双轨，EvoClaw 硬编码 0.1.0，多处重复 |
| §3.2 | 版本号同步 | 🔴 | hermes regex 自动更新 2 处，EvoClaw 需手动改 4 处 |
| §3.3 | Git 日志解析 | 🔴 | hermes 完整的提交分类 + 格式化，EvoClaw 无 |
| §3.4 | 贡献者追踪与映射 | 🔴 | hermes AUTHOR_MAP (170 条) + noreply 模式识别，EvoClaw 无 |
| §3.5 | 共同作者提取 | 🔴 | hermes Co-authored-by 解析 + AI 助手过滤，EvoClaw 无 |
| §3.6 | Changelog 自动生成 | 🔴 | hermes Markdown 按类别组织，EvoClaw 无版本历史 |
| §3.7 | 构件构建与上传 | 🔴 | hermes wheel + sdist + GitHub Release，EvoClaw 无构件管理 |
| §3.8 | 版本更新流程 | 🔴 | hermes release.py --bump/--publish 自动化，EvoClaw 手动 |
| §3.9 | 发布工作流触发 | 🔴 | hermes 5 个 CI/CD 工作流，EvoClaw 无 .github/workflows |
| §3.10 | Docker 多架构发布 | 🔴 | hermes docker-publish.yml (amd64+arm64)，EvoClaw 无 Docker |
| §3.11 | 供应链审计 | 🔴 | hermes supply-chain-audit.yml CVE 扫描，EvoClaw 无 |
| §3.12 | DMG 自动化打包 | 🟡 | hermes 无（库不需 DMG），EvoClaw build-dmg.sh 手动触发 |
| §3.13 | Brand 发布隔离 | 🟢 | **反超** EvoClaw BRAND= env 参数化多品牌，hermes 单品牌 |
| §3.14 | Auto-update 框架 | 🔴 | hermes 无（库无需），EvoClaw Tauri updater 配置缺失 |
| §3.15 | 发布文档与说明 | 🔴 | hermes RELEASE_v*.md (v0.2.0~v0.9.0)，EvoClaw 无文档 |

**统计**: 🔴 13 / 🟡 1 / 🟢 1。

---

## 3. 机制逐条深度对比

### §3.1 版本号策略

**hermes**（`.research/33-release-process.md §2`）— 双轨制：

```
CalVer 标签:  v{年}.{月}.{日}[.{N}]
示例:        v2026.4.13, v2026.4.13.2, v2026.4.13.3
             （同日多次发布，自动后缀 .2/.3）

SemVer 版本: {major}.{minor}.{patch}
示例:        0.9.0, 0.8.0, 0.2.0
             （pyproject.toml + __version__ 同步）

发布周期:    每周一发布（400-500 commits/week）
```

**版本历史**（研究中 §2 表）：
- v0.9.0 (2026.4.13) — 487 commits、269 PRs、167 issues
- v0.8.0 (2026.4.8) — 209 PRs、82 issues
- 递推回 v0.2.0（2026.2 起始）

**同日冲突处理**（`scripts/release.py:next_available_tag()`，推测）：
```python
def next_available_tag(base_date_str):
    base = f"v{base_date_str}"
    if tag_exists(base):        # v2026.4.13 已存在
        if tag_exists(f"{base}.2"):     # v2026.4.13.2 已存在
            return f"{base}.3"  # v2026.4.13.3
        return f"{base}.2"
    return base
```

**EvoClaw**（`package.json:3` + `apps/desktop/package.json:3` + `packages/core/package.json:3` + `Cargo.toml:3`）:

```json
// 四处硬编码
{
  "version": "0.1.0"    // package.json:3
}

// apps/desktop/package.json:3
{
  "version": "0.1.0"
}

// packages/core/package.json:3
{
  "version": "0.1.0"
}

// apps/desktop/src-tauri/Cargo.toml:3
[package]
version = "0.1.0"
```

**版本号特点**：
- SemVer 单策略（无 CalVer 标签，无同日处理）
- 没有发布历史（版本始终 0.1.0）
- 无升版脚本（手动编辑 4 处文件）
- 无发布周期定义

**判定 🔴**：
- EvoClaw 完全缺失 CalVer + 同日处理机制
- 四处版本号重复导致**同步风险高**（容易忘改某处）
- 无升版脚本意味着**每次手动操作且容易出错**
- hermes 的双轨制（tag 用 CalVer，包管理用 SemVer）对跨发行通道同步友好，EvoClaw 目前无此需要但当扩展到 wheel/Docker 时会遇到麻烦

---

### §3.2 版本号同步

**hermes**（`scripts/release.py:188-198`）— regex 双位同步：

```python
def update_version_files(semver: str, calver_date: str):
    # hermes_cli/__init__.py
    content = VERSION_FILE.read_text()
    content = re.sub(
        r'__version__\s*=\s*"[^"]+"',
        f'__version__ = "{semver}"',
        content
    )
    # pyproject.toml
    pyproject = PYPROJECT_FILE.read_text()
    pyproject = re.sub(
        r'^version\s*=\s*"[^"]+"',
        f'version = "{semver}"',
        pyproject,
        flags=re.MULTILINE
    )
    PYPROJECT_FILE.write_text(pyproject)
```

**关键**：2 个位置通过 regex 替换一次性更新。

**EvoClaw** — 手动四处修改，目前无脚本。

**判定 🔴**：
- EvoClaw 完全无自动化版本同步
- 四处重复导致**遗漏风险**（例如忘改 Cargo.toml 导致编译器报版本号不匹配）
- hermes 的双文件同步已是**生产最小化**，EvoClaw 四处更糟

---

### §3.3 Git 日志解析与提交分类

**hermes**（`scripts/release.py:78-90`）— 7 类分类规则：

```python
def categorize_commit(subject: str) -> str:
    patterns = {
        "breaking": [r"^breaking[\s:(]", r"^!:", r"BREAKING CHANGE"],
        "features": [r"^feat[\s:(]", r"^add[\s:(]"],
        "fixes": [r"^fix[\s:(]", r"^bugfix[\s:(]"],
        "improvements": [r"^improve[\s:(]", r"^perf[\s:(]", r"^refactor[\s:(]"],
        "docs": [r"^doc[\s:(]", r"^docs[\s:(]"],
        "tests": [r"^test[\s:(]"],
        "chore": [r"^chore[\s:(]", r"^ci[\s:(]", r"^build[\s:(]"],
    }
    for category, regex_list in patterns.items():
        for pattern in regex_list:
            if re.search(pattern, subject, re.IGNORECASE):
                return category
    return "other"
```

**日志提取**（`scripts/release.py:222-238`）:

```python
def get_commits(since_tag=None):
    range_spec = f"{since_tag}..HEAD" if since_tag else "HEAD"
    log = git("log", range_spec, "--format=%H|%an|%ae|%s%x00%b%x00", "--no-merges")
    commits = []
    for entry in log.split("\0\0"):
        header, body = entry.split("\0", 1)
        sha, name, email, subject = header.split("|", 3)
        commits.append({
            "sha": sha, "category": categorize_commit(subject),
            "author_name": name, "author_email": email,
            "subject": subject
        })
    return commits
```

**EvoClaw** — 无日志解析：

```bash
grep -rn "categorize_commit\|get_commits" /Users/mac/src/github/jone_qian/EvoClaw/scripts/
# 零结果
```

**判定 🔴**：EvoClaw 完全缺失提交分类、Changelog 自动生成、Git 日志格式化解析。

---

### §3.4 贡献者追踪与 AUTHOR_MAP

**hermes**（`scripts/release.py:96-106`）— 170 条目静态映射表：

```python
AUTHOR_MAP = {
    "teknium1@gmail.com": "teknium1",
    "35742124+0xbyt4@users.noreply.github.com": "0xbyt4",
    # ... 200+ 条目
}

def resolve_author(name: str, email: str) -> str:
    if email in AUTHOR_MAP:
        return AUTHOR_MAP[email]
    # noreply 模式识别
    match = re.match(r"(\d+)\+(.+)@users\.noreply\.github\.com", email)
    if match:
        return f"@{match.group(2)}"
    return f"@{name.split()[0].lower()}"
```

**EvoClaw** — 无映射机制。

**判定 🔴**：EvoClaw 缺失贡献者映射。若后续有 Changelog，需建立 AUTHOR_MAP + noreply 模式识别。

---

### §3.5 共同作者提取与 AI 助手过滤

**hermes**（`scripts/release.py:111-117`）— Co-authored-by 解析 + 黑名单：

```python
def parse_coauthors(body: str) -> list:
    """从提交 body 尾部提取 Co-authored-by 行。"""
    pattern = re.compile(r"Co-authored-by:\s*(.+?)\s*<([^>]+)>", re.IGNORECASE)
    coauthors = []
    for match in pattern.finditer(body):
        name, email = match.groups()
        coauthors.append({"name": name, "email": email})
    return coauthors

_ignored_emails = {
    "noreply@anthropic.com",
    "noreply@github.com",
    "cursoragent@cursor.com"
}
```

**EvoClaw** — 无 Co-authored-by 处理。

**判定 🔴**：EvoClaw 缺失共同作者机制。若未来引入 Claude Code 等 AI 工具协作时，需补齐以区分人类 vs AI。

---

### §3.6 Changelog 自动生成

**hermes** — Markdown 按类别组织（见 RELEASE_v0.9.0 示例）。

**EvoClaw** — 无版本历史文件：

```bash
ls -la /Users/mac/src/github/jone_qian/EvoClaw/ | grep -i changelog
# 无结果
```

**判定 🔴**：EvoClaw 完全无 Changelog（无 CHANGELOG.md、无 RELEASE_v*.md、无版本历史记录）。

---

### §3.7 构件构建与上传

**hermes**（`scripts/release.py:203-217`）— wheel + sdist 双产物：

```python
def build_release_artifacts(semver: str) -> list[Path]:
    dist_dir = REPO_ROOT / "dist"
    shutil.rmtree(dist_dir, ignore_errors=True)
    subprocess.run([sys.executable, "-m", "build", "--sdist", "--wheel"], cwd=str(REPO_ROOT))
    return [p for p in dist_dir.iterdir() if semver in p.name]
    # 示例：dist/hermes_agent-0.9.0-py3-none-any.whl, dist/hermes_agent-0.9.0.tar.gz
```

**GitHub Release 上传**：使用 `gh release create --notes-file` 上传构件。

**EvoClaw** — 无构件管理：

```bash
grep -rn "gh.*release.*create" /Users/mac/src/github/jone_qian/EvoClaw/ | head
# 零结果
```

**判定 🔴**：EvoClaw 缺失构件上传自动化（DMG 本地构建后无 GitHub Release 同步）。

---

### §3.8 版本更新流程自动化

**hermes**（`scripts/release.py`）— 完整自动化脚本：

```python
# 用法：python scripts/release.py --bump minor --publish
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bump", choices=["major", "minor", "patch"])
    parser.add_argument("--publish", action="store_true")
```

**流程**：CalVer 生成 → 冲突检查 → SemVer bump → 日志解析 → 分类 → 贡献者提取 → Changelog 生成 → 若--publish则版本更新 + git commit + tag + push + wheel 构建 + GitHub Release。

**EvoClaw** — 完全手动，无脚本。

**判定 🔴**：EvoClaw 完全无发布自动化。

---

### §3.9 发布工作流触发

**hermes** — 5 个官方 GitHub Actions 工作流：

| 工作流 | 作用 |
|--------|------|
| tests.yml | pytest（10min 超时），单元+集成 |
| e2e-tests.yml | E2E 测试 |
| docker-publish.yml | Multi-arch Docker (amd64+arm64) |
| supply-chain-audit.yml | CVE 扫描 |
| skills-index.yml | 技能索引更新 |

**EvoClaw** — 工作流完全空白：

```bash
ls -la /Users/mac/src/github/jone_qian/EvoClaw/.github/workflows/
# 无文件
```

**判定 🔴**：EvoClaw 无任何 GitHub Actions（无 test/build/release 工作流）。

---

### §3.10 Docker 多架构发布

**hermes** — 完整 docker-publish.yml（amd64+arm64 buildx）。

**EvoClaw** — 无 Docker 支持、无 Dockerfile、无 docker-publish.yml。

**判定 🔴**：EvoClaw 无 Docker 发行通道（当前不需要，因为 DMG 是桌面应用）。

---

### §3.11 供应链审计

**hermes** — supply-chain-audit.yml CVE 扫描。

**EvoClaw** — 无供应链审计。

**判定 🔴**：EvoClaw 缺失依赖安全审计。

---

### §3.12 DMG 自动化打包

**hermes** — 无（库发行不需 DMG）。

**EvoClaw**（`scripts/build-dmg.sh:1-77`）— 四步骤手动脚本：

```bash
#!/bin/bash
set -e

# Step 0: Brand apply
BRAND="${BRAND:-evoclaw}"
bun scripts/brand-apply.mjs

# Step 1: Ensure Bun
node scripts/download-bun.mjs

# Step 2: Build dependencies
pnpm build

# Step 3: Verify output
[ -f "apps/desktop/src-tauri/target/release/bundle/dmg/EvoClaw.dmg" ] || exit 1

# Step 4: Tauri build
cd apps/desktop && tauri build
```

**判定 🟡**：脚本已有但需手动触发，无 CI/CD 工作流自动化。

---

### §3.13 Brand 发布隔离

**hermes** — 无品牌机制（单品牌 Nous Research）。

**EvoClaw**（`scripts/brand-apply.mjs:35-191`）— **反超**：

```bash
# 参数化发布
BRAND=evoclaw pnpm build:dmg:evoclaw
BRAND=healthclaw pnpm build:dmg:healthclaw
```

**多品牌优势**：共享代码库、env 隔离、版本同步自动。

**判定 🟢 反超**：hermes 无品牌机制，EvoClaw 的 brand-apply.mjs 优于单品牌。

---

### §3.14 Auto-update 框架

**hermes** — 无需（库不需自动更新）。

**EvoClaw** — Tauri updater 配置缺失。

**判定 🔴**：EvoClaw Tauri updater 未启用，用户无法自动更新。

---

### §3.15 发布文档与说明

**hermes** — 每个版本单独文档（RELEASE_v0.9.0.md 等）。

**EvoClaw** — 无发布文档。

**判定 🔴**：EvoClaw 无任何发布说明文档（无 CHANGELOG.md、无 RELEASE_v*.md）。

---

## 4. 建议改造蓝图（不承诺实施）

**P0（高 ROI，建议尽快）**:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | 版本号单一事实源 + version-bump.mjs | §3.1-2 | 0.5d | 🔥🔥🔥 | 避免版本号漂移，减少人工错误 |
| 2 | .github/workflows/test.yml（单元+lint） | §3.9 | 0.5d | 🔥🔥🔥 | 每个 PR 自动验证，降低发布风险 |
| 3 | 搭建基础 release.mjs（预览模式） | §3.8 | 1d | 🔥🔥 | 发布流程可复述可审计 |

**P1（中等 ROI）**:

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 4 | Git 日志解析 + 提交分类 | §3.3 | 1d | 自动 Changelog 基础 |
| 5 | 贡献者映射 (AUTHOR_MAP) | §3.4 | 0.5d | 致敬列表自动化 |
| 6 | .github/workflows/build-dmg.yml（发布触发） | §3.9 | 0.5d | GitHub Release 自动化 |
| 7 | CHANGELOG.md 初始化 | §3.6-15 | 0.25d | 版本历史文档 |
| 8 | Changelog 自动生成（release.mjs 完整） | §3.6-8 | 1d | release.mjs --publish 一键发布 |

**P2（长期规划）**:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 9 | 供应链审计工作流 | §3.11 | 0.5d |
| 10 | Tauri Auto-update 启用 | §3.14 | 1d |
| 11 | Docker 多架构发行（若支持 Sidecar-only） | §3.10 | 2d |
| 12 | NPM publish 自动化（若发布 @evoclaw/core） | 新增 | 0.5d |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | Brand 发布隔离（BRAND= env 参数化） | `scripts/brand-apply.mjs:35-191` | 无（单品牌） |

**关键观察**：EvoClaw 在发布流程整体上严重落后 hermes，但在"多品牌支持"这一维度有反超。hermes 若要支持社区分叉或授权合作伙伴定制品牌，需补齐类似的参数化系统。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-17）

- `package.json:3` ✅ `"version": "0.1.0"`
- `apps/desktop/package.json:3` ✅ `"version": "0.1.0"`
- `packages/core/package.json:3` ✅ `"version": "0.1.0"`
- `apps/desktop/src-tauri/Cargo.toml:3` ✅ `version = "0.1.0"`
- `scripts/build-dmg.sh:1-77` ✅ 四步骤 DMG 打包
- `scripts/brand-apply.mjs:35-191` ✅ 品牌自动注入
- `.github/workflows/` ✅ 目录存在但空

### 6.2 hermes 研究引用（章节 §）

- `.research/33-release-process.md` §1 发布流程角色
- `.research/33-release-process.md` §2 版本号策略（双轨制）
- `.research/33-release-process.md` §3 release.py 流程
- `.research/33-release-process.md` §4 CI/CD 集成

### 6.3 关联差距章节

- `30-build-packaging-gap.md` — 构件打包与多品牌
- `01-tech-stack-gap.md` — 依赖锁定与版本管理
- `02-repo-layout-gap.md` — monorepo 结构
- `27-cli-architecture-gap.md` — CLI 工作流

---

**本章完成**。

**关键发现**:

1. **🔴 完整缺失发布基础设施**：13 项明显落后，仅 1 项形态差异，1 项反超
2. **版本号同步危险**：4 处重复版本号，每次发布需手动改且容易遗漏
3. **无自动化脚本**：无 release.py/release.mjs，无 changelog 生成，无贡献者追踪
4. **无 CI/CD 工作流**：无 test/build/release 工作流，PR 无自动验证
5. **多品牌反超**：BRAND= env 隔离优于 hermes 单品牌
6. **建议优先级**：P0 版本管理 + P0 CI 工作流最紧迫（1-1.5 人周）

**工作量总估**：完整补齐到生产级别需 3-4 人周（P0 1.5d + P1 2d + P2 1-2d）。
