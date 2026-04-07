import { describe, it, expect } from 'vitest';
import { detectDestructive } from '../../security/destructive-detector.js';

describe('destructive-detector', () => {
  describe('Git 数据丢失', () => {
    it('git reset --hard', () => {
      const r = detectDestructive('git reset --hard HEAD~1');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('git_data_loss');
    });

    it('git clean -f', () => {
      const r = detectDestructive('git clean -fd');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('git_data_loss');
    });

    it('git checkout .', () => {
      const r = detectDestructive('git checkout .');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('git_data_loss');
    });

    it('git stash drop', () => {
      const r = detectDestructive('git stash drop stash@{0}');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('git_data_loss');
    });
  });

  describe('Git 历史覆盖', () => {
    it('git push --force', () => {
      const r = detectDestructive('git push --force origin main');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('git_overwrite');
    });

    it('git push -f', () => {
      const r = detectDestructive('git push -f origin main');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('git_overwrite');
    });

    it('git commit --amend', () => {
      const r = detectDestructive('git commit --amend -m "fix"');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('git_overwrite');
    });
  });

  describe('文件删除', () => {
    it('rm -rf', () => {
      const r = detectDestructive('rm -rf /tmp/build');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('file_delete');
    });

    it('rm -f', () => {
      const r = detectDestructive('rm -f sensitive.txt');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('file_delete');
    });
  });

  describe('数据库', () => {
    it('DROP TABLE', () => {
      const r = detectDestructive('DROP TABLE users;');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('database');
    });

    it('DELETE FROM 无 WHERE', () => {
      const r = detectDestructive('DELETE FROM users;');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('database');
    });

    it('TRUNCATE TABLE', () => {
      const r = detectDestructive('TRUNCATE TABLE logs');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('database');
    });
  });

  describe('基础设施', () => {
    it('kubectl delete', () => {
      const r = detectDestructive('kubectl delete pod my-pod');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('infrastructure');
    });

    it('terraform destroy', () => {
      const r = detectDestructive('terraform destroy -auto-approve');
      expect(r.isDestructive).toBe(true);
      expect(r.category).toBe('infrastructure');
    });
  });

  describe('安全命令不触发', () => {
    it('git status', () => {
      expect(detectDestructive('git status').isDestructive).toBe(false);
    });

    it('git add .', () => {
      expect(detectDestructive('git add .').isDestructive).toBe(false);
    });

    it('npm install', () => {
      expect(detectDestructive('npm install lodash').isDestructive).toBe(false);
    });

    it('ls -la', () => {
      expect(detectDestructive('ls -la').isDestructive).toBe(false);
    });

    it('git push (without force)', () => {
      expect(detectDestructive('git push origin main').isDestructive).toBe(false);
    });
  });
});
