/**
 * BootstrapState 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BootstrapState } from '../../infrastructure/bootstrap-state.js';

describe('BootstrapState', () => {
  let state: BootstrapState;

  beforeEach(() => {
    state = new BootstrapState();
  });

  it('初始状态应为 pending', () => {
    expect(state.phase).toBe('pending');
    expect(state.isReady()).toBe(false);
  });

  it('应正确追踪阶段变迁', () => {
    state.transition('initializing');
    expect(state.phase).toBe('initializing');

    state.transition('ready');
    expect(state.phase).toBe('ready');
    expect(state.isReady()).toBe(true);
  });

  it('应存储和检索组件引用', () => {
    const mockDb = { close: () => {} };
    state.set('db', mockDb);
    expect(state.get('db')).toBe(mockDb);
  });

  it('get 不存在的 key 应返回 undefined', () => {
    expect(state.get('nonexistent')).toBeUndefined();
  });

  it('应记录端口和 token', () => {
    state.setServerInfo(12345, 'abc123');
    expect(state.port).toBe(12345);
    expect(state.token).toBe('abc123');
  });

  it('error 阶段应记录错误信息', () => {
    state.transition('error', '数据库初始化失败');
    expect(state.phase).toBe('error');
    expect(state.errorMessage).toBe('数据库初始化失败');
  });

  it('getSnapshot 应返回当前状态快照', () => {
    state.transition('ready');
    state.setServerInfo(9999, 'tok');
    const snap = state.getSnapshot();
    expect(snap.phase).toBe('ready');
    expect(snap.port).toBe(9999);
    expect(snap.components).toBeDefined();
    expect(snap.readyAt).toBeTruthy();
  });

  it('pending 状态的 readyAt 应为 null', () => {
    const snap = state.getSnapshot();
    expect(snap.readyAt).toBeNull();
  });
});
