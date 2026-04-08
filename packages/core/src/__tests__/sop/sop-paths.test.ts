import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  getSopRoot,
  getDocsDir,
  getDocsIndexFile,
  getTagsFile,
  getDraftFile,
} from '../../sop/sop-paths.js';

describe('SOP paths', () => {
  const base = '/tmp/evoclaw-sop-test';

  it('getSopRoot 返回 base 下的 sop 目录', () => {
    expect(getSopRoot(base)).toBe(path.join(base, 'sop'));
  });

  it('getDocsDir 返回 sop/docs', () => {
    expect(getDocsDir(base)).toBe(path.join(base, 'sop', 'docs'));
  });

  it('getDocsIndexFile 返回 sop/docs/index.json', () => {
    expect(getDocsIndexFile(base)).toBe(
      path.join(base, 'sop', 'docs', 'index.json'),
    );
  });

  it('getTagsFile 返回 sop/tags.json', () => {
    expect(getTagsFile(base)).toBe(path.join(base, 'sop', 'tags.json'));
  });

  it('getDraftFile 返回 sop/draft.json', () => {
    expect(getDraftFile(base)).toBe(path.join(base, 'sop', 'draft.json'));
  });

  it('不传 base 时使用默认数据目录', () => {
    const root = getSopRoot();
    expect(root.endsWith(path.join('sop'))).toBe(true);
    expect(path.isAbsolute(root)).toBe(true);
  });
});
