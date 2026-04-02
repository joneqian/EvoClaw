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
});
