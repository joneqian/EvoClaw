import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CronRunner } from '../scheduler/cron-runner.js';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';
import { LaneQueue } from '../agent/lane-queue.js';

describe('CronRunner', () => {
  let db: SqliteStore;
  let laneQueue: LaneQueue;
  let runner: CronRunner;
  const agentId = 'test-agent-cron';

  beforeEach(async () => {
    db = new SqliteStore(':memory:');
    const migRunner = new MigrationRunner(db);
    await migRunner.run();
    db.run(
      "INSERT INTO agents (id, name, emoji, status, config_json, created_at, updated_at) VALUES (?, 'Test', '🤖', 'active', '{}', datetime('now'), datetime('now'))",
      agentId,
    );
    laneQueue = new LaneQueue();
    runner = new CronRunner(db, laneQueue);
  });

  afterEach(() => {
    runner.stop();
  });

  describe('CRUD', () => {
    it('应创建定时任务', () => {
      const job = runner.scheduleJob(agentId, {
        name: '每小时汇总',
        cronExpression: '0 * * * *',
        actionType: 'prompt',
        actionConfig: { prompt: '请生成每小时汇总' },
      });

      expect(job.id).toBeDefined();
      expect(job.name).toBe('每小时汇总');
      expect(job.cronExpression).toBe('0 * * * *');
      expect(job.enabled).toBe(true);
      expect(job.nextRunAt).toBeDefined();
    });

    it('应列出 Agent 的任务', () => {
      runner.scheduleJob(agentId, {
        name: 'Job A',
        cronExpression: '0 * * * *',
        actionType: 'prompt',
      });
      runner.scheduleJob(agentId, {
        name: 'Job B',
        cronExpression: '*/5 * * * *',
        actionType: 'tool',
      });

      const jobs = runner.listJobs(agentId);
      expect(jobs).toHaveLength(2);
    });

    it('应更新任务', () => {
      const job = runner.scheduleJob(agentId, {
        name: 'Original',
        cronExpression: '0 * * * *',
        actionType: 'prompt',
      });

      const success = runner.updateJob(job.id, { name: 'Updated', enabled: false });
      expect(success).toBe(true);

      const jobs = runner.listJobs(agentId);
      const updated = jobs.find((j) => j.id === job.id);
      expect(updated?.name).toBe('Updated');
      expect(updated?.enabled).toBe(false);
    });

    it('更新不存在的任务应返回 false', () => {
      const success = runner.updateJob('nonexistent', { name: 'X' });
      expect(success).toBe(false);
    });

    it('应删除任务', () => {
      const job = runner.scheduleJob(agentId, {
        name: 'To Delete',
        cronExpression: '0 * * * *',
        actionType: 'prompt',
      });

      expect(runner.removeJob(job.id)).toBe(true);
      expect(runner.listJobs(agentId)).toHaveLength(0);
    });

    it('删除不存在的任务应返回 false', () => {
      expect(runner.removeJob('nonexistent')).toBe(false);
    });
  });

  describe('调度', () => {
    it('应能 start 和 stop', () => {
      expect(runner.isRunning).toBe(false);
      runner.start();
      expect(runner.isRunning).toBe(true);
      runner.stop();
      expect(runner.isRunning).toBe(false);
    });

    it('tick 应执行到期任务', async () => {
      // 创建一个 next_run_at 在过去的任务
      const job = runner.scheduleJob(agentId, {
        name: 'Past Due',
        cronExpression: '* * * * *', // 每分钟
        actionType: 'prompt',
        actionConfig: { prompt: '执行任务' },
      });

      // 手动设置 next_run_at 为过去
      db.run(
        "UPDATE cron_jobs SET next_run_at = datetime('now', '-1 minute') WHERE id = ?",
        job.id,
      );

      const executed = await runner.tick();
      expect(executed).toBe(1);

      // 验证 next_run_at 已更新
      const row = db.get<{ next_run_at: string }>('SELECT next_run_at FROM cron_jobs WHERE id = ?', job.id);
      expect(new Date(row!.next_run_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
  });
});
