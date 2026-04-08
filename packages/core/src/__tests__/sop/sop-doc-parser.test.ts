import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  parseDocToText,
  inferExtension,
  SUPPORTED_EXTENSIONS,
} from '../../sop/sop-doc-parser.js';

describe('SOP 文档解析', () => {
  let tmpDir: string;
  let mdPath: string;
  let xlsxPath: string;
  let docxPath: string;

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `sop-parser-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Markdown fixture
    mdPath = path.join(tmpDir, 'sample.md');
    fs.writeFileSync(
      mdPath,
      '# SOP 客户服务流程\n\n## 咨询阶段\n\n首次接触客户时需要礼貌问候。',
    );

    // XLSX fixture — 用 xlsx 库生成最简表格
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['阶段', '说明'],
      ['咨询', '首次沟通'],
      ['跟进', '定期回访'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SOP');
    xlsxPath = path.join(tmpDir, 'sample.xlsx');
    XLSX.writeFile(wb, xlsxPath);

    // DOCX fixture — mammoth 解析需要真实 docx ZIP 结构
    // 使用 minimal docx 字节流（内含 "测试文档内容"）
    docxPath = path.join(tmpDir, 'sample.docx');
    await createMinimalDocx(docxPath, 'SOP 流程测试文档');
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  });

  describe('inferExtension', () => {
    it('识别 .md', () => {
      expect(inferExtension('foo.md')).toBe('md');
      expect(inferExtension('path/to/Foo.MD')).toBe('md');
    });

    it('识别 .markdown 映射为 md', () => {
      expect(inferExtension('foo.markdown')).toBe('md');
    });

    it('识别 .docx', () => {
      expect(inferExtension('foo.docx')).toBe('docx');
    });

    it('识别 .xlsx', () => {
      expect(inferExtension('foo.xlsx')).toBe('xlsx');
    });

    it('不支持的后缀返回 null', () => {
      expect(inferExtension('foo.pdf')).toBeNull();
      expect(inferExtension('foo')).toBeNull();
    });
  });

  describe('SUPPORTED_EXTENSIONS', () => {
    it('包含 md/docx/xlsx', () => {
      expect(SUPPORTED_EXTENSIONS).toContain('md');
      expect(SUPPORTED_EXTENSIONS).toContain('docx');
      expect(SUPPORTED_EXTENSIONS).toContain('xlsx');
    });
  });

  describe('parseDocToText', () => {
    it('解析 markdown 文件返回原内容', async () => {
      const text = await parseDocToText(mdPath, 'md');
      expect(text).toContain('SOP 客户服务流程');
      expect(text).toContain('咨询阶段');
    });

    it('解析 xlsx 文件返回表格文本', async () => {
      const text = await parseDocToText(xlsxPath, 'xlsx');
      expect(text).toContain('咨询');
      expect(text).toContain('首次沟通');
      expect(text).toContain('跟进');
    });

    it('解析 docx 文件返回正文文本', async () => {
      const text = await parseDocToText(docxPath, 'docx');
      expect(text).toContain('SOP 流程测试文档');
    });

    it('不存在的文件抛错', async () => {
      await expect(parseDocToText('/nonexistent/file.md', 'md')).rejects.toThrow();
    });

    it('不支持的扩展抛错', async () => {
      await expect(
        parseDocToText(mdPath, 'pdf' as 'md'),
      ).rejects.toThrow(/不支持/);
    });
  });
});

/**
 * 创建最小可解析 DOCX 文件（含指定文本）
 * DOCX 是 ZIP 归档；使用 xlsx 库创建不行，必须手搓 OOXML 结构。
 * 这里用 mammoth 反向 — 不可行。改用另一种最简方法：
 *
 * 方案：用 Node 内置 zlib + 最小 OOXML 骨架生成 docx。
 * 真实场景下 fixture 应该是 git 里固定的 docx 文件，但本测试为避免二进制提交，
 * 运行时生成。
 */
async function createMinimalDocx(filePath: string, text: string): Promise<void> {
  const { default: JSZip } = await importJSZip();
  const zip = new JSZip();

  // [Content_Types].xml
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );

  // _rels/.rels
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  // word/document.xml
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(filePath, buffer);
}

/** mammoth 依赖内部带 JSZip，测试里间接用它 — 通过 mammoth 转发引入 */
async function importJSZip(): Promise<{ default: any }> {
  // mammoth 将 jszip 作为依赖，我们直接复用
  return import('jszip') as Promise<{ default: any }>;
}
