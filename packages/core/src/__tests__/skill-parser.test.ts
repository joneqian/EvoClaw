import { describe, it, expect } from 'vitest';
import { parseSkillMd, isSkillFile } from '../skill/skill-parser.js';

describe('skill-parser', () => {
  describe('parseSkillMd', () => {
    it('应解析基本的 SKILL.md', () => {
      const content = `---
name: test-skill
description: A test skill for testing
version: 1.0.0
author: test-author
---

This is the skill body content.

## Usage
Use this skill for testing.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.name).toBe('test-skill');
      expect(result!.metadata.description).toBe('A test skill for testing');
      expect(result!.metadata.version).toBe('1.0.0');
      expect(result!.metadata.author).toBe('test-author');
      expect(result!.body).toContain('This is the skill body content.');
      expect(result!.body).toContain('## Usage');
    });

    it('应解析 allowed-tools 列表', () => {
      const content = `---
name: coding-skill
description: A coding skill
allowed-tools:
  - Read
  - Write
  - Bash
---

Instructions here.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.allowedTools).toEqual(['Read', 'Write', 'Bash']);
    });

    it('应解析 disable-model-invocation', () => {
      const content = `---
name: manual-skill
description: Manual only skill
disable-model-invocation: true
---

Only triggered via /skill:name.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.disableModelInvocation).toBe(true);
    });

    it('应解析 EvoClaw 扩展 requires 字段', () => {
      const content = `---
name: docker-skill
description: Needs docker
requires.bins:
  - docker
  - docker-compose
requires.env:
  - DOCKER_HOST
requires.os:
  - linux
  - macos
---

Docker instructions.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.requires).toBeDefined();
      expect(result!.metadata.requires!.bins).toEqual(['docker', 'docker-compose']);
      expect(result!.metadata.requires!.env).toEqual(['DOCKER_HOST']);
      expect(result!.metadata.requires!.os).toEqual(['linux', 'macos']);
    });

    it('应截断 compatibility 到 500 字符', () => {
      const longCompat = 'x'.repeat(600);
      const content = `---
name: compat-skill
description: Has long compatibility
compatibility: ${longCompat}
---

Body.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.compatibility!.length).toBe(500);
    });

    it('缺少 name 时返回 null', () => {
      const content = `---
description: No name field
---

Body.`;

      expect(parseSkillMd(content)).toBeNull();
    });

    it('缺少 description 时返回 null', () => {
      const content = `---
name: no-desc
---

Body.`;

      expect(parseSkillMd(content)).toBeNull();
    });

    it('没有 frontmatter 时返回 null', () => {
      const content = `Just plain text without frontmatter.`;
      expect(parseSkillMd(content)).toBeNull();
    });

    it('空内容返回 null', () => {
      expect(parseSkillMd('')).toBeNull();
      expect(parseSkillMd('   ')).toBeNull();
    });

    it('应解析 whenToUse 字段', () => {
      const content = `---
name: search-skill
description: Web search
whenToUse: 用户需要搜索网页信息、查找新闻、图片或视频时
---

Search instructions.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.whenToUse).toBe('用户需要搜索网页信息、查找新闻、图片或视频时');
    });

    it('应解析 when-to-use 连字符格式', () => {
      const content = `---
name: alt-skill
description: Alt format
when-to-use: When user needs help
---

Body.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.whenToUse).toBe('When user needs help');
    });

    it('应解析 model 字段', () => {
      const content = `---
name: light-skill
description: Lightweight skill
model: openai/gpt-4o-mini
---

Body.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.model).toBe('openai/gpt-4o-mini');
    });

    it('应解析 execution-mode 字段', () => {
      const content = `---
name: fork-skill
description: Fork mode skill
execution-mode: fork
---

Body.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.executionMode).toBe('fork');
    });

    it('应处理带引号的值', () => {
      const content = `---
name: "quoted-skill"
description: 'A quoted description'
---

Body.`;

      const result = parseSkillMd(content);
      expect(result).not.toBeNull();
      expect(result!.metadata.name).toBe('quoted-skill');
      expect(result!.metadata.description).toBe('A quoted description');
    });
  });

  describe('isSkillFile', () => {
    it('应识别 SKILL.md', () => {
      expect(isSkillFile('/path/to/SKILL.md')).toBe(true);
    });

    it('应识别 .md 文件', () => {
      expect(isSkillFile('/path/to/my-skill.md')).toBe(true);
    });

    it('应排除隐藏 .md 文件', () => {
      expect(isSkillFile('/path/to/.hidden.md')).toBe(false);
    });

    it('应排除非 .md 文件', () => {
      expect(isSkillFile('/path/to/script.ts')).toBe(false);
      expect(isSkillFile('/path/to/readme.txt')).toBe(false);
    });
  });
});
