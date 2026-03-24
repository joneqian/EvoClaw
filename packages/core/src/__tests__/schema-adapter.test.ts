import { describe, it, expect } from 'vitest';
import { normalizeToolSchema } from '../agent/schema-adapter.js';

describe('normalizeToolSchema', () => {
  const sampleSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        pattern: '^[a-z]+$',
        format: 'email',
      },
      age: {
        type: 'number',
        minimum: 0,
        maximum: 150,
        multipleOf: 1,
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
      },
    },
    required: ['name'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
    examples: [{ name: 'test' }],
  };

  it('Anthropic: 保持 schema 不变', () => {
    const result = normalizeToolSchema(sampleSchema, 'anthropic');
    expect(result).toEqual(sampleSchema);
  });

  it('OpenAI: 确保顶层有 type: "object"', () => {
    const noType = { properties: { a: { type: 'string' } } };
    const result = normalizeToolSchema(noType, 'openai');
    expect(result.type).toBe('object');
    expect(result.properties).toEqual(noType.properties);
  });

  it('OpenAI: 不覆盖已有的 type', () => {
    const withType = { type: 'object', properties: {} };
    const result = normalizeToolSchema(withType, 'openai');
    expect(result.type).toBe('object');
  });

  it('openai-completions: 同 OpenAI 处理', () => {
    const noType = { properties: { a: { type: 'string' } } };
    const result = normalizeToolSchema(noType, 'openai-completions');
    expect(result.type).toBe('object');
  });

  it('Google: 剥离不支持的关键字', () => {
    const result = normalizeToolSchema(sampleSchema, 'google');

    // 顶层
    expect(result).not.toHaveProperty('$schema');
    expect(result).not.toHaveProperty('additionalProperties');
    expect(result).not.toHaveProperty('examples');

    // 嵌套
    const nameSchema = (result.properties as any).name;
    expect(nameSchema).not.toHaveProperty('minLength');
    expect(nameSchema).not.toHaveProperty('maxLength');
    expect(nameSchema).not.toHaveProperty('pattern');
    expect(nameSchema).not.toHaveProperty('format');
    expect(nameSchema).toHaveProperty('type', 'string');

    const ageSchema = (result.properties as any).age;
    expect(ageSchema).not.toHaveProperty('minimum');
    expect(ageSchema).not.toHaveProperty('maximum');
    expect(ageSchema).not.toHaveProperty('multipleOf');

    const tagsSchema = (result.properties as any).tags;
    expect(tagsSchema).not.toHaveProperty('minItems');
    expect(tagsSchema).not.toHaveProperty('maxItems');
    expect(tagsSchema).not.toHaveProperty('uniqueItems');

    // 保留的关键字
    expect(result).toHaveProperty('type', 'object');
    expect(result).toHaveProperty('required');
  });

  it('google-generative-ai: 同 Google 处理', () => {
    const result = normalizeToolSchema(sampleSchema, 'google-generative-ai');
    expect(result).not.toHaveProperty('$schema');
  });

  it('xAI: 剥离约束关键字但保留结构关键字', () => {
    const result = normalizeToolSchema(sampleSchema, 'xai');

    const nameSchema = (result.properties as any).name;
    expect(nameSchema).not.toHaveProperty('minLength');
    expect(nameSchema).not.toHaveProperty('maxLength');
    expect(nameSchema).not.toHaveProperty('pattern');
    expect(nameSchema).not.toHaveProperty('format');

    // xAI 保留 additionalProperties 和 $schema
    expect(result).toHaveProperty('additionalProperties');
    expect(result).toHaveProperty('$schema');
  });

  it('未知 provider: 保持 schema 不变', () => {
    const result = normalizeToolSchema(sampleSchema, 'some-unknown-provider');
    expect(result).toEqual(sampleSchema);
  });

  it('处理 null 和原始值', () => {
    const schema = {
      type: 'object',
      properties: {
        val: null,
        num: 42,
        str: 'hello',
      },
    };
    const result = normalizeToolSchema(schema as any, 'google');
    expect((result.properties as any).val).toBeNull();
    expect((result.properties as any).num).toBe(42);
  });

  it('处理数组中的嵌套对象', () => {
    const schema = {
      oneOf: [
        { type: 'string', minLength: 1 },
        { type: 'number', minimum: 0 },
      ],
    };
    const result = normalizeToolSchema(schema, 'google');
    const oneOf = result.oneOf as any[];
    expect(oneOf[0]).not.toHaveProperty('minLength');
    expect(oneOf[1]).not.toHaveProperty('minimum');
  });
});
