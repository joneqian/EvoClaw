# Windows 安装指南

> **目标读者**：在 Windows 10 / 11 上安装 EvoClaw / HealthClaw 桌面应用的员工与企业 IT。
> **本期状态**：未签名发行（D3 决策）。SmartScreen 会拦截，需要点 "更多信息 → 仍要运行" 绕过。长远靠 Authenticode 商用证书解决（见 [M14-CrossPlatform-Plan.md §八.5](../iteration-plans/M14-CrossPlatform-Plan.md)）。

---

## 一、装机步骤（员工本人）

### 1. 下载 `.exe`
从内部分发渠道（OneDrive / 邮件附件 / 企业仓库）拿到对应品牌的安装包：
- EvoClaw → `EvoClaw_x.y.z_x64-setup.exe`
- HealthClaw → `HealthClaw_x.y.z_x64-setup.exe`

### 2. 双击运行
**Windows SmartScreen 会拦截未签名应用**，弹窗提示：

> Windows 已保护你的电脑
> Microsoft Defender SmartScreen 阻止了无法识别的应用启动。

**绕过方法**：
1. 点蓝色链接 **"更多信息"**
2. 出现 **"仍要运行"** 按钮，点击
3. 应用正常启动安装

> 这是无签名版本的固定流程，不是错误。等本项目 Authenticode 商用证书到位会自动消除。

### 3. 安装位置
NSIS installer 配置为 `currentUser` 模式（不需要管理员权限）：
- **EXE 安装到**：`%LOCALAPPDATA%\EvoClaw\` / `%LOCALAPPDATA%\HealthClaw\`
- **数据目录**：`%USERPROFILE%\.evoclaw\` / `%USERPROFILE%\.healthclaw\`
  - 凭证：`credentials.json`
  - 数据库：`data\<brand>.db`
  - Skill 文件：`skills\`
  - 日志：`logs\core.log`
  - sidecar 运行时信息：`.runtime-info.json`

---

## 二、企业 IT 部署

### IT 渠道安装路径

| 方式 | 说明 |
|---|---|
| **手动分发** | OneDrive / SharePoint / 内部 wiki 挂 `.exe`，员工点击装 |
| **MDM 推送** | Intune / SCCM 把 `.exe` 当 Win32 app 推送，参数 `/S` 静默安装 |
| **GPO 静默部署** | 组策略 → 软件安装 → 派发 `.exe` |

### 跳过 SmartScreen 警告

| 方式 | 影响范围 | 风险 |
|---|---|---|
| **Defender 加白名单**（推荐）| 仅本组织 | 低 — 走 IT 审批 |
| **Endpoint Manager (Intune) 推白名单** | 集中管控 | 低 |
| **关闭 SmartScreen** | 全设备 | 高，不推荐 |

### 统一数据目录（IT 强制）

设置环境变量让所有员工的数据落在统一位置（C:\\ 比用户 home 易备份 / 监控）：

```cmd
:: 系统级（需管理员）
setx /M EVOCLAW_HOME "C:\ProgramData\EvoClaw"
setx /M HEALTHCLAW_HOME "C:\ProgramData\HealthClaw"
```

或 GPO 推送：

```
计算机配置 → 首选项 → Windows 设置 → 环境
新建 → 变量名：EVOCLAW_HOME，值：C:\ProgramData\EvoClaw
```

> 详见 [`docs/architecture/cross-platform-credential.md`](../architecture/cross-platform-credential.md) §企业部署。

---

## 三、卸载

### 控制面板 → 程序 → 卸载

NSIS installer 注册了卸载条目：
- 控制面板找到 EvoClaw / HealthClaw 点卸载
- 或 `%LOCALAPPDATA%\<Brand>\uninstall.exe` 直接运行

### 残留数据

卸载**不删数据目录**（`%USERPROFILE%\.<brand>\`）。如要完全清理：

```powershell
# PowerShell
Remove-Item -Recurse -Force "$env:USERPROFILE\.evoclaw"
Remove-Item -Recurse -Force "$env:USERPROFILE\.healthclaw"
```

保留数据目录是有意的 — 重装应用时凭证和聊天记录自动恢复。

---

## 四、排错

### 应用启动后白屏 / sidecar 启不来

**症状**：双击启动后窗口白屏几秒卡死，或前端报 "Sidecar 未启动"。

**排查**：
```powershell
# 1. 看运行时信息文件是否生成
Get-Content "$env:USERPROFILE\.evoclaw\.runtime-info.json"

