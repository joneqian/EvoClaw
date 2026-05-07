/**
 * 微信 / 企微出站重试测试
 *
 * 覆盖 PR B：filling 微信 / 企微 channel 的限流自动退避
 */

import { describe, it, expect, vi } from 'vitest';
import {
  WeixinApiError,
  isRetryableWeixinError,
  withWeixinRetry,
} from '../channel/adapters/weixin-retry.js';
import {
  WecomApiError,
  isRetryableWecomError,
  withWecomRetry,
} from '../channel/adapters/wecom-retry.js';

// ─── 微信 isRetryableWeixinError ─────────────────────────────────────────

describe('isRetryableWeixinError', () => {
  it('WeixinApiError ret=-1 视为可重试', () => {
    expect(isRetryableWeixinError(new WeixinApiError('sendMessage', -1, '系统异常'))).toBe(true);
  });

  it('WeixinApiError 其他 ret 不重试', () => {
    expect(isRetryableWeixinError(new WeixinApiError('sendMessage', 1001, 'auth fail'))).toBe(false);
    expect(isRetryableWeixinError(new WeixinApiError('sendMessage', 1002, 'param invalid'))).toBe(false);
  });

  it('历史 plain Error "ret=-1 ..."（旧 throw 残留）兜底解析', () => {
    expect(isRetryableWeixinError(new Error('iLink sendMessage 失败: ret=-1 系统异常'))).toBe(true);
    expect(isRetryableWeixinError(new Error('iLink sendMessage 失败: ret=1001 auth'))).toBe(false);
  });

  it('网络瞬态错（ECONNRESET）视为可重试', () => {
    const err = new Error('socket hang up');
    (err as unknown as Record<string, unknown>).code = 'ECONNRESET';
    expect(isRetryableWeixinError(err)).toBe(true);
  });

  it('HTTP 5xx 视为可重试', () => {
    const err = new Error('Bad Gateway');
    (err as unknown as Record<string, unknown>).status = 502;
    expect(isRetryableWeixinError(err)).toBe(true);
  });

  it('HTTP 4xx 不视为可重试', () => {
    const err = new Error('Bad Request');
    (err as unknown as Record<string, unknown>).status = 400;
    expect(isRetryableWeixinError(err)).toBe(false);
  });

  it('普通 Error（无可重试线索）不重试', () => {
    expect(isRetryableWeixinError(new Error('某种业务异常'))).toBe(false);
  });

  it('非 Error 输入不重试', () => {
    expect(isRetryableWeixinError('string')).toBe(false);
    expect(isRetryableWeixinError(null)).toBe(false);
    expect(isRetryableWeixinError(undefined)).toBe(false);
  });
});

// ─── withWeixinRetry 流程 ────────────────────────────────────────────────

