/**
 * 权限等待/响应注册表
 * 工具执行需要用户确认时，注册一个待决请求，
 * 前端 POST 回决策后解除等待
 */
import type { PermissionScope } from '@evoclaw/shared';

/** 待决权限请求 */
interface PendingRequest {
  resolve: (scope: PermissionScope | 'deny') => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();

/**
 * 等待用户权限决策
 * @param requestId 唯一请求 ID
 * @param timeoutMs 超时自动 deny（默认 60s）
 * @returns 用户决策的 scope 或 'deny'
 */
export function waitForPermission(
  requestId: string,
  timeoutMs: number = 60_000,
): Promise<PermissionScope | 'deny'> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      resolve('deny');
    }, timeoutMs);

    pending.set(requestId, { resolve, timeout });
  });
}

/**
 * 解决一个待决权限请求
 * @returns true 如果请求存在并已解决
 */
export function resolvePermission(
  requestId: string,
  decision: PermissionScope | 'deny',
): boolean {
  const entry = pending.get(requestId);
  if (!entry) return false;

  clearTimeout(entry.timeout);
  pending.delete(requestId);
  entry.resolve(decision);
  return true;
}

/** 获取待决请求数量（用于监控） */
export function getPendingCount(): number {
  return pending.size;
}