# 2. 看 sidecar 日志
Get-Content "$env:USERPROFILE\.evoclaw\logs\core.log" -Tail 50

# 3. 看 bun 是否在内嵌位置
ls "$env:LOCALAPPDATA\EvoClaw\resources\bun-bin\"
# 应该有 bun.exe
```

### bun.exe 无法执行

**症状**：日志显示 "内嵌 bun 无法执行" + 自动 fallback 找系统 node。

**原因**：
- Windows Defender 隔离了未签名 bun.exe → 加白名单
- antivirus 杀软（如 360 / Norton / Bitdefender）误报 → 提交 false positive
- bun.exe 在 Windows arm64 上（如 Surface Pro X）— 当前不支持，需用 x64 模拟

### 凭证文件读不到

**症状**：每次启动都要重新配 LLM API Key。

**排查**：
```powershell
# 看凭证文件存在 + 权限
ls "$env:USERPROFILE\.evoclaw\credentials.json"
Get-Acl "$env:USERPROFILE\.evoclaw\credentials.json"
# Access 一栏应该仅 <你的账户>: FullControl
```

如果 ACL 包含其他用户，调用 `icacls` 修复：
```cmd
icacls "%USERPROFILE%\.evoclaw\credentials.json" /inheritance:r /grant:r "%USERNAME%:F"
```

### 多账户切换数据混乱

Windows 上 `%USERPROFILE%` 跟登录账户绑定。如果在同一台机器切换 Windows 账户，每个账户独立的数据目录（这是正确行为）。

要让多账户共用数据，用 `EVOCLAW_HOME=C:\ProgramData\EvoClaw`（见上文）。

---

## 五、版本升级

升级时**保留数据**：

1. 下新版 `.exe`
2. 直接装在旧版上面（NSIS 自动覆盖）
3. 首次启动会跑 macOS Keychain → JSON 自动迁移（Windows 无 Keychain，仅写 marker）
4. 数据目录不变，凭证 / 聊天 / Skill 都还在

如果遇到不兼容（极少），手动备份数据目录后重装：
```powershell
Copy-Item -Recurse "$env:USERPROFILE\.evoclaw" "$env:USERPROFILE\.evoclaw-backup-$(Get-Date -Format yyyyMMdd)"
```

---

## 六、已知限制（本期）

- ❌ **未签名**：SmartScreen 警告固定流程绕过（见上）
- ❌ **未公证**：Apple Notarize 等价物 Microsoft Store 上架未做
- ❌ **不支持 Windows arm64**：Bun 1.3.x Windows 暂只发行 x64 binary
- ❌ **Tauri Auto-Updater 受限**：未签名情况下自动更新不工作，本期手动下新版
- ⚠️ **杀软误报**：未签名 + Bun runtime spawning 子进程可能被部分 EDR/AV 拦截，IT 加白即可

签名 / 公证 / Updater 落地计划见 [M14-CrossPlatform-Plan.md §五 Phase 3](../iteration-plans/M14-CrossPlatform-Plan.md)。

---

## 七、反馈渠道

装机有问题 / 文档不清晰，提 Issue 或联系 IT。

- 项目仓库：https://github.com/joneqian/EvoClaw
- 相关 PR：M14 跨平台支持 Phase 1（#148 ~ #154）
