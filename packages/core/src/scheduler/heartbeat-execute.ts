import { createLogger } from '../infrastructure/logger.js';
import type { HeartbeatExecuteFn, HeartbeatExecuteOpts } from './heartbeat-runner.js';

const log = createLogger('heartbeat-execute');

/**
 * 创建 Heartbeat 执行函数
 *
 * 通过内部 HTTP 调用复用 chat /send 端点（SSE 流式），
 * 收集完整响应文本返回。保持与普通对话完全一致的执行管道，
 * 包括 ContextPlugin 生命周期、工具调用、零污染回滚等。
 *
 * @param port  Sidecar HTTP 端口
 * @param token Bearer 认证 token
 */
export function createHeartbeatExecuteFn(port: number, token: string): HeartbeatExecuteFn {
  return async (agentId: string, message: string, sessionKey: string, opts?: HeartbeatExecuteOpts): Promise<string> => {
    const url = `http://127.0.0.1:${port}/chat/${agentId}/send`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        message,
        sessionKey,
        isHeartbeat: true,
        lightContext: opts?.lightContext ?? false,
        modelOverride: opts?.model,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`heartbeat 请求失败: ${res.status} ${text}`);
    }

    // 消费 SSE 流，收集 text_delta 事件拼接完整响应
    const body = res.body;
    if (!body) {
      return '';
    }

    let fullResponse = '';
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件（data: {...}\n\n 格式）
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // 保留不完整的行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const json = trimmed.slice(5).trim();
          if (!json) continue;

          try {
            const event = JSON.parse(json);
            if (event.type === 'text_delta' && event.delta) {
              fullResponse += event.delta;
            }
          } catch {
            // 非 JSON 数据行，跳过
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    log.debug(`agent ${agentId} heartbeat 完成, 响应长度=${fullResponse.length}`);
    return fullResponse;
  };
}
