/**
 * PR2 Phase C 测试：content 解析 + Post 转换 + Markdown 渲染
 */

import { describe, it, expect } from 'vitest';
import { parseFeishuContent } from '../../channel/adapters/feishu/parse-content.js';
import {
  parsePostContent,
  postPayloadToText,
} from '../../channel/adapters/feishu/post-to-text.js';
import {
  buildPostPayload,
  looksLikeMarkdown,
  serializePostContent,
} from '../../channel/adapters/feishu/markdown-to-post.js';

// ─── parseFeishuContent ──────────────────────────────────────────────────

describe('parseFeishuContent', () => {
  it('text 提取 text 字段', () => {
    const r = parseFeishuContent('text', '{"text":"你好"}');
    expect(r.text).toBe('你好');
    expect(r.mediaKey).toBeUndefined();
  });

  it('text 非 JSON 时原样返回', () => {
    const r = parseFeishuContent('text', '纯文本');
    expect(r.text).toBe('纯文本');
  });

  it('post 转为纯文本', () => {
    const content = JSON.stringify({
      zh_cn: {
        title: '标题',
        content: [
          [{ tag: 'text', text: '第一行' }],
          [{ tag: 'a', text: '链接', href: 'https://x.com' }],
        ],
      },
    });
    const r = parseFeishuContent('post', content);
    expect(r.text).toContain('标题');
    expect(r.text).toContain('第一行');
    expect(r.text).toContain('[链接](https://x.com)');
  });

  it('image 提取 image_key + 标注文本', () => {
    const r = parseFeishuContent('image', '{"image_key":"img_abc"}');
    expect(r.text).toBe('[图片]');
    expect(r.mediaKey).toBe('img_abc');
    expect(r.mediaSource).toBe('image');
  });

  it('file 提取 file_key + 文件名标注', () => {
    const r = parseFeishuContent(
      'file',
      '{"file_key":"file_x","file_name":"a.pdf"}',
    );
    expect(r.text).toBe('[文件: a.pdf]');
    expect(r.mediaKey).toBe('file_x');
    expect(r.mediaSource).toBe('file');
    expect(r.fileName).toBe('a.pdf');
  });

  it('audio 标注时长', () => {
    const r = parseFeishuContent('audio', '{"file_key":"f","duration":3500}');
    expect(r.text).toBe('[语音, 3500ms]');
    expect(r.mediaSource).toBe('file');
  });

  it('media (video) 标注文件名', () => {
    const r = parseFeishuContent(
      'media',
      '{"file_key":"f","file_name":"x.mp4"}',
    );
    expect(r.text).toContain('x.mp4');
    expect(r.mediaKey).toBe('f');
  });

  it('sticker 保留 file_key', () => {
    const r = parseFeishuContent('sticker', '{"file_key":"s_1"}');
    expect(r.text).toBe('[贴纸]');
    expect(r.mediaKey).toBe('s_1');
  });

  it('interactive 标题', () => {
    const r = parseFeishuContent('interactive', '{"title":"审批"}');
    expect(r.text).toContain('交互卡片');
    expect(r.text).toContain('审批');
    expect(r.mediaKey).toBeUndefined();
  });

  it('merge_forward 标注条数', () => {
    const r = parseFeishuContent('merge_forward', '{"content":[1,2,3]}');
    expect(r.text).toBe('[合并转发，3 条]');
  });

  it('share_chat 保留 chat_id', () => {
    const r = parseFeishuContent('share_chat', '{"chat_id":"oc_x"}');
    expect(r.text).toBe('[分享群: oc_x]');
  });

  it('未知 msg_type 降级为原始 content', () => {
    const r = parseFeishuContent('exotic', '{"a":1}');
    expect(r.text).toContain('[exotic]');
    expect(r.text).toContain('"a":1');
  });

  it('损坏的 JSON 不崩溃', () => {
    const r = parseFeishuContent('image', 'not-json');
    expect(r.text).toBe('[图片]');
    expect(r.mediaKey).toBeUndefined();
  });
});

// ─── Post → 纯文本 ────────────────────────────────────────────────────────

