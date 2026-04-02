/**
 * JSON Schema 输入验证器
 *
 * 统一验证工具输入参数，替代各工具内部的手动 if 检查。
 * 轻量实现（不依赖 ajv/zod），仅验证 required + type。
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 验证输入参数是否符合 JSON Schema
 *
 * 仅验证:
 * - required 字段是否存在
 * - 基础类型检查 (string/number/boolean/object/array)
 *
 * 不验证:
 * - pattern, minLength, minimum 等约束（留给工具内部处理）
 */
export function validateInput(
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  // 1. required 字段检查
  if (required) {
    for (const field of required) {
      if (input[field] === undefined || input[field] === null) {
        errors.push(`缺少必需参数: ${field}`);
      }
    }
  }

  // 2. 基础类型检查
  if (properties) {
    for (const [field, fieldSchema] of Object.entries(properties)) {
      const value = input[field];
      if (value === undefined || value === null) continue; // 非 required 字段可缺失

      const expectedType = fieldSchema.type as string | undefined;
      if (!expectedType) continue;

      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (expectedType === 'integer' || expectedType === 'number') {
        if (typeof value !== 'number') {
          errors.push(`参数 ${field} 应为 ${expectedType}，实际为 ${actualType}`);
        }
      } else if (expectedType !== actualType) {
        errors.push(`参数 ${field} 应为 ${expectedType}，实际为 ${actualType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
