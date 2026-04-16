/**
 * Skill 参数替换测试
 */

import { describe, it, expect } from 'vitest';
import { substituteArguments } from '../skill/skill-arguments.js';

describe('substituteArguments', () => {
  it('$ARGUMENTS 替换为完整参数', () => {
    expect(substituteArguments('搜索 $ARGUMENTS 的信息', '人工智能'))
      .toBe('搜索 人工智能 的信息');
  });

  it('$0 $1 按索引替换', () => {
    expect(substituteArguments('比较 $0 和 $1', 'React Vue'))
      .toBe('比较 React 和 Vue');
  });

  it('$ARGUMENTS[0] 按索引替换', () => {
    expect(substituteArguments('文件 $ARGUMENTS[0] 格式 $ARGUMENTS[1]', 'api.ts json'))
      .toBe('文件 api.ts 格式 json');
  });

  it('引号包裹的参数保留空格', () => {
    expect(substituteArguments('$0 说 $1', 'Alice "hello world"'))
      .toBe('Alice 说 hello world');
  });

  it('空参数不替换', () => {
    expect(substituteArguments('搜索 $ARGUMENTS', ''))
      .toBe('搜索 $ARGUMENTS');
  });

  it('超出索引范围返回空字符串', () => {
    expect(substituteArguments('$0 和 $1 和 $2', 'only-one'))
      .toBe('only-one 和  和 ');
  });

  it('多个 $ARGUMENTS 全部替换', () => {
    expect(substituteArguments('$ARGUMENTS is $ARGUMENTS', 'test'))
      .toBe('test is test');
  });

  it('混合使用 $ARGUMENTS 和 $N', () => {
    expect(substituteArguments('全部: $ARGUMENTS, 第一个: $0', 'a b c'))
      .toBe('全部: a b c, 第一个: a');
  });

  // G3: 命名参数替换
  describe('G3: 命名参数（${name}）', () => {
    it('kv 风格参数替换 ${name} 占位符', () => {
      expect(substituteArguments('生成 ${month} 月第 ${week} 周的日报', 'month=4 week=1'))
        .toBe('生成 4 月第 1 周的日报');
    });

    it('位置参数 + argumentNames 映射到 ${name}', () => {
      expect(substituteArguments(
        '生成 ${month} 月第 ${week} 周的日报',
        '4 1',
        ['month', 'week'],
      )).toBe('生成 4 月第 1 周的日报');
    });

    it('未声明 argumentNames 时 ${name} 保持不变', () => {
      expect(substituteArguments('生成 ${month} 月', '4'))
        .toBe('生成 ${month} 月');
    });

    it('${name} 占位符找不到命名参数时保持不变', () => {
      expect(substituteArguments(
        '生成 ${month} 月第 ${unknown} 周',
        'month=4',
      )).toBe('生成 4 月第 ${unknown} 周');
    });

    it('kv 参数与位置参数混用', () => {
      const result = substituteArguments(
        '文件 $0 月份 ${month}',
        'report.md month=4',
        ['file'],
      );
      // 有 kv 参数时，argumentNames 位置映射不启用（避免混淆）
      // $0 仍指向第一个位置参数 "report.md"，${month} 来自 kv
      expect(result).toBe('文件 report.md 月份 4');
    });

    it('kv value 带等号能正常解析（取第一个等号）', () => {
      expect(substituteArguments('查询 ${query}', 'query=a=b=c'))
        .toBe('查询 a=b=c');
    });

    it('命名参数优先于 argumentNames 位置映射', () => {
      // 同时传 kv 和位置，有 kv 就禁用位置映射
      expect(substituteArguments(
        'month=${month} week=${week}',
        'month=5 1',
        ['month', 'week'],
      )).toBe('month=5 week=${week}');
    });

    it('引号包裹的带空格 kv 值', () => {
      expect(substituteArguments(
        '标题：${title}',
        '"title=Hello World"',
      )).toBe('标题：Hello World');
    });

    it('合法标识符外的 ${...} 不替换（避免误伤 shell 语法）', () => {
      // ${VAR:-default} 这种 shell 风格不是合法标识符，应保持不变
      expect(substituteArguments(
        'echo ${VAR:-default} ${name}',
        'name=foo',
      )).toBe('echo ${VAR:-default} foo');
    });
  });
});
