/**
 * 破坏性命令检测器 — 信息性警告系统
 *
 * 不阻断执行，仅标记 isDestructive，触发前端确认对话框。
 * 参考 Claude Code destructiveCommandDetection.ts
 *
 * 分类:
 * - git_data_loss:  git reset --hard, git clean -f, git checkout .
 * - git_overwrite:  git push --force, git commit --amend
 * - git_bypass:     --no-verify
 * - file_delete:    rm -rf, rm -f
 * - database:       DROP TABLE/DATABASE, DELETE FROM (无 WHERE), TRUNCATE
 * - infrastructure: kubectl delete, terraform destroy, docker rm -f
 */

export type DestructiveCategory =
  | 'git_data_loss'
  | 'git_overwrite'
  | 'git_bypass'
  | 'file_delete'
  | 'database'
  | 'infrastructure';

export interface DestructiveDetection {
  /** 是否检测到破坏性操作 */
  isDestructive: boolean;
  /** 破坏性类别 */
  category?: DestructiveCategory;
  /** 警告信息 */
  warning?: string;
}

/** 破坏性命令模式 */
const DESTRUCTIVE_PATTERNS: Array<{
  pattern: RegExp;
  category: DestructiveCategory;
  warning: string;
}> = [
  // Git 数据丢失
  { pattern: /git\s+reset\s+--hard/i, category: 'git_data_loss', warning: 'git reset --hard 将丢弃所有未提交更改' },
  { pattern: /git\s+clean\s+-[a-z]*f/i, category: 'git_data_loss', warning: 'git clean -f 将删除未跟踪的文件' },
  { pattern: /git\s+checkout\s+\./i, category: 'git_data_loss', warning: 'git checkout . 将丢弃所有工作区修改' },
  { pattern: /git\s+restore\s+\./i, category: 'git_data_loss', warning: 'git restore . 将丢弃所有工作区修改' },
  { pattern: /git\s+stash\s+drop/i, category: 'git_data_loss', warning: 'git stash drop 将永久删除暂存内容' },

  // Git 历史覆盖
  { pattern: /git\s+push\s+[^\n]*--force/i, category: 'git_overwrite', warning: 'git push --force 将覆盖远程历史' },
  { pattern: /git\s+push\s+[^\n]*-f\b/i, category: 'git_overwrite', warning: 'git push -f 将覆盖远程历史' },
  { pattern: /git\s+commit\s+[^\n]*--amend/i, category: 'git_overwrite', warning: 'git commit --amend 将修改上一次提交' },
  { pattern: /git\s+rebase\b/i, category: 'git_overwrite', warning: 'git rebase 将重写提交历史' },

  // Git 安全绕过
  { pattern: /--no-verify/i, category: 'git_bypass', warning: '--no-verify 将跳过 Git hooks 检查' },

  // 文件删除
  { pattern: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, category: 'file_delete', warning: 'rm -rf 将递归强制删除文件' },
  { pattern: /\brm\s+-f\b/i, category: 'file_delete', warning: 'rm -f 将强制删除文件（不询问确认）' },

  // 数据库
  { pattern: /DROP\s+(TABLE|DATABASE|INDEX|SCHEMA)/i, category: 'database', warning: 'DROP 操作将永久删除数据库对象' },
  { pattern: /DELETE\s+FROM\s+\w+\s*(;|$)/i, category: 'database', warning: 'DELETE FROM 无 WHERE 条件将删除全部数据' },
  { pattern: /TRUNCATE\s+TABLE/i, category: 'database', warning: 'TRUNCATE TABLE 将清空表中所有数据' },

  // 基础设施
  { pattern: /kubectl\s+delete/i, category: 'infrastructure', warning: 'kubectl delete 将销毁 Kubernetes 资源' },
  { pattern: /terraform\s+destroy/i, category: 'infrastructure', warning: 'terraform destroy 将销毁基础设施资源' },
  { pattern: /docker\s+rm\s+-f/i, category: 'infrastructure', warning: 'docker rm -f 将强制删除容器' },
  { pattern: /docker\s+system\s+prune/i, category: 'infrastructure', warning: 'docker system prune 将清理未使用的资源' },
];

/**
 * 检测命令是否包含破坏性操作
 */
export function detectDestructive(command: string): DestructiveDetection {
  for (const { pattern, category, warning } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { isDestructive: true, category, warning };
    }
  }
  return { isDestructive: false };
}
