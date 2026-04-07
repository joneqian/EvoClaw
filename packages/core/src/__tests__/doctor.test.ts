import { describe, it, expect } from 'vitest';
import { runDiagnostics } from '../routes/doctor.js';
import type { CheckResult, DiagnosticReport } from '../routes/doctor.js';

describe('Doctor 自诊断', () => {
  it('无依赖时应返回诊断报告', () => {
    const report = runDiagnostics({});
    expect(report.timestamp).toBeTruthy();
    expect(report.overall).toBeDefined();
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.system).toBeDefined();
    expect(report.system.runtimeVersion).toBe(process.version);
    expect(report.system.cpuCount).toBeGreaterThan(0);
  });

  it('应包含至少 10 项检查', () => {
    const report = runDiagnostics({});
    expect(report.checks.length).toBeGreaterThanOrEqual(10);
  });

  it('每项检查应有 name, status, message', () => {
    const report = runDiagnostics({});
    for (const check of report.checks) {
      expect(check.name).toBeTruthy();
      expect(['pass', 'warn', 'fail']).toContain(check.status);
      expect(check.message).toBeTruthy();
    }
  });

  it('Node.js 版本检查应通过（当前环境 >= 22）', () => {
    const report = runDiagnostics({});
    const nodeCheck = report.checks.find(c => c.name === 'Node.js 版本');
    expect(nodeCheck).toBeDefined();
    // 当前开发环境应该是 >= 22
    const major = Number(process.version.slice(1).split('.')[0]);
    if (major >= 22) {
      expect(nodeCheck!.status).toBe('pass');
    }
  });

  it('无数据库时数据库检查应 fail', () => {
    const report = runDiagnostics({});
    const dbCheck = report.checks.find(c => c.name === '数据库连接');
    expect(dbCheck?.status).toBe('fail');
  });

  it('无 ConfigManager 时配置检查应 warn', () => {
    const report = runDiagnostics({});
    const configCheck = report.checks.find(c => c.name === '配置文件');
    expect(configCheck?.status).toBe('warn');
  });

  it('内存使用检查应通过', () => {
    const report = runDiagnostics({});
    const memCheck = report.checks.find(c => c.name === '内存使用');
    expect(memCheck?.status).toBe('pass');
  });

  it('磁盘空间检查应有结果', () => {
    const report = runDiagnostics({});
    const diskCheck = report.checks.find(c => c.name === '磁盘空间');
    expect(diskCheck).toBeDefined();
    expect(['pass', 'warn', 'fail']).toContain(diskCheck!.status);
  });

  it('overall 状态应基于 checks 计算', () => {
    const report = runDiagnostics({});
    const hasFail = report.checks.some(c => c.status === 'fail');
    const hasWarn = report.checks.some(c => c.status === 'warn');

    if (hasFail) {
      expect(report.overall).toBe('unhealthy');
    } else if (hasWarn) {
      expect(report.overall).toBe('degraded');
    } else {
      expect(report.overall).toBe('healthy');
    }
  });

  it('系统信息应包含所有字段', () => {
    const report = runDiagnostics({});
    expect(report.system.platform).toBeTruthy();
    expect(report.system.arch).toBeTruthy();
    expect(report.system.runtimeVersion).toMatch(/^v?\d+/);
    expect(report.system.uptime).toBeGreaterThan(0);
    expect(report.system.memoryUsage.rss).toBeGreaterThan(0);
    expect(report.system.memoryUsage.heapUsed).toBeGreaterThan(0);
    expect(report.system.memoryUsage.heapTotal).toBeGreaterThan(0);
    expect(report.system.memoryUsage.external).toBeGreaterThanOrEqual(0);
    expect(report.system.featureFlags).toBeDefined();
    expect(typeof report.system.featureFlags.SANDBOX.enabled).toBe('boolean');
    expect(report.system.featureFlags.SANDBOX.desc).toBeTruthy();
    expect(report.system.featureFlags.SANDBOX.modules).toBeInstanceOf(Array);
  });

  it('Lane 队列检查无 queue 时应 warn', () => {
    const report = runDiagnostics({});
    const queueCheck = report.checks.find(c => c.name === 'Lane 队列');
    expect(queueCheck?.status).toBe('warn');
  });
});
