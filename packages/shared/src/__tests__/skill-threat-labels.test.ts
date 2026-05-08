/**
 * M7-Tier2 PR4: SKILL_THREAT_LABELS 完整性 + 内容约束测试
 *
 * 防止后续添加 threat type 时漏写中文标签 — 让 UI 退化到英文 raw type 名
 * 是糟糕的用户体验，需要在编译期 + 单测期双重保护。
 */

import { describe, it, expect } from 'vitest';
import { SKILL_THREAT_LABELS } from '../types/skill.js';
import type { SkillThreatType } from '../types/skill.js';

/**
 * 全部 threat type 列表 — 与 SkillThreatType 联合保持同步。
 * 当 union 新增成员时，TS 编译会要求这里也加（exhaustiveness check 通过 satisfies）。
 */
const ALL_TYPES = [
  'eval',
  'function_constructor',
  'fetch',
  'fs_write',
  'shell_exec',
  'env_access',
  'keystore',
  'exfiltration',
  'dns_tunnel',
  'persistence',
] as const satisfies readonly SkillThreatType[];

describe('SKILL_THREAT_LABELS', () => {
  it('覆盖所有 SkillThreatType union 成员（10 种）', () => {
    for (const type of ALL_TYPES) {
      expect(SKILL_THREAT_LABELS[type], `missing label for type=${type}`).toBeDefined();
    }
    // 反向：map 不应有未声明的 type（防添加时拼错 key）
    const mapKeys = Object.keys(SKILL_THREAT_LABELS).sort();
    const expected = [...ALL_TYPES].sort();
    expect(mapKeys).toEqual(expected);
  });

  it('每个 label 含中文短标签 + 描述 + emoji', () => {
    for (const type of ALL_TYPES) {
      const meta = SKILL_THREAT_LABELS[type];
      expect(meta.label, `${type}.label 不应为空`).toMatch(/.+/);
      expect(meta.description, `${type}.description 不应为空`).toMatch(/.+/);
      expect(meta.icon, `${type}.icon 不应为空`).toMatch(/.+/);
      // 短标签 ≤ 8 字（中文计 1 字符；UI 徽章空间限制）
      expect(meta.label.length, `${type}.label 应 ≤ 8 字`).toBeLessThanOrEqual(8);
      // 描述 ≤ 40 字
      expect(meta.description.length, `${type}.description 应 ≤ 40 字`).toBeLessThanOrEqual(40);
    }
  });

  it('高敏感类（keystore/exfiltration/dns_tunnel）使用 🔐 / 🚨 警示 emoji', () => {
    expect(SKILL_THREAT_LABELS.keystore.icon).toBe('🔐');
    expect(SKILL_THREAT_LABELS.exfiltration.icon).toBe('🚨');
    expect(SKILL_THREAT_LABELS.dns_tunnel.icon).toBe('🚨');
  });
});