describe('postPayloadToText', () => {
  it('空 payload 返回空', () => {
    expect(postPayloadToText({})).toBe('');
  });

  it('只选一个语言（优先 zh_cn）', () => {
    const text = postPayloadToText({
      zh_cn: { title: '中', content: [[{ tag: 'text', text: '中文' }]] },
      en_us: { title: 'EN', content: [[{ tag: 'text', text: 'english' }]] },
    });
    expect(text).toContain('中');
    expect(text).not.toContain('english');
  });

  it('支持 at / img / emotion / code_block / hr 元素', () => {
    const text = postPayloadToText({
      zh_cn: {
        content: [
          [{ tag: 'at', user_name: 'Alice' }],
          [{ tag: 'img', image_key: 'img_1' }],
          [{ tag: 'emotion', emoji_type: 'LAUGH' }],
          [{ tag: 'code_block', text: 'hello' }],
          [{ tag: 'hr' }],
        ],
      },
    });
    expect(text).toContain('@Alice');
    expect(text).toContain('[图片:img_1]');
    expect(text).toContain('[表情:LAUGH]');
    expect(text).toContain('```\nhello\n```');
    expect(text).toContain('---');
  });

  it('parsePostContent 解析 JSON 字符串', () => {
    const input = JSON.stringify({
      zh_cn: { content: [[{ tag: 'text', text: 'hi' }]] },
    });
    expect(parsePostContent(input)).toBe('hi');
  });

  it('parsePostContent 失败时降级原样返回', () => {
    expect(parsePostContent('not-json')).toBe('not-json');
  });
});

// ─── Markdown → Post ─────────────────────────────────────────────────────

describe('Markdown → Post 构造', () => {
  it('looksLikeMarkdown 识别 bold/code/list 特征', () => {
    expect(looksLikeMarkdown('普通文本')).toBe(false);
    expect(looksLikeMarkdown('**加粗**')).toBe(true);
    expect(looksLikeMarkdown('`code`')).toBe(true);
    expect(looksLikeMarkdown('- 列表项')).toBe(true);
    expect(looksLikeMarkdown('1. 有序列表')).toBe(true);
    expect(looksLikeMarkdown('# 标题')).toBe(true);
    expect(looksLikeMarkdown('> 引用')).toBe(true);
    expect(looksLikeMarkdown('[链接](https://x.com)')).toBe(true);
  });

  it('buildPostPayload 保留代码块', () => {
    const payload = buildPostPayload('说明\n```\nconst x = 1;\n```\n完');
    const rows = payload.zh_cn.content;
    expect(rows).toHaveLength(3);
    // 代码块行
    const codeRow = rows[1]!;
    expect(codeRow[0]!.tag).toBe('code_block');
    expect(codeRow[0]!.text).toContain('const x = 1;');
  });

  it('buildPostPayload 链接解析为 a 元素', () => {
    const payload = buildPostPayload('访问 [主页](https://x.com) 了解');
    const row = payload.zh_cn.content[0]!;
    const link = row.find((el) => el.tag === 'a');
    expect(link?.href).toBe('https://x.com');
    expect(link?.text).toBe('主页');
  });

  it('buildPostPayload 多行保留每行作为独立 row', () => {
    const payload = buildPostPayload('第一行\n第二行\n第三行');
    expect(payload.zh_cn.content).toHaveLength(3);
  });

  it('buildPostPayload 空字符串返回空 row', () => {
    const payload = buildPostPayload('');
    expect(payload.zh_cn.content).toEqual([[{ tag: 'text', text: '' }]]);
  });

  it('带 title 的 payload', () => {
    const payload = buildPostPayload('正文', '我的标题');
    expect(payload.zh_cn.title).toBe('我的标题');
  });

  it('serializePostContent 输出 JSON 字符串', () => {
    const payload = buildPostPayload('hi');
    const str = serializePostContent(payload);
    expect(() => JSON.parse(str)).not.toThrow();
    expect(JSON.parse(str)).toEqual(payload);
  });

  it('未闭合代码围栏吞到 EOF', () => {
    const payload = buildPostPayload('```\nunfinished');
    const codeRow = payload.zh_cn.content[0]!;
    expect(codeRow[0]!.tag).toBe('code_block');
    expect(codeRow[0]!.text).toBe('unfinished');
  });
});
