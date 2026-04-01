/**
 * Doctor 自诊断路由
 * GET /doctor — 运行系统健康检查，返回诊断报告
 */

import { Hono } from 'hono';
import os from 'node:os';
import fs from 'node:fs';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import { isBun } from '../infrastructure/db/sqlite-adapter.js';
import type { LaneQueue } from '../agent/lane-queue.js';
import type { MemoryMonitor } from '../infrastructure/memory-monitor.js';

/** 单项检查结果 */
export interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  detail?: string;
}

/** 诊断报告 */
export interface DiagnosticReport {
  timestamp: string;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: CheckResult[];
  system: {
    platform: string;
    arch: string;
    runtime: string;
    runtimeVersion: string;
    uptime: number;
    memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
    cpuCount: number;
  };
}

/** 运行所有诊断检查 */
export function runDiagnostics(deps: {
  store?: SqliteStore;
  configManager?: ConfigManager;
  laneQueue?: LaneQueue;
}): DiagnosticReport {
  const { store, configManager, laneQueue } = deps;
  const checks: CheckResult[] = [];

  // 1. Node.js 版本检查
  checks.push(checkNodeVersion());

  // 2. 数据库连接检查
  checks.push(checkDatabase(store));

  // 3. 数据库表完整性检查
  checks.push(checkDatabaseTables(store));

  // 4. 配置文件检查
  checks.push(checkConfig(configManager));

  // 5. Provider 配置检查
  checks.push(checkProviders(configManager));

  // 6. 默认模型检查
  checks.push(checkDefaultModel(configManager));

  // 7. Embedding 模型检查
  checks.push(checkEmbeddingModel(configManager));

  // 8. 磁盘空间检查
  checks.push(checkDiskSpace());

  // 9. 内存使用检查
  checks.push(checkMemoryUsage());

  // 10. LaneQueue 状态检查
  checks.push(checkLaneQueue(laneQueue));

  // 11. PI 框架可用性检查
  checks.push(checkAgentKernel());

  // 12. Agent 数量检查
  checks.push(checkAgentCount(store));

  // 计算总体状态
  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');
  const overall = hasFail ? 'unhealthy' : hasWarn ? 'degraded' : 'healthy';

  const mem = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(),
    overall,
    checks,
    system: {
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      runtime: isBun ? 'bun' : 'node',
      runtimeVersion: isBun ? (globalThis as any).Bun.version : process.version,
      uptime: process.uptime(),
      memoryUsage: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
      cpuCount: os.cpus().length,
    },
  };
}

// ─── 各项检查实现 ───

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = Number(version.slice(1).split('.')[0]);
  if (major >= 22) {
    return { name: 'Node.js 版本', status: 'pass', message: `${version} (>= 22)` };
  }
  if (major >= 20) {
    return { name: 'Node.js 版本', status: 'warn', message: `${version} (建议 >= 22)` };
  }
  return { name: 'Node.js 版本', status: 'fail', message: `${version} (需要 >= 22)` };
}

