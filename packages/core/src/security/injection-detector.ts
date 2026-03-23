/**
 * Prompt 注入检测器 — 纯函数模块，无状态
 * 所有 RegExp 在模块加载时预编译
 */

export interface InjectionDetectionResult {
  detected: boolean;
  patterns: string[];
  severity: 'low' | 'medium' | 'high';
}

type Severity = 'low' | 'medium' | 'high';

interface PatternEntry {
  name: string;
  pattern: RegExp;
  severity: Severity;
}

/** 17 种注入模式，按严重级别分组 */
const PATTERNS: PatternEntry[] = [
  // HIGH — 直接指令覆盖
  { name: 'ignore_previous', pattern: /ignore\s+(previous|above|all\s+previous)\s+(instructions?|prompts?|rules?)|disregard\s+(previous|above|all)\s+(instructions?|prompts?)/i, severity: 'high' },
  { name: 'system_role', pattern: /^system\s*:/im, severity: 'high' },
  { name: 'chatml_injection', pattern: /<\|im_start\|>/i, severity: 'high' },
  { name: 'admin_root', pattern: /^(?:ADMIN|ROOT)\s*:/m, severity: 'high' },
  { name: 'llama_inst', pattern: /\[INST\]|\[\/INST\]/i, severity: 'high' },
  { name: 'llama2_sys', pattern: /<s>|<<SYS>>|<<\/SYS>>/i, severity: 'high' },
  { name: 'claude_separator', pattern: /\n\nHuman\s*:|\n\nAssistant\s*:/i, severity: 'high' },
  { name: 'system_prompt_block', pattern: /BEGIN\s+SYSTEM\s+PROMPT|END\s+SYSTEM\s+PROMPT/i, severity: 'high' },

  // MEDIUM — 编码/隐蔽注入
  { name: 'base64_decode', pattern: /atob\s*\(|Buffer\.from\s*\([^)]*,\s*['"]base64['"]\)/i, severity: 'medium' },
  { name: 'unicode_escape_cmd', pattern: /(?:\\u[0-9a-fA-F]{4}\s*){4,}/i, severity: 'medium' },
  { name: 'markdown_exfil', pattern: /!\[[^\]]*\]\(https?:\/\/[^)]*\?[^)]*(?:data|token|key|secret|password)\s*=/i, severity: 'medium' },
  { name: 'html_injection', pattern: /<script[\s>]|<img\s+[^>]*onerror\s*=|<iframe[\s>]/i, severity: 'medium' },
  { name: 'role_play', pattern: /pretend\s+you\s+are|act\s+as\s+if\s+no\s+restrictions|jailbreak/i, severity: 'medium' },

  // LOW — 弱信号
  { name: 'weak_separator', pattern: /(?<!\n\n)(?:Human|Assistant)\s*:/i, severity: 'low' },
  { name: 'prompt_leak', pattern: /repeat\s+your\s+system\s+prompt|show\s+me\s+your\s+instructions|print\s+your\s+(?:system\s+)?prompt/i, severity: 'low' },
  { name: 'chinese_injection', pattern: /忽略之前的指令|忽略上面的|忽略以上|无视之前的/i, severity: 'low' },
  { name: 'separator_bomb', pattern: /(?:^(?:---|===|\*\*\*)\s*$\n?){5,}/m, severity: 'low' },
];

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

/**
 * 检测文本中的 prompt 注入模式
 * @param text 待检测文本
 * @returns 检测结果
 */
export function detectInjection(text: string): InjectionDetectionResult {
  if (!text) {
    return { detected: false, patterns: [], severity: 'low' };
  }

  const matched: string[] = [];
  let maxSeverity: Severity = 'low';

  for (const entry of PATTERNS) {
    if (entry.pattern.test(text)) {
      matched.push(entry.name);
      if (SEVERITY_ORDER[entry.severity] > SEVERITY_ORDER[maxSeverity]) {
        maxSeverity = entry.severity;
      }
    }
  }

  return {
    detected: matched.length > 0,
    patterns: matched,
    severity: maxSeverity,
  };
}
