import type { RuntimeEvent } from '../agent/types.js';

/** 将 RuntimeEvent 格式化为 SSE data 行 */
export function formatSSE(event: RuntimeEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** 创建 SSE 可读流 */
export function createSSEStream(): {
  readable: ReadableStream;
  push: (event: RuntimeEvent) => void;
  close: () => void;
} {
  let controller: ReadableStreamDefaultController | null = null;
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    start(c) {
      controller = c;
    },
    cancel() {
      controller = null;
    },
  });

  return {
    readable,
    push(event: RuntimeEvent) {
      if (controller) {
        controller.enqueue(encoder.encode(formatSSE(event)));
      }
    },
    close() {
      if (controller) {
        controller.close();
        controller = null;
      }
    },
  };
}
