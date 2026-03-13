import { describe, it, expect } from 'vitest';
import { parseExtractionResult } from '../memory/xml-parser.js';

describe('XmlParser — parseExtractionResult', () => {
  it('应该解析包含 memories 和 relations 的有效 XML', () => {
    const xml = `
      <extraction>
        <memory>
          <category>profile</category>
          <merge_type>merge</merge_type>
          <merge_key>user_name</merge_key>
          <l0_index>用户姓名为张三</l0_index>
          <l1_overview>用户的姓名信息</l1_overview>
          <l2_content>用户在对话中提到他的名字是张三，这是一个中文名字。</l2_content>
          <confidence>0.95</confidence>
        </memory>
        <memory>
          <category>preference</category>
          <merge_type>independent</merge_type>
          <l0_index>偏好使用暗色主题</l0_index>
          <l1_overview>用户的界面偏好设置</l1_overview>
          <l2_content>用户表示更喜欢暗色主题（dark mode）来减少眼疲劳。</l2_content>
          <confidence>0.8</confidence>
        </memory>
        <relation>
          <subject>张三</subject>
          <predicate>喜欢</predicate>
          <object>暗色主题</object>
          <confidence>0.85</confidence>
        </relation>
      </extraction>
    `;

    const result = parseExtractionResult(xml);

    expect(result.memories).toHaveLength(2);
    expect(result.relations).toHaveLength(1);

    // 第一条记忆
    expect(result.memories[0].category).toBe('profile');
    expect(result.memories[0].mergeType).toBe('merge');
    expect(result.memories[0].mergeKey).toBe('user_name');
    expect(result.memories[0].l0Index).toBe('用户姓名为张三');
    expect(result.memories[0].confidence).toBe(0.95);

    // 第二条记忆
    expect(result.memories[1].category).toBe('preference');
    expect(result.memories[1].mergeType).toBe('independent');
    expect(result.memories[1].mergeKey).toBeNull(); // independent 类型无 merge_key

    // 关系
    expect(result.relations[0].subject).toBe('张三');
    expect(result.relations[0].predicate).toBe('喜欢');
    expect(result.relations[0].object).toBe('暗色主题');
    expect(result.relations[0].confidence).toBe(0.85);
  });

  it('应该处理 <no_extraction/> 自闭合标签', () => {
    const result = parseExtractionResult('<no_extraction/>');
    expect(result.memories).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('应该处理 <no_extraction> 非自闭合标签', () => {
    const result = parseExtractionResult('<no_extraction>');
    expect(result.memories).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('空输入应返回空结果', () => {
    expect(parseExtractionResult('')).toEqual({ memories: [], relations: [] });
    expect(parseExtractionResult('  ')).toEqual({ memories: [], relations: [] });
  });

  it('无效的 category 应默认为 entity', () => {
    const xml = `
      <extraction>
        <memory>
          <category>unknown_category</category>
          <merge_type>independent</merge_type>
          <l0_index>测试</l0_index>
          <l1_overview>测试概览</l1_overview>
          <l2_content>测试内容</l2_content>
          <confidence>0.5</confidence>
        </memory>
      </extraction>
    `;
    const result = parseExtractionResult(xml);
    expect(result.memories[0].category).toBe('entity');
  });

  it('无效的 merge_type 应默认为 independent', () => {
    const xml = `
      <extraction>
        <memory>
          <category>event</category>
          <merge_type>invalid_type</merge_type>
          <l0_index>测试</l0_index>
          <l1_overview>概览</l1_overview>
          <l2_content>内容</l2_content>
          <confidence>0.5</confidence>
        </memory>
      </extraction>
    `;
    const result = parseExtractionResult(xml);
    expect(result.memories[0].mergeType).toBe('independent');
  });

  it('confidence 超出范围应被钳位到 [0, 1]', () => {
    const xml = `
      <extraction>
        <memory>
          <category>entity</category>
          <merge_type>independent</merge_type>
          <l0_index>高置信度</l0_index>
          <l1_overview>概览</l1_overview>
          <l2_content>内容</l2_content>
          <confidence>1.5</confidence>
        </memory>
        <memory>
          <category>entity</category>
          <merge_type>independent</merge_type>
          <l0_index>低置信度</l0_index>
          <l1_overview>概览</l1_overview>
          <l2_content>内容</l2_content>
          <confidence>-0.3</confidence>
        </memory>
      </extraction>
    `;
    const result = parseExtractionResult(xml);
    expect(result.memories[0].confidence).toBe(1);
    expect(result.memories[1].confidence).toBe(0);
  });

  it('缺少标签时应优雅降级', () => {
    const xml = `
      <extraction>
        <memory>
          <category>skill</category>
          <merge_type>independent</merge_type>
        </memory>
      </extraction>
    `;
    const result = parseExtractionResult(xml);
    expect(result.memories).toHaveLength(1);
    // 缺失的字段应该返回空字符串
    expect(result.memories[0].l0Index).toBe('');
    expect(result.memories[0].l1Overview).toBe('');
    expect(result.memories[0].l2Content).toBe('');
    // confidence 无效时默认 0.5
    expect(result.memories[0].confidence).toBe(0.5);
  });

  it('格式异常的 XML 应尽力解析', () => {
    // 缺少外层 extraction 标签，但有 memory 块
    const xml = `
      <memory>
        <category>event</category>
        <merge_type>independent</merge_type>
        <l0_index>直接嵌入的记忆</l0_index>
        <l1_overview>没有外层标签</l1_overview>
        <l2_content>详细内容</l2_content>
        <confidence>0.7</confidence>
      </memory>
    `;
    const result = parseExtractionResult(xml);
    // 应该能提取到 memory 块
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].l0Index).toBe('直接嵌入的记忆');
  });

  it('independent 类型的 merge_key 应为 null', () => {
    const xml = `
      <extraction>
        <memory>
          <category>pattern</category>
          <merge_type>independent</merge_type>
          <merge_key>some_key_that_should_be_ignored</merge_key>
          <l0_index>测试</l0_index>
          <l1_overview>概览</l1_overview>
          <l2_content>内容</l2_content>
          <confidence>0.6</confidence>
        </memory>
      </extraction>
    `;
    const result = parseExtractionResult(xml);
    // independent 类型不应该有 merge_key
    expect(result.memories[0].mergeKey).toBeNull();
  });

  it('merge 类型的 merge_key 应正常保留', () => {
    const xml = `
      <extraction>
        <memory>
          <category>profile</category>
          <merge_type>merge</merge_type>
          <merge_key>user_email</merge_key>
          <l0_index>用户邮箱</l0_index>
          <l1_overview>概览</l1_overview>
          <l2_content>内容</l2_content>
          <confidence>0.9</confidence>
        </memory>
      </extraction>
    `;
    const result = parseExtractionResult(xml);
    expect(result.memories[0].mergeKey).toBe('user_email');
  });
});
