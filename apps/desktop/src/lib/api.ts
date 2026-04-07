import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Sidecar 连接配置 */
interface SidecarConfig {
  port: number;
  token: string;
}

/** 健康检查返回类型 */
export interface HealthStatus {
  status: 'ok' | 'needs-setup';
  timestamp: number;
  missing?: string[];
}

let sidecarConfig: SidecarConfig | null = null;

/** 设置 Sidecar 连接信息 */
export function setSidecarConfig(config: SidecarConfig) {
  sidecarConfig = config;
  localStorage.setItem('sidecar-config', JSON.stringify(config));
}

/** 获取 Sidecar base URL */
function getBaseUrl(): string {
  if (!sidecarConfig) throw new Error('Sidecar 未连接');
  return `http://127.0.0.1:${sidecarConfig.port}`;
}

/** 通用 fetch 封装 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  if (!sidecarConfig) throw new Error('Sidecar 未连接');

  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sidecarConfig.token}`,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/** 健康检查 — 返回完整状态 */
export async function healthCheck(): Promise<HealthStatus | null> {
  if (!sidecarConfig) return null;
  try {
    const res = await fetch(`${getBaseUrl()}/health`);
    if (!res.ok) return null;
    return await res.json() as HealthStatus;
  } catch {
    return null;
  }
}

/** 尝试从 Tauri 获取 Sidecar 信息并连接 */
async function tryConnect(): Promise<HealthStatus | null> {
  try {
    const info = await invoke<{ port: number; token: string; running: boolean }>('get_sidecar_info');
    if (info && info.running) {
      setSidecarConfig({ port: info.port, token: info.token });
      return await healthCheck();
    }
  } catch { /* Sidecar 尚未就绪 */ }
  return null;
}

/**
 * 初始化 Sidecar 连接
 *
 * 优先监听 Tauri 'sidecar-ready' 事件（零延迟），
 * 同时立即尝试连接（sidecar 可能在事件注册前已就绪）。
 * 最多等待 10 秒超时。
 */
export async function initSidecar(): Promise<HealthStatus | null> {
  // 1. 立即尝试（sidecar 可能已经启动完毕）
  const immediate = await tryConnect();
  if (immediate) return immediate;

  // 2. 监听 sidecar-ready 事件 + 短间隔轮询兜底
  return new Promise<HealthStatus | null>((resolve) => {
    let resolved = false;
    let unlisten: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const done = (result: HealthStatus | null) => {
      if (resolved) return;
      resolved = true;
      unlisten?.();
      if (pollTimer) clearInterval(pollTimer);
      resolve(result);
    };

    // 事件驱动：Tauri sidecar-ready 事件触发后立即连接
    listen<unknown>('sidecar-ready', async () => {
      const health = await tryConnect();
      if (health) done(health);
    }).then(fn => {
      unlisten = fn;
      if (resolved) fn(); // 如果已 resolve，立即清理
    });

    // 兜底轮询：200ms 间隔（防止事件丢失）
    pollTimer = setInterval(async () => {
      const health = await tryConnect();
      if (health) done(health);
    }, 200);

    // 超时保护：10 秒
    setTimeout(() => done(null), 10_000);
  });
}

/** GET 请求 */
export async function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

/** POST 请求 */
export async function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** PUT 请求 */
export async function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** DELETE 请求 */
export async function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

/** PATCH 请求 */
export async function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** 全量同步权限到 Rust 层 */
export async function syncPermissionsToRust(): Promise<void> {
  try {
    // 获取所有 Agent
    const agentsData = await get<{ agents: { id: string }[] }>('/agents');
    const entries: { agent_id: string; category: string; scope: string }[] = [];

    for (const agent of agentsData.agents) {
      try {
        const permData = await get<{ permissions: { category: string; scope: string }[] }>(
          `/security/${agent.id}/permissions`,
        );
        for (const perm of permData.permissions) {
          entries.push({
            agent_id: agent.id,
            category: perm.category,
            scope: perm.scope,
          });
        }
      } catch {
        // 跳过加载失败的 agent
      }
    }

    await invoke('sync_all_permissions', { entries });
  } catch (err) {
    console.error('权限同步到 Rust 层失败:', err);
  }
}