function checkDatabase(store?: SqliteStore): CheckResult {
  if (!store) {
    return { name: '数据库连接', status: 'fail', message: '数据库未初始化' };
  }
  try {
    store.get<{ n: number }>('SELECT 1 as n');
    return { name: '数据库连接', status: 'pass', message: 'SQLite WAL 模式正常' };
  } catch (err) {
    return { name: '数据库连接', status: 'fail', message: `连接失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkDatabaseTables(store?: SqliteStore): CheckResult {
  if (!store) {
    return { name: '数据库表', status: 'fail', message: '数据库未初始化' };
  }
  const expectedTables = ['agents', 'conversation_log', 'memory_units', 'knowledge_graph', 'permissions', 'tool_audit_log'];
  const missing: string[] = [];
  for (const table of expectedTables) {
    try {
      store.get<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table);
      const row = store.get<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table);
      if (!row) missing.push(table);
    } catch {
      missing.push(table);
    }
  }

  if (missing.length === 0) {
    return { name: '数据库表', status: 'pass', message: `${expectedTables.length} 个核心表存在` };
  }
  return { name: '数据库表', status: 'fail', message: `缺少表: ${missing.join(', ')}`, detail: `预期: ${expectedTables.join(', ')}` };
}

function checkConfig(configManager?: ConfigManager): CheckResult {
  if (!configManager) {
    return { name: '配置文件', status: 'warn', message: 'ConfigManager 未初始化' };
  }
  if (!configManager.exists()) {
    return { name: '配置文件', status: 'warn', message: `配置文件不存在: ${configManager.getConfigPath()}` };
  }
  return { name: '配置文件', status: 'pass', message: configManager.getConfigPath() };
}

function checkProviders(configManager?: ConfigManager): CheckResult {
  if (!configManager) {
    return { name: 'Provider 配置', status: 'warn', message: 'ConfigManager 未初始化' };
  }
  const ids = configManager.getProviderIds();
  if (ids.length === 0) {
    return { name: 'Provider 配置', status: 'warn', message: '未配置任何 Provider' };
  }

  const withKey = ids.filter(id => configManager.getApiKey(id));
  return {
    name: 'Provider 配置',
    status: withKey.length > 0 ? 'pass' : 'warn',
    message: `${ids.length} 个 Provider（${withKey.length} 个有 API Key）`,
    detail: ids.join(', '),
  };
}

function checkDefaultModel(configManager?: ConfigManager): CheckResult {
  if (!configManager) {
    return { name: '默认模型', status: 'warn', message: 'ConfigManager 未初始化' };
  }
  const ref = configManager.getDefaultModelRef();
  if (!ref) {
    return { name: '默认模型', status: 'warn', message: '未配置默认 LLM 模型' };
  }
  const hasKey = !!configManager.getDefaultApiKey();
  return {
    name: '默认模型',
    status: hasKey ? 'pass' : 'warn',
    message: `${ref.provider}/${ref.modelId}${hasKey ? '' : ' (缺少 API Key)'}`,
  };
}

function checkEmbeddingModel(configManager?: ConfigManager): CheckResult {
  if (!configManager) {
    return { name: 'Embedding 模型', status: 'warn', message: 'ConfigManager 未初始化' };
  }
  const ref = configManager.getEmbeddingModelRef();
  if (!ref) {
    return { name: 'Embedding 模型', status: 'warn', message: '未配置 Embedding 模型（记忆向量搜索不可用）' };
  }
  return { name: 'Embedding 模型', status: 'pass', message: `${ref.provider}/${ref.modelId}` };
}

function checkDiskSpace(): CheckResult {
  try {
    const homeDir = os.homedir();
    const stats = fs.statfsSync(homeDir);
    const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
    if (freeGB < 1) {
      return { name: '磁盘空间', status: 'fail', message: `剩余 ${freeGB.toFixed(1)} GB (< 1 GB)` };
    }
    if (freeGB < 5) {
      return { name: '磁盘空间', status: 'warn', message: `剩余 ${freeGB.toFixed(1)} GB (< 5 GB)` };
    }
    return { name: '磁盘空间', status: 'pass', message: `剩余 ${freeGB.toFixed(1)} GB` };
  } catch {
    return { name: '磁盘空间', status: 'warn', message: '无法检测磁盘空间' };
  }
}

function checkMemoryUsage(): CheckResult {
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapRatio = mem.heapUsed / mem.heapTotal;

  if (rssMB > 1024) {
    return { name: '内存使用', status: 'warn', message: `RSS ${rssMB} MB (> 1 GB)`, detail: `Heap: ${Math.round(heapRatio * 100)}%` };
  }
  return { name: '内存使用', status: 'pass', message: `RSS ${rssMB} MB`, detail: `Heap: ${Math.round(heapRatio * 100)}%` };
}

function checkLaneQueue(laneQueue?: LaneQueue): CheckResult {
  if (!laneQueue) {
    return { name: 'Lane 队列', status: 'warn', message: 'LaneQueue 未初始化' };
  }
  const status = laneQueue.getStatus();
  const totalRunning = status.main.running + status.subagent.running + status.cron.running;
  const totalQueued = status.main.queued + status.subagent.queued + status.cron.queued;
  return {
    name: 'Lane 队列',
    status: 'pass',
    message: `运行中 ${totalRunning}, 排队 ${totalQueued}`,
    detail: `main: ${status.main.running}/${status.main.concurrency}, subagent: ${status.subagent.running}/${status.subagent.concurrency}, cron: ${status.cron.running}/${status.cron.concurrency}`,
  };
}

function checkAgentKernel(): CheckResult {
  try {
    // 验证自研 Agent Kernel 模块可用
    require.resolve('./kernel/index.js');
    return { name: 'Agent Kernel', status: 'pass', message: '自研 Agent 内核可用' };
  } catch {
    return { name: 'Agent Kernel', status: 'fail', message: 'Agent 内核模块缺失' };
  }
}

function checkAgentCount(store?: SqliteStore): CheckResult {
  if (!store) {
    return { name: 'Agent 数量', status: 'warn', message: '数据库未初始化' };
  }
  try {
    const row = store.get<{ count: number }>('SELECT COUNT(*) as count FROM agents');
    const count = row?.count ?? 0;
    return { name: 'Agent 数量', status: 'pass', message: `${count} 个 Agent` };
  } catch {
    return { name: 'Agent 数量', status: 'warn', message: '无法查询 Agent 数量' };
  }
}

// ─── 路由 ───

export function createDoctorRoutes(store?: SqliteStore, configManager?: ConfigManager, laneQueue?: LaneQueue, memoryMonitor?: MemoryMonitor) {
  const app = new Hono();

  app.get('/', (c) => {
    const report = runDiagnostics({ store, configManager, laneQueue });
    const statusCode = report.overall === 'unhealthy' ? 503 : 200;
    return c.json(report, statusCode);
  });

  // 内存监控报告
  app.get('/memory', (c) => {
    if (!memoryMonitor) {
      return c.json({ error: '内存监控未启用' }, 503);
    }
    return c.json(memoryMonitor.getReport());
  });

  return app;
}
