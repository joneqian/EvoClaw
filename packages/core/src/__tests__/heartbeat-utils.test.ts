import { describe, it, expect } from 'vitest';
import {
  isHeartbeatContentEffectivelyEmpty,
  detectHeartbeatAck,
} from '../scheduler/heartbeat-utils.js';

describe('isHeartbeatContentEffectivelyEmpty', () => {
  it('null/undefined → false（文件不存在，交给 LLM）', () => {
    expect(isHeartbeatContentEffectivelyEmpty(null)).toBe(false);
    expect(isHeartbeatContentEffectivelyEmpty(undefined)).toBe(false);
  });

  it('空字符串 → true', () => {
    expect(isHeartbeatContentEffectivelyEmpty('')).toBe(true);
  });

  it('仅空行 → true', () => {
    expect(isHeartbeatContentEffectivelyEmpty('\n\n\n')).toBe(true);
  });

  it('仅 Markdown 标题 → true', () => {
    expect(isHeartbeatContentEffectivelyEmpty('# Heartbeat\n## Tasks\n')).toBe(true);
  });

  it('仅空列表项 → true', () => {
    expect(isHeartbeatContentEffectivelyEmpty('- \n* \n+ \n')).toBe(true);
  });

  it('空 checkbox 列表项 → true', () => {
    expect(isHeartbeatContentEffectivelyEmpty('- [ ] \n- [x] \n')).toBe(true);
  });

  it('仅 HTML 注释 → true', () => {
    expect(isHeartbeatContentEffectivelyEmpty('<!-- placeholder -->\n')).toBe(true);
  });

  it('标题 + 空列表 + 注释组合 → true', () => {
    const content = `# Heartbeat
## Tasks
- [ ]
<!-- todo: add tasks -->
`;
    expect(isHeartbeatContentEffectivelyEmpty(content)).toBe(true);
  });

  it('有实际文本内容 → false', () => {
    expect(isHeartbeatContentEffectivelyEmpty('# Heartbeat\n每15分钟检查服务器状态')).toBe(false);
  });

  it('有任务内容的 checkbox → false', () => {
    expect(isHeartbeatContentEffectivelyEmpty('- [ ] 检查数据库备份')).toBe(false);
  });
});

describe('detectHeartbeatAck', () => {
  // ─── 空闲确认 ───

  it('null/undefined/空字符串 → isAck', () => {
    expect(detectHeartbeatAck(null).isAck).toBe(true);
    expect(detectHeartbeatAck(undefined).isAck).toBe(true);
    expect(detectHeartbeatAck('').isAck).toBe(true);
    expect(detectHeartbeatAck('  ').isAck).toBe(true);
  });

  it('纯文本 HEARTBEAT_OK → isAck', () => {
    expect(detectHeartbeatAck('HEARTBEAT_OK').isAck).toBe(true);
  });

  it('NO_REPLY → isAck', () => {
    expect(detectHeartbeatAck('NO_REPLY').isAck).toBe(true);
  });

  it('Markdown 包裹 **HEARTBEAT_OK** → isAck', () => {
    expect(detectHeartbeatAck('**HEARTBEAT_OK**').isAck).toBe(true);
  });

  it('Markdown 包裹 `HEARTBEAT_OK` → isAck', () => {
    expect(detectHeartbeatAck('`HEARTBEAT_OK`').isAck).toBe(true);
  });

  it('HTML 包裹 <b>HEARTBEAT_OK</b> → isAck', () => {
    expect(detectHeartbeatAck('<b>HEARTBEAT_OK</b>').isAck).toBe(true);
  });

  it('尾随标点 HEARTBEAT_OK. → isAck', () => {
    expect(detectHeartbeatAck('HEARTBEAT_OK.').isAck).toBe(true);
    expect(detectHeartbeatAck('HEARTBEAT_OK!').isAck).toBe(true);
    expect(detectHeartbeatAck('HEARTBEAT_OK。').isAck).toBe(true);
  });

  it('短附带文本 → isAck（≤ ackMaxChars）', () => {
    expect(detectHeartbeatAck('HEARTBEAT_OK，一切正常').isAck).toBe(true);
    expect(detectHeartbeatAck('HEARTBEAT_OK - all good').isAck).toBe(true);
  });

  // ─── 有效内容 ───

  it('无 token 的实际工作内容 → not isAck', () => {
    const result = detectHeartbeatAck('我已经检查了日程，发现明天有一个会议');
    expect(result.isAck).toBe(false);
    if (!result.isAck) {
      expect(result.text).toContain('会议');
    }
  });

  it('包含 token 但附带超长文本 → not isAck', () => {
    const longText = 'HEARTBEAT_OK，但是发现了以下问题需要注意：' + '详细内容'.repeat(100);
    const result = detectHeartbeatAck(longText, 50);
    expect(result.isAck).toBe(false);
  });

  it('自定义 ackMaxChars 阈值', () => {
    // 用很小的阈值，短附带文本也会被认为是有效内容
    const result = detectHeartbeatAck('HEARTBEAT_OK，一切正常', 2);
    expect(result.isAck).toBe(false);
  });
});
