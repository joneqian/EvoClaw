/**
 * M14 PR-A6: 数据目录路径解析
 *
 * 集中处理 EvoClaw / HealthClaw 等品牌的数据根目录定位。所有持久化数据
 * （Agent workspace / skills / extension packs / credentials.json /
 *  conversations DB 等）都落在此目录下。
 *
 * 优先级：
 *   1. `{BRAND_NAME_UPPER}_HOME` 环境变量（IT 部署覆盖）
 *      - 例：`EVOCLAW_HOME=C:\\ProgramData\\EvoClaw` / `HEALTHCLAW_HOME=/opt/healthclaw`
 *      - 企业 IT 用 GPO / Ansible 设置实现统一部署位置
 *   2. fallback `{home}/{BRAND_DATA_DIR}`（如 `~/.evoclaw` / `~/.healthclaw`）
 *      - macOS / Linux：`HOME` 环境变量
 *      - Windows：`USERPROFILE` 环境变量
 *
 * 跨平台：路径用 `path.join` 拼接，分隔符按 OS 自适应（`/` vs `\\`）。
 *
 * 取舍：抄 hermes-desktop 的 `HERMES_HOME` 设计（src/main/installer.ts L10-11）。
 *
 * 放在 core/infrastructure 而非 shared：shared 是纯类型包（无 @types/node 依赖），
 * 不能用 path / os / process。core/infrastructure 是 runtime helper 自然归属。
 */

import path from 'node:path';
import os from 'node:os';
import { BRAND_NAME, BRAND_DATA_DIR } from '@evoclaw/shared';

/**
 * 获取数据目录绝对路径
 *
 * @returns 绝对路径，如 `/Users/alice/.evoclaw` 或 `C:\\Users\\alice\\.evoclaw`
 *          或 `{BRAND_NAME}_HOME` 环境变量指定的任意路径
 */
export function getDataDir(): string {
  const envVar = `${BRAND_NAME.toUpperCase()}_HOME`;
  const override = process.env[envVar];
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  return path.join(os.homedir(), BRAND_DATA_DIR);
}

/**
 * `{BRAND_NAME}_HOME` 环境变量名（仅用于日志 / 错误提示 / 文档生成）
 */
export const DATA_DIR_ENV_VAR = `${BRAND_NAME.toUpperCase()}_HOME`;
