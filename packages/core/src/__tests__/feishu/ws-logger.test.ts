/**
 * 飞书 WS logger + 状态检测单元测试
 *
 * 关键：SDK 内部通过字符串日志暴露 WS 状态，我们依赖 detectWsStatus 的字符
 * 串匹配——任一字符串改动都可能让我们 silent 失效，这份测试是防线。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  detectWsStatus,
  createFeishuSdkLogger,
  type FeishuWsStatusEvent,
} from '../../channel/adapters/feishu/common/ws-logger.js';

const makeAppLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('detectWsStatus', () => {
  it('识别 ws connect success', () => {
    expect(detectWsStatus(['[ws]', 'ws connect success'])).toEqual({
      kind: 'connect_success',
    });
  });

  it('识别 reconnect success', () => {
    expect(detectWsStatus(['[ws]', 'reconnect success'])).toEqual({
      kind: 'reconnect_success',
    });
  });

  it('识别 ws client ready', () => {
    expect(detectWsStatus(['[ws]', 'ws client ready'])).toEqual({
      kind: 'client_ready',
    });
  });

  it('识别 client closed', () => {
    expect(detectWsStatus(['[ws]', 'client closed'])).toEqual({
      kind: 'client_closed',
    });
  });

  it('识别 ws connect failed', () => {
    const r = detectWsStatus(['[ws]', 'ws connect failed']);
    expect(r?.kind).toBe('connect_failed');
  });

  it('识别 reconnect（不误伤 reconnect success）', () => {
    expect(detectWsStatus(['[ws]', 'reconnect'])).toEqual({ kind: 'reconnecting' });
    // reconnect success 走另一个分支
    expect(detectWsStatus(['[ws]', 'reconnect success'])).toEqual({
      kind: 'reconnect_success',
    });
  });

  it('识别 ws error', () => {
    const r = detectWsStatus(['[ws]', 'ws error']);
    expect(r?.kind).toBe('ws_error');
  });

  it('缺 [ws] 标签直接跳过（避免误伤其他 SDK 日志）', () => {
    expect(detectWsStatus(['[http]', 'connect failed'])).toBeNull();
    expect(detectWsStatus(['random log'])).toBeNull();
  });

  it('未知字符串返回 null（容忍 SDK 版本变化）', () => {
    expect(detectWsStatus(['[ws]', 'some new message'])).toBeNull();
  });
});

describe('createFeishuSdkLogger', () => {
  it('转发 error 日志 + 触发 connect_failed observer', () => {
    const app = makeAppLogger();
    const observed: FeishuWsStatusEvent[] = [];
    const sdkLogger = createFeishuSdkLogger(app, (ev) => observed.push(ev));

    sdkLogger.error(['[ws]', 'ws connect failed']);

    expect(app.error).toHaveBeenCalledWith('[ws] ws connect failed');
    expect(observed).toHaveLength(1);
    expect(observed[0]!.kind).toBe('connect_failed');
  });

  it('转发 info 日志 + 触发 client_ready observer', () => {
    const app = makeAppLogger();
    const observed: FeishuWsStatusEvent[] = [];
    const sdkLogger = createFeishuSdkLogger(app, (ev) => observed.push(ev));

    sdkLogger.info(['[ws]', 'ws client ready']);

    expect(app.info).toHaveBeenCalledWith('[ws] ws client ready');
    expect(observed[0]!.kind).toBe('client_ready');
  });

  it('debug/trace 都走 debug 通道', () => {
    const app = makeAppLogger();
    const sdkLogger = createFeishuSdkLogger(app, () => {});
    sdkLogger.debug(['[ws]', 'heartbeat']);
    sdkLogger.trace(['[ws]', 'frame']);
    expect(app.debug).toHaveBeenCalledTimes(2);
    expect(app.info).not.toHaveBeenCalled();
  });

  it('非 [ws] 日志只转发不触发 observer', () => {
    const app = makeAppLogger();
    const observed: FeishuWsStatusEvent[] = [];
    const sdkLogger = createFeishuSdkLogger(app, (ev) => observed.push(ev));
    sdkLogger.warn(['[http]', 'rate limit']);
    expect(app.warn).toHaveBeenCalledWith('[http] rate limit');
    expect(observed).toHaveLength(0);
  });

  it('observer 抛错不影响日志转发', () => {
    const app = makeAppLogger();
    const sdkLogger = createFeishuSdkLogger(app, () => {
      throw new Error('boom');
    });
    expect(() => sdkLogger.error(['[ws]', 'client closed'])).not.toThrow();
    expect(app.error).toHaveBeenCalled();
  });

  it('非字符串参数（如 Error 对象）能被序列化', () => {
    const app = makeAppLogger();
    const sdkLogger = createFeishuSdkLogger(app, () => {});
    sdkLogger.error(['[ws]', new Error('fail reason')]);
    expect(app.error).toHaveBeenCalledWith(
      expect.stringContaining('fail reason'),
    );
  });
});
