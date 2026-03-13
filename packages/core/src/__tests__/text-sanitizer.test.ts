import { describe, it, expect } from 'vitest';
import {
  MARKERS,
  sanitizeForExtraction,
  wrapMemoryContext,
  wrapRAGContext,
  containsCJK,
} from '../memory/text-sanitizer.js';

describe('TextSanitizer', () => {
  // ---------- MARKERS ----------

  describe('MARKERS', () => {
    it('应该包含零宽空格字符', () => {
      // 每个 marker 都应包含零宽空格 (\u200B) 和零宽非连接符 (\u200C)
      for (const value of Object.values(MARKERS)) {
        expect(value).toContain('\u200B');
        expect(value).toContain('\u200C');
      }
    });

    it('四个 marker 的值应各不相同', () => {
      const values = Object.values(MARKERS);
      const unique = new Set(values);
      expect(unique.size).toBe(4);
    });
  });

  // ---------- sanitizeForExtraction ----------

  describe('sanitizeForExtraction', () => {
    it('应该剥离记忆标记及其中间内容', () => {
      const text = `你好世界${MARKERS.EVOCLAW_MEM_START}这段是注入的记忆上下文${MARKERS.EVOCLAW_MEM_END}这是正常内容不应被剥离`;
      const result = sanitizeForExtraction(text);
      expect(result).not.toContain('注入的记忆上下文');
      expect(result).toContain('这是正常内容不应被剥离');
    });

    it('应该剥离 RAG 标记及其中间内容', () => {
      const text = `一些前文${MARKERS.EVOCLAW_RAG_START}RAG 检索到的文档片段${MARKERS.EVOCLAW_RAG_END}一些后文内容`;
      const result = sanitizeForExtraction(text);
      expect(result).not.toContain('RAG 检索到的文档片段');
      expect(result).toContain('一些前文');
      expect(result).toContain('一些后文内容');
    });

    it('应该剥离包含 _evoclaw_meta 的 JSON 块', () => {
      const text = '这是正常文本\n{"_evoclaw_meta": true, "version": 1}\n继续正常文本';
      const result = sanitizeForExtraction(text);
      expect(result).not.toContain('_evoclaw_meta');
      expect(result).toContain('这是正常文本');
      expect(result).toContain('继续正常文本');
    });

    it('应该过滤以 / 开头的命令行', () => {
      const text = '第一行是正常内容\n/command arg1 arg2\n第三行也是正常内容';
      const result = sanitizeForExtraction(text);
      expect(result).not.toContain('/command');
      expect(result).toContain('第一行是正常内容');
      expect(result).toContain('第三行也是正常内容');
    });

    it('非 CJK 文本少于 10 个字符时应返回 null', () => {
      // 9 个字符 — 不够长
      expect(sanitizeForExtraction('short txt')).toBeNull();
    });

    it('CJK 文本少于 4 个字符时应返回 null', () => {
      expect(sanitizeForExtraction('你好')).toBeNull(); // 2 字符
      expect(sanitizeForExtraction('你好世')).toBeNull(); // 3 字符
    });

    it('CJK 文本 >= 4 个字符应正常返回', () => {
      const result = sanitizeForExtraction('你好世界');
      expect(result).toBe('你好世界');
    });

    it('超过 24000 字符应被截断', () => {
      const longText = '这'.repeat(25_000);
      const result = sanitizeForExtraction(longText);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(24_000);
    });

    it('应该处理连续多个标记对', () => {
      // 多个独立的标记对应被逐一剥离
      const block1 = `${MARKERS.EVOCLAW_MEM_START}第一段记忆${MARKERS.EVOCLAW_MEM_END}`;
      const block2 = `${MARKERS.EVOCLAW_MEM_START}第二段记忆${MARKERS.EVOCLAW_MEM_END}`;
      const text = `前文${block1}中间文本${block2}后文内容`;
      const result = sanitizeForExtraction(text);
      expect(result).not.toContain('第一段记忆');
      expect(result).not.toContain('第二段记忆');
      expect(result).toContain('前文');
      expect(result).toContain('中间文本');
      expect(result).toContain('后文内容');
    });

    it('空输入应返回 null', () => {
      expect(sanitizeForExtraction('')).toBeNull();
    });

    it('只有空白的输入应返回 null', () => {
      expect(sanitizeForExtraction('   \n\n  ')).toBeNull();
    });

    it('应该合并连续多个空行', () => {
      const text = '第一段内容\n\n\n\n\n第二段内容';
      const result = sanitizeForExtraction(text);
      expect(result).not.toBeNull();
      // 最多保留 2 个换行
      expect(result).not.toContain('\n\n\n');
      expect(result).toContain('第一段内容\n\n第二段内容');
    });
  });

  // ---------- wrapMemoryContext / wrapRAGContext ----------

  describe('wrapMemoryContext', () => {
    it('应该用记忆标记包裹内容', () => {
      const content = '这是一段记忆';
      const wrapped = wrapMemoryContext(content);
      expect(wrapped).toBe(`${MARKERS.EVOCLAW_MEM_START}${content}${MARKERS.EVOCLAW_MEM_END}`);
    });

    it('包裹后的内容应该被 sanitizeForExtraction 完全剥离', () => {
      const wrapped = wrapMemoryContext('被注入的记忆内容');
      const cleaned = sanitizeForExtraction(`正常文本内容${wrapped}正常文本尾部`);
      expect(cleaned).not.toContain('被注入的记忆内容');
      expect(cleaned).toContain('正常文本内容');
    });
  });

  describe('wrapRAGContext', () => {
    it('应该用 RAG 标记包裹内容', () => {
      const content = '这是 RAG 上下文';
      const wrapped = wrapRAGContext(content);
      expect(wrapped).toBe(`${MARKERS.EVOCLAW_RAG_START}${content}${MARKERS.EVOCLAW_RAG_END}`);
    });

    it('包裹后的内容应该被 sanitizeForExtraction 完全剥离', () => {
      const wrapped = wrapRAGContext('检索到的文档片段');
      const cleaned = sanitizeForExtraction(`正常对话${wrapped}对话继续`);
      expect(cleaned).not.toContain('检索到的文档片段');
      expect(cleaned).toContain('正常对话');
    });
  });

  // ---------- containsCJK ----------

  describe('containsCJK', () => {
    it('纯中文应返回 true', () => {
      expect(containsCJK('你好世界')).toBe(true);
    });

    it('混合中英文应返回 true', () => {
      expect(containsCJK('Hello 你好')).toBe(true);
    });

    it('纯英文应返回 false', () => {
      expect(containsCJK('Hello World')).toBe(false);
    });

    it('空字符串应返回 false', () => {
      expect(containsCJK('')).toBe(false);
    });

    it('日文汉字应返回 true', () => {
      // 日文汉字在 CJK Unified Ideographs 范围内
      expect(containsCJK('漢字')).toBe(true);
    });
  });
});
