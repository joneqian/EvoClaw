import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';
import { SecurityExtension } from '../bridge/security-extension.js';
import { PermissionInterceptor } from '../tools/permission-interceptor.js';

/** 生成临时数据库路径 */
function tmpDbPath(): string {
  const dir = path.join(os.tmpdir(), `evoclaw-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'test.db');
}

const TEST_AGENT_ID = 'agent-interceptor-001';

describe('PermissionInterceptor', () => {
  let store: SqliteStore;
  let security: SecurityExtension;
  let interceptor: PermissionInterceptor;

  beforeEach(async () => {
    store = new SqliteStore(tmpDbPath());
    const runner = new MigrationRunner(store);
    await runner.run();
    // 创建测试 Agent
    store.run(
      `INSERT INTO agents (id, name, status) VALUES (?, ?, 'active')`,
      TEST_AGENT_ID, '测试 Agent',
    );
    security = new SecurityExtension(store);
    interceptor = new PermissionInterceptor(security);
  });

  afterEach(() => {
    try {
      const dbPath = store.dbPath;
      store.close();
      if (dbPath.includes(os.tmpdir())) {
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      }
    } catch {
      // 忽略清理错误
    }
  });

  describe('isDangerousCommand', () => {
    it('检测 rm -rf 为危险命令', () => {
      expect(interceptor.isDangerousCommand('rm -rf /tmp/data')).toBe(true);
    });

    it('检测 rm -r 为危险命令', () => {
      expect(interceptor.isDangerousCommand('rm -r ./build')).toBe(true);
    });

    it('检测 DROP TABLE 为危险命令', () => {
      expect(interceptor.isDangerousCommand('DROP TABLE users')).toBe(true);
    });

    it('检测 sudo 为危险命令', () => {
      expect(interceptor.isDangerousCommand('sudo apt install vim')).toBe(true);
    });

    it('检测 chmod 777 为危险命令', () => {
      expect(interceptor.isDangerousCommand('chmod 777 /var/www')).toBe(true);
    });

    it('允许安全命令通过', () => {
      expect(interceptor.isDangerousCommand('ls -la')).toBe(false);
      expect(interceptor.isDangerousCommand('cat file.txt')).toBe(false);
      expect(interceptor.isDangerousCommand('git status')).toBe(false);
      expect(interceptor.isDangerousCommand('npm install')).toBe(false);
    });
  });

  describe('isRestrictedPath', () => {
    it('阻止 /etc/ 路径', () => {
      expect(interceptor.isRestrictedPath('/etc/passwd')).toBe(true);
    });

    it('阻止 ~/.ssh/ 路径', () => {
      expect(interceptor.isRestrictedPath('~/.ssh/id_rsa')).toBe(true);
    });

    it('阻止 /System/ 路径', () => {
      expect(interceptor.isRestrictedPath('/System/Library/Frameworks')).toBe(true);
    });

    it('允许普通路径', () => {
      expect(interceptor.isRestrictedPath('/Users/me/projects/app.ts')).toBe(false);
      expect(interceptor.isRestrictedPath('/tmp/output.log')).toBe(false);
    });
  });

  describe('intercept', () => {
    it('shell 工具 + 危险命令 → 不允许 + 需要确认', () => {
      const result = interceptor.intercept(TEST_AGENT_ID, 'bash', { command: 'rm -rf /home/user' });
      expect(result.allowed).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.permissionCategory).toBe('shell');
      expect(result.reason).toContain('危险命令');
    });

    it('消息发送工具 → 需要确认', () => {
      const result = interceptor.intercept(TEST_AGENT_ID, 'send_email', { to: 'a@b.com' });
      expect(result.allowed).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.permissionCategory).toBe('network');
    });

    it('文件读取受限路径 → 需要确认', () => {
      const result = interceptor.intercept(TEST_AGENT_ID, 'read', { path: '/etc/shadow' });
      expect(result.allowed).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.permissionCategory).toBe('file_read');
    });

    it('已授权的工具调用 → 允许', () => {
      security.grantPermission(TEST_AGENT_ID, 'file_read', 'always');
      const result = interceptor.intercept(TEST_AGENT_ID, 'read', { path: '/Users/me/file.txt' });
      expect(result.allowed).toBe(true);
    });

    it('被拒绝的权限 → 不允许', () => {
      security.grantPermission(TEST_AGENT_ID, 'shell', 'deny');
      const result = interceptor.intercept(TEST_AGENT_ID, 'bash', { command: 'ls' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('shell');
    });

    it('未知工具映射到 skill 类别', () => {
      const result = interceptor.intercept(TEST_AGENT_ID, 'custom_tool', {});
      // 默认没有权限，应该返回 ask
      expect(result.allowed).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.permissionCategory).toBe('skill');
    });
  });
});
