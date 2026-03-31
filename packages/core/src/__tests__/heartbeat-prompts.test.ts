import { describe, it, expect } from 'vitest';
import { buildHeartbeatPrompt, HEARTBEAT_TOKEN } from '../scheduler/heartbeat-prompts.js';

describe('buildHeartbeatPrompt', () => {
  const currentTime = '2026-03-31T10:00:00.000Z';

  // ─── interval/wake ───

  it('interval 应生成标准 heartbeat prompt', () => {
    const prompt = buildHeartbeatPrompt({ reason: 'interval', currentTime });
    expect(prompt).toContain('[Heartbeat]');
    expect(prompt).toContain(currentTime);
    expect(prompt).toContain('HEARTBEAT.md');
    expect(prompt).toContain(HEARTBEAT_TOKEN);
  });

  it('wake 应生成与 interval 相同的 prompt', () => {
    const interval = buildHeartbeatPrompt({ reason: 'interval', currentTime });
    const wake = buildHeartbeatPrompt({ reason: 'wake', currentTime });
    expect(wake).toBe(interval);
  });

  it('自定义 prompt 应覆盖默认 prompt', () => {
    const custom = '检查所有服务器状态并报告';
    const prompt = buildHeartbeatPrompt({
      reason: 'interval',
      currentTime,
      customPrompt: custom,
    });
    expect(prompt).toContain(custom);
    expect(prompt).toContain('[Heartbeat]');
    expect(prompt).not.toContain('HEARTBEAT.md');
  });

  it('空自定义 prompt 应回退默认', () => {
    const prompt = buildHeartbeatPrompt({
      reason: 'interval',
      currentTime,
      customPrompt: '   ',
    });
    expect(prompt).toContain('HEARTBEAT.md');
  });

  // ─── cron-event ───

  it('cron-event + 有内容 + deliverToUser=true 应生成投递 prompt', () => {
    const prompt = buildHeartbeatPrompt({
      reason: 'cron-event',
      currentTime,
      cronEventTexts: ['Daily standup reminder'],
      deliverToUser: true,
    });
    expect(prompt).toContain('scheduled reminder');
    expect(prompt).toContain('Daily standup reminder');
    expect(prompt).toContain('relay this reminder to the user');
  });

  it('cron-event + 有内容 + deliverToUser=false 应生成内部处理 prompt', () => {
    const prompt = buildHeartbeatPrompt({
      reason: 'cron-event',
      currentTime,
      cronEventTexts: ['Cleanup cache'],
      deliverToUser: false,
    });
    expect(prompt).toContain('Handle this reminder internally');
    expect(prompt).toContain('Do not relay');
  });

  it('cron-event + 空内容 应回退到 HEARTBEAT_OK', () => {
    const prompt = buildHeartbeatPrompt({
      reason: 'cron-event',
      currentTime,
      cronEventTexts: [],
      deliverToUser: true,
    });
    expect(prompt).toContain('no event content was found');
    expect(prompt).toContain(HEARTBEAT_TOKEN);
  });

  it('cron-event + 多条事件 应拼接', () => {
    const prompt = buildHeartbeatPrompt({
      reason: 'cron-event',
      currentTime,
      cronEventTexts: ['Event A', 'Event B'],
      deliverToUser: true,
    });
    expect(prompt).toContain('Event A');
    expect(prompt).toContain('Event B');
  });

  // ─── exec-event ───

  it('exec-event + deliverToUser=true 应生成用户投递 prompt', () => {
    const prompt = buildHeartbeatPrompt({
      reason: 'exec-event',
      currentTime,
      deliverToUser: true,
    });
    expect(prompt).toContain('async command');
    expect(prompt).toContain('relay the command output to the user');
  });

  it('exec-event + deliverToUser=false 应生成内部处理 prompt', () => {
    const prompt = buildHeartbeatPrompt({
      reason: 'exec-event',
      currentTime,
      deliverToUser: false,
    });
    expect(prompt).toContain('Handle the result internally');
  });
});
