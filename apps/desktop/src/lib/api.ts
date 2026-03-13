/** Sidecar 连接配置 */
interface SidecarConfig {
  port: number;
  token: string;
}

let sidecarConfig: SidecarConfig | null = null;

/** 设置 Sidecar 连接信息 */
export function setSidecarConfig(config: SidecarConfig) {
  sidecarConfig = config;
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

/** 健康检查 */
export async function healthCheck(): Promise<boolean> {
  if (!sidecarConfig) return false;
  try {
    const res = await fetch(`${getBaseUrl()}/health`);
    return res.ok;
  } catch {
    return false;
  }
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
