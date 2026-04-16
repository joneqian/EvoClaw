import { describe, it, expect } from 'vitest';
import { splitDocument, detectDocumentType } from '../rag/chunk-splitter.js';

describe('splitDocument', () => {
  // ---------- Markdown ----------

  it('markdown 应按 ## 标题切分', () => {
    const content = `# Title

Intro paragraph.

## Section A

${'Content for section A. This is some text. '.repeat(20)}

## Section B

${'Content for section B. Different details here. '.repeat(20)}
`;
    const chunks = splitDocument(content, 'markdown', { minTokens: 1, maxTokens: 200 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].metadata.heading).toBeDefined();
  });

  it('markdown 单节超过 maxTokens 应强制分割', () => {
    // 生成一个很长的 section
    const longContent = '## Big Section\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(200);
    const chunks = splitDocument(longContent, 'markdown', { minTokens: 1, maxTokens: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    // 每块不应超过 maxTokens 太多（强制分割有一定行粒度误差）
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });

  it('markdown 空内容应返回空数组', () => {
    expect(splitDocument('', 'markdown')).toEqual([]);
    expect(splitDocument('   ', 'markdown')).toEqual([]);
  });

  // ---------- Text ----------

  it('text 应按段落切分', () => {
    const content = `First paragraph content.

Second paragraph content.

Third paragraph content.`;
    const chunks = splitDocument(content, 'text', { minTokens: 1, maxTokens: 1000 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain('First paragraph');
  });

  it('text 小段落应合并', () => {
    const content = 'Short line.\n\nAnother short line.\n\nThird one.';
    const chunks = splitDocument(content, 'text', { minTokens: 50, maxTokens: 1000 });
    // 三个短段落应合并为一块
    expect(chunks.length).toBe(1);
  });

  // ---------- Code ----------

  it('code 应按函数/类声明切分', () => {
    // 每个函数/类体积足够大，避免因 minTokens 合并
    const content = `import fs from 'fs';

function hello() {
  ${'console.log("hello world this is a long line of code for testing");\n  '.repeat(10)}
}

export class World {
  ${'greet() { return "world"; }\n  '.repeat(10)}
}`;
    const chunks = splitDocument(content, 'code', { minTokens: 1, maxTokens: 100 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('code 应检测语言', () => {
    const tsContent = `import { something } from './module';

export function handler() {
  return true;
}`;
    const chunks = splitDocument(tsContent, 'code', { minTokens: 1, maxTokens: 1000 });
    expect(chunks[0].metadata.language).toBe('typescript');
  });

  // ---------- PDF (treated as text) ----------

  it('pdf 类型应使用文本分块策略', () => {
    const content = 'Page 1 content.\n\nPage 2 content.';
    const chunks = splitDocument(content, 'pdf', { minTokens: 1, maxTokens: 1000 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  // ---------- Token 控制 ----------

  it('每块应有 tokenCount 字段', () => {
    const content = '## Section\n\nSome content here.';
    const chunks = splitDocument(content, 'markdown', { minTokens: 1, maxTokens: 1000 });
    for (const chunk of chunks) {
      expect(typeof chunk.tokenCount).toBe('number');
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('中文内容应正确估算 token', () => {
    const content = '## 中文标题\n\n这是一段中文内容，用于测试分块器对中文的支持。';
    const chunks = splitDocument(content, 'markdown', { minTokens: 1, maxTokens: 1000 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  // ---------- 元数据 ----------

  it('markdown 块应包含 lineStart 和 lineEnd 元数据', () => {
    const content = '## A\n\nLine 1\nLine 2\n\n## B\n\nLine 3';
    const chunks = splitDocument(content, 'markdown', { minTokens: 1, maxTokens: 1000 });
    for (const chunk of chunks) {
      expect(chunk.metadata.lineStart).toBeDefined();
      expect(chunk.metadata.lineEnd).toBeDefined();
    }
  });
});

describe('detectDocumentType', () => {
  it('应正确检测 markdown 文件', () => {
    expect(detectDocumentType('README.md')).toBe('markdown');
    expect(detectDocumentType('doc.mdx')).toBe('markdown');
  });

  it('应正确检测代码文件', () => {
    expect(detectDocumentType('app.ts')).toBe('code');
    expect(detectDocumentType('main.py')).toBe('code');
    expect(detectDocumentType('lib.rs')).toBe('code');
    expect(detectDocumentType('server.go')).toBe('code');
  });

  it('应正确检测 PDF 文件', () => {
    expect(detectDocumentType('report.pdf')).toBe('pdf');
  });

  it('未知扩展名应回退为 text', () => {
    expect(detectDocumentType('data.csv')).toBe('text');
    expect(detectDocumentType('notes.txt')).toBe('text');
  });
});
