/**
 * M5 T2: 安装策略决策矩阵单测
 */

import { describe, it, expect } from 'vitest';
import { decideInstallPolicy } from '../../skill/install-policy.js';
import type { SkillSource } from '@evoclaw/shared';

type RiskLevel = 'low' | 'medium' | 'high';

describe('M5 T2 — decideInstallPolicy 默认矩阵', () => {
  const cases: Array<[SkillSource, RiskLevel, 'auto' | 'require-confirm' | 'block']> = [
    // bundled / local / mcp — 任何风险都 auto
    ['bundled', 'low', 'auto'],
    ['bundled', 'medium', 'auto'],
    ['bundled', 'high', 'auto'],
    ['local', 'low', 'auto'],
    ['local', 'medium', 'auto'],
    ['local', 'high', 'auto'],
    ['mcp', 'low', 'auto'],
    ['mcp', 'medium', 'auto'],
    ['mcp', 'high', 'auto'],
    // clawhub — 渐进
    ['clawhub', 'low', 'auto'],
    ['clawhub', 'medium', 'require-confirm'],
    ['clawhub', 'high', 'block'],
    // github — 更谨慎
    ['github', 'low', 'require-confirm'],
    ['github', 'medium', 'require-confirm'],
    ['github', 'high', 'block'],
  ];

  for (const [source, risk, expected] of cases) {
    it(`${source} + ${risk} → ${expected}`, () => {
      const decision = decideInstallPolicy(source, risk);
      expect(decision.policy).toBe(expected);
      expect(decision.reason).toBeTruthy();
    });
  }
});

describe('M5 T2 — decideInstallPolicy override 覆盖', () => {
  it('override 可将 clawhub+low 从 auto 升级为 require-confirm（企业严格模式）', () => {
    const decision = decideInstallPolicy('clawhub', 'low', {
      'clawhub:low': 'require-confirm',
    });
    expect(decision.policy).toBe('require-confirm');
  });

  it('override 可将 github+low 降级为 auto（单位内部仓库可信）', () => {
    const decision = decideInstallPolicy('github', 'low', {
      'github:low': 'auto',
    });
    expect(decision.policy).toBe('auto');
  });

  it('未覆盖的单元格保持默认', () => {
    const decision = decideInstallPolicy('clawhub', 'medium', {
      'clawhub:low': 'require-confirm', // 仅覆盖 low
    });
    expect(decision.policy).toBe('require-confirm'); // medium 仍走默认 require-confirm
  });

  it('空 override 等价于无 override', () => {
    const decision = decideInstallPolicy('clawhub', 'low', {});
    expect(decision.policy).toBe('auto');
  });

  it('override 可将任意单元格强制 block（紧急封锁）', () => {
    const decision = decideInstallPolicy('clawhub', 'low', {
      'clawhub:low': 'block',
    });
    expect(decision.policy).toBe('block');
    expect(decision.reason).toContain('阻止');
  });
});

describe('M5 T2 — decideInstallPolicy 原因文案', () => {
  it('github 来源 require-confirm 时原因提及第三方', () => {
    const decision = decideInstallPolicy('github', 'low');
    expect(decision.reason).toContain('GitHub');
  });

  it('high + block 时原因提及高风险', () => {
    const decision = decideInstallPolicy('clawhub', 'high');
    expect(decision.reason).toContain('高风险');
  });

  it('bundled 时原因提及内置', () => {
    const decision = decideInstallPolicy('bundled', 'low');
    expect(decision.reason).toContain('内置');
  });
});
