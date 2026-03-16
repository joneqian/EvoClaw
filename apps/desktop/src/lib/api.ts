import { invoke } from '@tauri-apps/api/core';

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

/** 初始化 Sidecar 连接（从 Tauri invoke 获取连接信息） */
export async function initSidecar(): Promise<HealthStatus | null> {
  // 指数退避重试，Sidecar 启动需要 1-2s
  const maxRetries = 5;
  const baseDelay = 500;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const info = await invoke<{ port: number; token: string; running: boolean }>('get_sidecar_info');
      if (info && info.running) {
        setSidecarConfig({ port: info.port, token: info.token });
        const health = await healthCheck();
        if (health) return health;
      }
    } catch {
      // Sidecar 尚未就绪，等待后重试
    }
    await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, i)));
  }
  return null;
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
