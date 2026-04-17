/**
 * Skill 安全分析器 — 静态扫描 Skill 文件中的危险模式
 *
 * high risk → 阻止安装
 * medium risk → 警告 + 需用户确认
 */

import type { SkillSecurityReport, SkillSecurityFinding } from '@evoclaw/shared';
import fs from 'node:fs';
import path from 'node:path';

/** 危险模式规则 */
interface DangerPattern {
  type: SkillSecurityFinding['type'];
  pattern: RegExp;
  severity: SkillSecurityFinding['severity'];
  /**
   * 仅在列表中的扩展名上触发（小写，含点号）。省略则作用于所有被扫描扩展。
   * 用途：避免 keystore/exfiltration 等高危模式在 .md 文档/注释中误报。
   */
  extensions?: string[];
}

/** 代码类文件扩展（排除 .md / .yaml / .yml / .json 等数据文档） */
const CODE_EXTS = ['.ts', '.js', '.mjs', '.cjs', '.py', '.sh', '.bash', '.zsh'];

const DANGER_PATTERNS: DangerPattern[] = [
  // ─── 原有 6 条（通用代码执行 / IO）───────────────────────────────
  { type: 'eval', pattern: /\beval\s*\(/, severity: 'high' },
  { type: 'function_constructor', pattern: /new\s+Function\s*\(/, severity: 'high' },
  { type: 'shell_exec', pattern: /\b(?:exec|execSync|spawn|spawnSync)\s*\(/, severity: 'medium' },
  { type: 'fetch', pattern: /\bfetch\s*\(\s*['"`]https?:\/\//, severity: 'medium' },
  { type: 'fs_write', pattern: /\bfs\s*\.\s*(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/, severity: 'medium' },
  { type: 'env_access', pattern: /process\s*\.\s*env\s*\[/, severity: 'low' },

  // ─── M5 T1 新增：凭据窃取（keystore）─────────────────────────────
  // macOS Keychain CLI：security find|unlock|add -generic|internet-password
  { type: 'keystore', pattern: /\bsecurity\s+(?:find|unlock|add)-(?:generic|internet)-password\b/, severity: 'high', extensions: CODE_EXTS },
  // macOS Security.framework 原生 API
  { type: 'keystore', pattern: /\bSecItemCopyMatching\s*\(/, severity: 'high', extensions: CODE_EXTS },
  // Linux libsecret CLI
  { type: 'keystore', pattern: /\bsecret-tool\s+(?:lookup|search|store)\b/, severity: 'high', extensions: CODE_EXTS },
  // Windows Credential Manager CLI
  { type: 'keystore', pattern: /\bvaultcmd\s+\/(?:list|get)/, severity: 'high', extensions: CODE_EXTS },
  // Windows UWP PasswordVault
  { type: 'keystore', pattern: /Windows\.Security\.Credentials\.PasswordVault/, severity: 'high', extensions: CODE_EXTS },
  // Python keyring 库读取
  { type: 'keystore', pattern: /\bkeyring\s*\.\s*get_password\s*\(/, severity: 'high', extensions: CODE_EXTS },

  // ─── M5 T1 新增：隐蔽外传（exfiltration）─────────────────────────
  // fetch(url + btoa(...)) — base64 编码后外传
  { type: 'exfiltration', pattern: /\bfetch\s*\([^)]*\bbtoa\s*\(/, severity: 'high', extensions: CODE_EXTS },
  // buf.toString('hex') 拼接进 fetch / http 请求
  { type: 'exfiltration', pattern: /\bfetch\s*\([^)]*\btoString\s*\(\s*['"`]hex['"`]/, severity: 'high', extensions: CODE_EXTS },
  // new Image + .src = "https://..." — image beacon 经典手法（兼容 `new Image()` 后紧邻或另赋值 ref）
  { type: 'exfiltration', pattern: /\bnew\s+Image\s*\(.*\.src\s*=\s*['"`]https?:\/\//, severity: 'high', extensions: CODE_EXTS },
  // 模板字面量将变量拼进 URL 查询串（data=/payload=/exfil= 等常见字段）
  { type: 'exfiltration', pattern: /['"`]https?:\/\/[^'"`]*\?[^'"`]*(?:data|payload|exfil|leak|steal)=\$\{/, severity: 'high', extensions: CODE_EXTS },

  // ─── M5 T1 新增：DNS 隧道（dns_tunnel）──────────────────────────
  // dns.resolve / resolveTxt / resolve4 / resolve6 带 ${var} 模板字面量插值
  { type: 'dns_tunnel', pattern: /\bdns\s*\.\s*resolve(?:4|6|Txt|Any)?\s*\(\s*`[^`\n]*\$\{/, severity: 'high', extensions: CODE_EXTS },
  // shell nslookup / dig / host + 变量插值
  { type: 'dns_tunnel', pattern: /\b(?:nslookup|dig|host)\s+[\w.-]*\$\{/, severity: 'high', extensions: CODE_EXTS },

  // ─── M5 T1 新增：持久化（persistence）────────────────────────────
  // shell rc 文件追加（>> ~/.zshrc 等）
  { type: 'persistence', pattern: /(?:>>|append\w*\s*\(\s*['"`])[^'"`\n]*(?:\.zshrc|\.bashrc|\.bash_profile|\.zprofile|\.profile)\b/, severity: 'high', extensions: CODE_EXTS },
  // crontab 调用
  { type: 'persistence', pattern: /\bcrontab\s+(?:-[a-z]|[^-][\w./-]+)/, severity: 'high', extensions: CODE_EXTS },
  // launchd plist 写入
  { type: 'persistence', pattern: /Library\/LaunchAgents\/[\w.-]+\.plist/, severity: 'high', extensions: CODE_EXTS },
  // systemd user unit 写入
  { type: 'persistence', pattern: /\.config\/systemd\/user\/[\w.-]+\.service/, severity: 'high', extensions: CODE_EXTS },
];

/** 扫描单个文件 */
function scanFile(filePath: string, content: string): SkillSecurityFinding[] {
  const findings: SkillSecurityFinding[] = [];
  const lines = content.split('\n');
  const relativePath = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of DANGER_PATTERNS) {
      // 扩展名门控：规则声明了 extensions 时仅匹配列表内的扩展
      if (rule.extensions && !rule.extensions.includes(ext)) continue;
      if (rule.pattern.test(line)) {
        findings.push({
          type: rule.type,
          file: relativePath,
          line: i + 1,
          snippet: line.trim().slice(0, 120),
          severity: rule.severity,
        });
      }
    }
  }

  return findings;
}

/** 递归收集目录中的可扫描文件 */
function collectFiles(dirPath: string): string[] {
  const files: string[] = [];
  const scanExtensions = new Set(['.md', '.ts', '.js', '.py', '.sh', '.yaml', '.yml', '.json']);

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // 跳过 node_modules 和隐藏目录
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        files.push(...collectFiles(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (scanExtensions.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // 忽略权限错误
  }

  return files;
}

/** 分析 Skill 目录的安全性 */
export function analyzeSkillSecurity(dirPath: string): SkillSecurityReport {
  const files = collectFiles(dirPath);
  const allFindings: SkillSecurityFinding[] = [];

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      allFindings.push(...scanFile(filePath, content));
    } catch {
      // 跳过不可读文件
    }
  }

  // 确定总体风险等级
  let riskLevel: SkillSecurityReport['riskLevel'] = 'low';
  if (allFindings.some(f => f.severity === 'high')) {
    riskLevel = 'high';
  } else if (allFindings.some(f => f.severity === 'medium')) {
    riskLevel = 'medium';
  }

  return { riskLevel, findings: allFindings };
}
