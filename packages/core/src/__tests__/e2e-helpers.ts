/**
 * 集成测试共享辅助工具
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createApp, type CreateAppOptions } from '../server.js';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { AgentManager } from '../agent/agent-manager.js';
import { ConfigManager } from '../infrastructure/config-manager.js';

/** 读取所有迁移 SQL 并合并 */
function loadAllMigrations(): string {
  const migrationsDir = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf-8')).join('\n');
}

export const MIGRATION_SQL = loadAllMigrations();

export const TEST_TOKEN = 'e2e-test-token-256bit-secure';

export function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

export function jsonHeaders(): Record<string, string> {
  return { ...authHeader(), 'Content-Type': 'application/json' };
}

/** 创建测试环境 */
export function createTestEnv() {
  const tmpDir = path.join(os.tmpdir(), `evoclaw-e2e-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const dbPath = path.join(tmpDir, 'test.db');
  const agentsDir = path.join(tmpDir, 'agents');
  const configPath = path.join(tmpDir, 'evo_claw.json');

  const store = new SqliteStore(dbPath);
  store.exec(MIGRATION_SQL);

  const agentManager = new AgentManager(store, agentsDir);
  const configManager = new ConfigManager(configPath);

  const options: CreateAppOptions = {
    token: TEST_TOKEN,
    store,
    agentManager,
    configManager,
  };

  const app = createApp(options);

  return { app, store, agentManager, configManager, tmpDir, configPath };
}

/** 清理测试环境 */
export function cleanupTestEnv(store: SqliteStore, tmpDir: string) {
  try { store.close(); } catch { /* 忽略 */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
