import { describe, it, expect } from 'vitest';

// 直接测试 computeStalenessTag 逻辑（从 memory-recall.ts 导出的私有函数逻辑复制）
function computeStalenessTag(updatedAt: string): string {
  const daysSince = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > 7) {
    return ` [⚠ 较旧: ${Math.floor(daysSince)}天前，建议验证]`;
  }
  if (daysSince > 1) {
    return ` [⚠ ${Math.floor(daysSince)}天前]`;
  }
  return '';
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

describe('记忆新鲜度警告', () => {
  it('0天内的记忆无警告', () => {
    const tag = computeStalenessTag(new Date().toISOString());
    expect(tag).toBe('');
  });

  it('几小时前的记忆无警告', () => {
    const d = new Date();
    d.setHours(d.getHours() - 12);
    const tag = computeStalenessTag(d.toISOString());
    expect(tag).toBe('');
  });

  it('2天前的记忆带天数标记', () => {
    const tag = computeStalenessTag(daysAgo(2));
    expect(tag).toContain('⚠');
    expect(tag).toContain('2天前');
    expect(tag).not.toContain('建议验证');
  });

  it('5天前的记忆带天数标记', () => {
    const tag = computeStalenessTag(daysAgo(5));
    expect(tag).toContain('5天前');
    expect(tag).not.toContain('建议验证');
  });

  it('8天前的记忆带较旧警告', () => {
    const tag = computeStalenessTag(daysAgo(8));
    expect(tag).toContain('较旧');
    expect(tag).toContain('8天前');
    expect(tag).toContain('建议验证');
  });

  it('30天前的记忆带较旧警告', () => {
    const tag = computeStalenessTag(daysAgo(30));
    expect(tag).toContain('较旧');
    expect(tag).toContain('30天前');
    expect(tag).toContain('建议验证');
  });

  it('恰好1天的边界值无警告', () => {
    // 恰好 1 天 = daysSince ≈ 1.0，不 > 1
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(d.getHours() + 1); // 略小于 1 天
    const tag = computeStalenessTag(d.toISOString());
    expect(tag).toBe('');
  });

  it('恰好7天的边界值不显示较旧', () => {
    // 恰好 7 天但不超过
    const d = new Date();
    d.setDate(d.getDate() - 7);
    d.setHours(d.getHours() + 1); // 略小于 7 天
    const tag = computeStalenessTag(d.toISOString());
    expect(tag).toContain('⚠');
    expect(tag).not.toContain('较旧');
  });
});
