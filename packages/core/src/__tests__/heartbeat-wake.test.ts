import { describe, it, expect, vi, afterEach } from 'vitest';
import { HeartbeatWakeCoalescer, WakePriority } from '../scheduler/heartbeat-wake.js';

describe('HeartbeatWakeCoalescer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('单次 request 应在合并窗口后触发 onWake', async () => {
    const onWake = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatWakeCoalescer(onWake, 50);

    coalescer.request('wake', WakePriority.ACTION);
    expect(onWake).not.toHaveBeenCalled();

    await new Promise(r => setTimeout(r, 100));
    expect(onWake).toHaveBeenCalledOnce();
    expect(onWake).toHaveBeenCalledWith('wake');

    coalescer.dispose();
  });

  it('窗口内多次 request 应只触发一次', async () => {
    const onWake = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatWakeCoalescer(onWake, 50);

    coalescer.request('interval', WakePriority.INTERVAL);
    coalescer.request('interval', WakePriority.INTERVAL);
    coalescer.request('interval', WakePriority.INTERVAL);

    await new Promise(r => setTimeout(r, 100));
    expect(onWake).toHaveBeenCalledOnce();

    coalescer.dispose();
  });

  it('高优先级应覆盖低优先级', async () => {
    const onWake = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatWakeCoalescer(onWake, 50);

    coalescer.request('interval', WakePriority.INTERVAL);
    coalescer.request('wake', WakePriority.ACTION);

    await new Promise(r => setTimeout(r, 100));
    expect(onWake).toHaveBeenCalledWith('wake');

    coalescer.dispose();
  });

  it('低优先级不应覆盖高优先级', async () => {
    const onWake = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatWakeCoalescer(onWake, 50);

    coalescer.request('wake', WakePriority.ACTION);
    coalescer.request('interval', WakePriority.INTERVAL); // 应被忽略

    await new Promise(r => setTimeout(r, 100));
    expect(onWake).toHaveBeenCalledWith('wake');

    coalescer.dispose();
  });

  it('dispose 应取消待执行的请求', async () => {
    const onWake = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatWakeCoalescer(onWake, 50);

    coalescer.request('wake', WakePriority.ACTION);
    coalescer.dispose();

    await new Promise(r => setTimeout(r, 100));
    expect(onWake).not.toHaveBeenCalled();
  });

  it('dispose 后再次 request 不应报错', () => {
    const onWake = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatWakeCoalescer(onWake, 50);

    coalescer.dispose();
    coalescer.dispose(); // 幂等
    expect(onWake).not.toHaveBeenCalled();
  });
});
