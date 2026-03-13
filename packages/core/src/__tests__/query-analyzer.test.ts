import { describe, it, expect } from 'vitest';
import { analyzeQuery } from '../memory/query-analyzer.js';

describe('QueryAnalyzer', () => {
  // ---------- 关键词提取（过滤停用词） ----------

  it('analyzeQuery 应提取关键词并过滤停用词', () => {
    // 分词基于空格分割，中英文混合需要空格分隔
    const result = analyzeQuery('我 喜欢 使用 TypeScript 开发');
    // 'TypeScript'（转小写）和非停用词应保留
    expect(result.keywords).toContain('typescript');
    expect(result.keywords).toContain('喜欢');
    expect(result.keywords).toContain('开发');
    // 停用词 '我'、'使用' 应被过滤
    expect(result.keywords).not.toContain('我');
  });

  // ---------- CJK 关键词保留 ----------

  it('analyzeQuery 应保留中日韩关键词', () => {
    const result = analyzeQuery('机器学习 深度学习 模型训练');
    expect(result.keywords).toContain('机器学习');
    expect(result.keywords).toContain('深度学习');
    expect(result.keywords).toContain('模型训练');
  });

  // ---------- 时间范围：上周 ----------

  it('analyzeQuery 对"上周"应返回正确的周范围', () => {
    const result = analyzeQuery('上周讨论了什么');
    expect(result.dateRange).not.toBeNull();
    expect(result.dateRange!.start).toBeDefined();
    expect(result.dateRange!.end).toBeDefined();

    // 验证时间格式 YYYY-MM-DD
    expect(result.dateRange!.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.dateRange!.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 上周 start 应在 end 之前或相同
    expect(result.dateRange!.start! <= result.dateRange!.end!).toBe(true);

    // start 和 end 应相差 6 天（完整一周）
    const start = new Date(result.dateRange!.start!);
    const end = new Date(result.dateRange!.end!);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(6);
  });

  // ---------- 时间范围：昨天 ----------

  it('analyzeQuery 对"昨天"应返回昨天的日期', () => {
    const result = analyzeQuery('昨天发生了什么事');
    expect(result.dateRange).not.toBeNull();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const expectedDate = yesterday.toISOString().slice(0, 10);

    expect(result.dateRange!.start).toBe(expectedDate);
    expect(result.dateRange!.end).toBe(expectedDate);
  });

  // ---------- 时间范围：最近7天 ----------

  it('analyzeQuery 对"最近7天"应返回 7 天的范围', () => {
    const result = analyzeQuery('最近7天的学习记录');
    expect(result.dateRange).not.toBeNull();

    const now = new Date();
    const expectedEnd = now.toISOString().slice(0, 10);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    const expectedStart = start.toISOString().slice(0, 10);

    expect(result.dateRange!.start).toBe(expectedStart);
    expect(result.dateRange!.end).toBe(expectedEnd);
  });

  // ---------- 无时间范围的通用查询 ----------

  it('analyzeQuery 对通用查询不应返回时间范围', () => {
    const result = analyzeQuery('TypeScript 最佳实践');
    expect(result.dateRange).toBeNull();
  });

  // ---------- 查询类型分类 ----------

  it('analyzeQuery 应正确分类偏好类查询', () => {
    expect(analyzeQuery('用户喜欢什么编辑器').queryType).toBe('preference');
    expect(analyzeQuery('coding style 偏好').queryType).toBe('preference');
  });

  it('analyzeQuery 应正确分类时间类查询', () => {
    expect(analyzeQuery('上次讨论的内容').queryType).toBe('temporal');
    expect(analyzeQuery('最近的对话记录').queryType).toBe('temporal');
  });

  it('analyzeQuery 应正确分类技能/方法类查询', () => {
    expect(analyzeQuery('怎么配置 TypeScript').queryType).toBe('skill');
    expect(analyzeQuery('如何部署应用').queryType).toBe('skill');
  });

  it('analyzeQuery 应正确分类事实类查询', () => {
    expect(analyzeQuery('React 是什么').queryType).toBe('factual');
    expect(analyzeQuery('谁创建了这个项目').queryType).toBe('factual');
  });

  it('analyzeQuery 对无明确信号的查询应归类为 general', () => {
    expect(analyzeQuery('TypeScript 泛型').queryType).toBe('general');
  });

  // ---------- 详细内容检测 ----------

  it('analyzeQuery 检测到"详细"时 needsDetail 应为 true', () => {
    expect(analyzeQuery('详细介绍一下 React Hooks').needsDetail).toBe(true);
    expect(analyzeQuery('请给出完整说明').needsDetail).toBe(true);
    expect(analyzeQuery('give me the full detail').needsDetail).toBe(true);
  });

  it('analyzeQuery 普通查询 needsDetail 应为 false', () => {
    expect(analyzeQuery('React Hooks 是什么').needsDetail).toBe(false);
  });
});