describe('withWeixinRetry 流程', () => {
  it('首次成功直接返回，不重试', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withWeixinRetry(fn, { sleep: () => Promise.resolve() });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });

  it('遇可重试错重试 3 次后成功', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new WeixinApiError('sendMessage', -1, '系统异常');
      return 'ok-on-3';
    });
    const result = await withWeixinRetry(fn, { sleep: () => Promise.resolve() });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result).toBe('ok-on-3');
  });

  it('遇不可重试错立刻抛', async () => {
    const fn = vi.fn().mockRejectedValue(new WeixinApiError('sendMessage', 9999, 'auth fail'));
    await expect(
      withWeixinRetry(fn, { sleep: () => Promise.resolve() }),
    ).rejects.toBeInstanceOf(WeixinApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('3 次都失败时抛最后一次的错', async () => {
    const fn = vi.fn().mockRejectedValue(new WeixinApiError('sendMessage', -1, '系统异常'));
    await expect(
      withWeixinRetry(fn, { sleep: () => Promise.resolve() }),
    ).rejects.toBeInstanceOf(WeixinApiError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('注入 sleep 验证退避被调用', async () => {
    const sleepCalls: number[] = [];
    const fn = vi.fn().mockRejectedValue(new WeixinApiError('sendMessage', -1, ''));
    await expect(
      withWeixinRetry(fn, {
        sleep: (ms) => {
          sleepCalls.push(ms);
          return Promise.resolve();
        },
        random: () => 0.5, // 固定 jitter 让延迟可预测
      }),
    ).rejects.toBeDefined();
    // 重试 2 次（首次失败 + 2 次重试，最后一次不退避直接抛）
    expect(sleepCalls).toHaveLength(2);
    expect(sleepCalls[0]).toBeGreaterThan(0);
    expect(sleepCalls[1]).toBeGreaterThan(sleepCalls[0]!); // 指数增长
  });
});

// ─── 企微 isRetryableWecomError ──────────────────────────────────────────

describe('isRetryableWecomError', () => {
  it('errcode=45033（接口频率过快）视为可重试', () => {
    expect(isRetryableWecomError(new WecomApiError('send', 45033, 'too fast'))).toBe(true);
  });

  it('errcode=45009（接口次数超限）视为可重试', () => {
    expect(isRetryableWecomError(new WecomApiError('send', 45009, 'quota'))).toBe(true);
  });

  it('errcode=-1（系统繁忙）视为可重试', () => {
    expect(isRetryableWecomError(new WecomApiError('send', -1, 'busy'))).toBe(true);
  });

  it('errcode=40014（access_token 失效）不重试（应让上层 refresh）', () => {
    expect(isRetryableWecomError(new WecomApiError('send', 40014, 'token invalid'))).toBe(false);
  });

  it('历史 plain Error errcode 字段兜底解析', () => {
    expect(isRetryableWecomError(new Error('企微发送失败: errcode=45033 too fast'))).toBe(true);
    expect(isRetryableWecomError(new Error('企微发送失败: errcode=40014 invalid'))).toBe(false);
  });

  it('网络瞬态错视为可重试', () => {
    const err = new Error('connection reset');
    (err as unknown as Record<string, unknown>).code = 'ECONNRESET';
    expect(isRetryableWecomError(err)).toBe(true);
  });

  it('HTTP 4xx 不视为可重试', () => {
    const err = new Error('Forbidden');
    (err as unknown as Record<string, unknown>).status = 403;
    expect(isRetryableWecomError(err)).toBe(false);
  });
});

// ─── withWecomRetry 流程 ─────────────────────────────────────────────────

describe('withWecomRetry 流程', () => {
  it('遇 errcode=45033 重试后成功', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new WecomApiError('sendMessage', 45033, 'rate limit');
      return 'ok';
    });
    const result = await withWecomRetry(fn, { sleep: () => Promise.resolve() });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe('ok');
  });

  it('遇 errcode=40014 立刻抛（不重试）', async () => {
    const fn = vi.fn().mockRejectedValue(new WecomApiError('sendMessage', 40014, 'invalid token'));
    await expect(
      withWecomRetry(fn, { sleep: () => Promise.resolve() }),
    ).rejects.toBeInstanceOf(WecomApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('3 次限流都失败时抛最后一次错', async () => {
    const fn = vi.fn().mockRejectedValue(new WecomApiError('sendMessage', 45033, 'rate limit'));
    await expect(
      withWecomRetry(fn, { sleep: () => Promise.resolve() }),
    ).rejects.toBeInstanceOf(WecomApiError);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ─── 错误类型 ────────────────────────────────────────────────────────────

describe('WeixinApiError / WecomApiError', () => {
  it('WeixinApiError 保留 ret + errmsg 字段', () => {
    const err = new WeixinApiError('sendMessage', -1, '系统异常');
    expect(err.ret).toBe(-1);
    expect(err.errmsg).toBe('系统异常');
    expect(err.action).toBe('sendMessage');
    expect(err.message).toBe('iLink sendMessage 失败: ret=-1 系统异常');
    expect(err.name).toBe('WeixinApiError');
    expect(err).toBeInstanceOf(Error);
  });

  it('WecomApiError 保留 errcode + errmsg 字段', () => {
    const err = new WecomApiError('sendMessage', 45033, 'rate limit');
    expect(err.errcode).toBe(45033);
    expect(err.errmsg).toBe('rate limit');
    expect(err.action).toBe('sendMessage');
    expect(err.message).toBe('企微sendMessage失败: errcode=45033 rate limit');
    expect(err.name).toBe('WecomApiError');
    expect(err).toBeInstanceOf(Error);
  });
});
