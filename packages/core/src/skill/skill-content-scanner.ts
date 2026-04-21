/**
 * SKILL.md 内容安全扫描器 — M7 Phase 1
 *
 * Agent 通过 skill_manage 工具创建/修改 Skill 时，写入磁盘前调用本模块：
 * 1. Frontmatter Zod 校验（name/description 必填，name 规范化）
 * 2. 内容危险模式扫描（复用 skill-analyzer.ts DANGER_PATTERNS）
 * 3. 凭据泄漏扫描（key=value 形式的 secret / token / API key）
 *
 * FAIL-CLOSED：任一项命中 high 风险 → 返回 riskLevel='high'，调用方应拒绝写入。
 */

import type { SkillSecurityFinding, SkillSecurityReport } from '@evoclaw/shared';
import { z } from 'zod';
import { parseSkillMd } from './skill-parser.js';
import { scanSkillMdContent } from './skill-analyzer.js';

/** 合法的 Skill 名称：2-64 字符，小写字母、数字、连字符 */
export const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Frontmatter 最小集 Zod schema — 仅校验必填字段，其他字段由 parseSkillMd 处理 */
const SkillFrontmatterSchema = z.object({
  name: z.string().regex(SKILL_NAME_REGEX, '技能名必须是 2-64 位小写字母、数字或连字符，且以字母/数字开头'),
  description: z.string().min(1, '技能描述不能为空').max(1000, '技能描述最长 1000 字符'),
});

/**
 * 敏感赋值扫描模式
 *
 * 覆盖常见形式：
 * - KEY=value / KEY="value"
 * - key: value（YAML 风格）
 * - "key": "value"（JSON 风格）
 *
 * 只在 value 非空白且非占位符（如 <...>, {{...}}, ...）时命中，减少误报。
 */
const SENSITIVE_KEY_NAMES = [
  'api_key', 'apikey',
  'secret', 'secret_key', 'secretkey',
  'token', 'access_token', 'accesstoken', 'refresh_token', 'refreshtoken',
  'password', 'passwd', 'pwd',
  'authorization', 'auth_token',
  'private_key', 'privatekey',
];

const PLACEHOLDER_PATTERNS = [
  /^\s*$/,
  /^<[^>]*/,             // <your-api-key...（前缀匹配）
  /^\{\{/,               // {{API_KEY}}（前缀匹配，容忍正则截断）
  /^\$\{/,               // ${API_KEY}（前缀匹配）
  /^\$\(/,               // $(API_KEY) shell 替换
  /^\.{3,}$/,            // ...
  /^xxx+$/i,             // xxxx（至少 3 个）
  /^example/i,
  /^placeholder/i,
  /^your[_-]?(key|token|secret|api)/i,
];

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim().replace(/^["']|["']$/g, '').trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

function scanCredentials(content: string, filename: string): SkillSecurityFinding[] {
  const findings: SkillSecurityFinding[] = [];
  const lines = content.split('\n');
  const keyAlternation = SENSITIVE_KEY_NAMES.map(k => k.replace(/_/g, '[_-]?')).join('|');
  // 匹配 KEY=value / KEY: value / "KEY": "value"
  const pattern = new RegExp(
    `(?:^|[\\s"\`])(${keyAlternation})\\s*[:=]\\s*([^\\s,}\\]]+)`,
    'i',
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = pattern.exec(line);
    if (!match) continue;
    const rawValue = match[2];
    if (isPlaceholder(rawValue)) continue;
    findings.push({
      type: 'env_access',  // 复用现有枚举；凭据值泄漏归为 env_access 类别
      file: filename,
      line: i + 1,
      snippet: line.trim().slice(0, 120),
      severity: 'high',
    });
  }

  return findings;
}

/** 扫描结果 */
export interface SkillContentScanResult {
  /** 是否通过（riskLevel !== 'high' && frontmatter 有效） */
  ok: boolean;
  /** 风险等级 */
  riskLevel: SkillSecurityReport['riskLevel'];
  /** 所有发现项 */
  findings: SkillSecurityFinding[];
  /** frontmatter 校验错误（若有） */
  frontmatterError?: string;
  /** 解析出的 Skill 名（用于写入路径） */
  parsedName?: string;
  /** 解析出的 Skill 描述 */
  parsedDescription?: string;
}

/**
 * 扫描 SKILL.md 内容（未落盘）。
 *
 * @param content SKILL.md 完整内容（含 frontmatter + body）
 * @param expectedName 若调用方已指定 name（如从 skill_manage 的 name 参数），校验 frontmatter.name 与之一致
 */
export function scanSkillMd(
  content: string,
  opts: { expectedName?: string } = {},
): SkillContentScanResult {
  // 1. 解析 frontmatter
  const parsed = parseSkillMd(content);
  if (!parsed) {
    return {
      ok: false,
      riskLevel: 'high',
      findings: [],
      frontmatterError: 'SKILL.md 解析失败：需要以 YAML frontmatter 开头（--- 分隔），且包含 name 和 description',
    };
  }

  // 2. Zod 校验必填字段
  const zodResult = SkillFrontmatterSchema.safeParse({
    name: parsed.metadata.name,
    description: parsed.metadata.description,
  });
  if (!zodResult.success) {
    return {
      ok: false,
      riskLevel: 'high',
      findings: [],
      frontmatterError: zodResult.error.issues.map(i => i.message).join('; '),
    };
  }

  // 3. name 一致性校验
  if (opts.expectedName && opts.expectedName !== zodResult.data.name) {
    return {
      ok: false,
      riskLevel: 'high',
      findings: [],
      frontmatterError: `frontmatter.name "${zodResult.data.name}" 与调用参数 name "${opts.expectedName}" 不一致`,
      parsedName: zodResult.data.name,
      parsedDescription: zodResult.data.description,
    };
  }

  // 4. 扫描危险模式
  const securityReport = scanSkillMdContent(content, 'SKILL.md');

  // 5. 扫描凭据赋值
  const credentialFindings = scanCredentials(content, 'SKILL.md');

  const allFindings = [...securityReport.findings, ...credentialFindings];
  let riskLevel: SkillSecurityReport['riskLevel'] = 'low';
  if (allFindings.some(f => f.severity === 'high')) {
    riskLevel = 'high';
  } else if (allFindings.some(f => f.severity === 'medium')) {
    riskLevel = 'medium';
  }

  return {
    ok: riskLevel !== 'high',
    riskLevel,
    findings: allFindings,
    parsedName: zodResult.data.name,
    parsedDescription: zodResult.data.description,
  };
}
