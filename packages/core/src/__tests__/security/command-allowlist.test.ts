import { describe, it, expect } from 'vitest';
import { checkCommandFlags } from '../../security/command-allowlist.js';

describe('command-allowlist', () => {
  describe('git', () => {
    it('git status → safe', () => {
      expect(checkCommandFlags('git status')).toBe('safe');
    });

    it('git add . → safe', () => {
      expect(checkCommandFlags('git add .')).toBe('safe');
    });

    it('git commit -m "msg" → safe', () => {
      expect(checkCommandFlags('git commit -m "fix typo"')).toBe('safe');
    });

    it('git push origin main → safe', () => {
      expect(checkCommandFlags('git push origin main')).toBe('safe');
    });

    it('git push --force → ask', () => {
      expect(checkCommandFlags('git push --force origin main')).toBe('ask');
    });

    it('git push -f → ask', () => {
      expect(checkCommandFlags('git push -f origin main')).toBe('ask');
    });

    it('git reset --hard → ask', () => {
      expect(checkCommandFlags('git reset --hard HEAD')).toBe('ask');
    });

    it('git commit --amend → ask', () => {
      expect(checkCommandFlags('git commit --amend')).toBe('ask');
    });

    it('git clean -fd → ask', () => {
      expect(checkCommandFlags('git clean -fd')).toBe('ask');
    });

    it('git branch -D feature → ask', () => {
      expect(checkCommandFlags('git branch -D feature')).toBe('ask');
    });

    it('--no-verify → ask', () => {
      expect(checkCommandFlags('git push --no-verify')).toBe('ask');
    });
  });

  describe('rm', () => {
    it('rm file.txt → safe', () => {
      expect(checkCommandFlags('rm file.txt')).toBe('safe');
    });

    it('rm -rf dir/ → ask', () => {
      expect(checkCommandFlags('rm -rf dir/')).toBe('ask');
    });

    it('rm -r dir/ → ask', () => {
      expect(checkCommandFlags('rm -r dir/')).toBe('ask');
    });

    it('rm -f file.txt → ask', () => {
      expect(checkCommandFlags('rm -f file.txt')).toBe('ask');
    });
  });

  describe('sed', () => {
    it('sed "s/a/b/" file.txt → safe', () => {
      expect(checkCommandFlags('sed "s/a/b/" file.txt')).toBe('safe');
    });

    it('sed -i "s/a/b/" file.txt → ask', () => {
      expect(checkCommandFlags('sed -i "s/a/b/" file.txt')).toBe('ask');
    });

    it('sed --in-place "s/a/b/" file.txt → ask', () => {
      expect(checkCommandFlags('sed --in-place "s/a/b/" file.txt')).toBe('ask');
    });
  });

  describe('chmod', () => {
    it('chmod 755 file → safe', () => {
      expect(checkCommandFlags('chmod 755 file')).toBe('safe');
    });

    it('chmod 777 file → ask', () => {
      expect(checkCommandFlags('chmod 777 file')).toBe('ask');
    });
  });

  describe('不在白名单的命令', () => {
    it('docker ps → skip', () => {
      expect(checkCommandFlags('docker ps')).toBe('skip');
    });

    it('npm install → skip', () => {
      expect(checkCommandFlags('npm install')).toBe('skip');
    });

    it('空命令 → skip', () => {
      expect(checkCommandFlags('')).toBe('skip');
    });
  });

  describe('cd 前缀处理', () => {
    it('cd /app && git push --force → ask', () => {
      expect(checkCommandFlags('cd /app && git push --force')).toBe('ask');
    });
  });
});
