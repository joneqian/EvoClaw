/**
 * Bun 原生 SSE 流 — 绕过 Hono 的 TransformStream 双层包装
 *
 * Hono streamSSE 在 Bun 下不 flush 的原因：
 * 1. Hono 用 TransformStream → 二次 ReadableStream(pull) 包装
 * 2. Hono 中间件合并 headers 时 clone Response body
 * 3. Bun 1.3.x 对非直接创建的 ReadableStream 有缓冲行为
 *
 * 此模块提供与 Hono SSEStreamingApi 兼容的接口，直接使用
 * ReadableStream controller.enqueue() 写入数据，由 Bun.serve()
 * 原生处理，确保每条 SSE 事件立即 flush 到客户端。
 *
 * Node.js 环境仍使用 Hono streamSSE（@hono/node-server 基于 node:http，flush 正常）。
 */

const encoder = new TextEncoder();

export interface SSEMessage {
  data: string;
  event?: string;
  id?: string;
  retry?: string;
}

export interface BunSSEStream {
  /** 写入一条 SSE 事件（兼容 Hono SSEStreamingApi.writeSSE） */
  writeSSE(message: SSEMessage): Promise<void>;
  /** 注册连接关闭回调 */
  onAbort(cb: () => void): void;
  /** 关闭流 */
  close(): void;
  /** 流是否已关闭 */
  readonly closed: boolean;
}

/**
 * 创建 Bun 原生 SSE 流
 *
 * @param onStream - 回调函数，接收 BunSSEStream 对象进行事件写入
 * @param signal - 可选 AbortSignal，客户端断开时触发
 * @returns 可直接返回给 Bun.serve() 的 Response
 */
export function createBunSSEResponse(
  onStream: (stream: BunSSEStream) => Promise<void>,
  signal?: AbortSignal | null,
): Response {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const abortCallbacks: Array<() => void> = [];

  const stream: BunSSEStream = {
    async writeSSE(message: SSEMessage) {
      if (closed || !controller) return;
      const lines: string[] = [];
      if (message.event) lines.push(`event: ${message.event}`);
      // data 可能包含换行，每行需要加 data: 前缀
      const dataLines = message.data.split(/\r\n|\r|\n/);
      for (const line of dataLines) {
        lines.push(`data: ${line}`);
      }
      if (message.id) lines.push(`id: ${message.id}`);
      if (message.retry) lines.push(`retry: ${message.retry}`);
      lines.push('', ''); // 空行分隔 SSE 事件
      try {
        controller.enqueue(encoder.encode(lines.join('\n')));
      } catch {
        // controller 已关闭，忽略
      }
    },
    onAbort(cb: () => void) {
      abortCallbacks.push(cb);
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller?.close();
      } catch {
        // 已关闭，忽略
      }
    },
    get closed() {
      return closed;
    },
  };

  const readable = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;

      // 客户端断开时触发 abort 回调
      if (signal) {
        signal.addEventListener('abort', () => {
          closed = true;
          for (const cb of abortCallbacks) {
            try { cb(); } catch { /* 忽略 */ }
          }
          try { ctrl.close(); } catch { /* 已关闭 */ }
        }, { once: true });
      }

      // 启动 onStream 回调（异步，不阻塞 start）
      onStream(stream).then(() => {
        stream.close();
      }).catch(() => {
        stream.close();
      });
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
