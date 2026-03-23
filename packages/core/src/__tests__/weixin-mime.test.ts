import { describe, it, expect } from 'vitest';
import {
  getMimeFromFilename,
  getExtensionFromMime,
  getMediaItemType,
} from '../channel/adapters/weixin-mime.js';

describe('getMimeFromFilename', () => {
  it('应识别常见图片格式', () => {
    expect(getMimeFromFilename('photo.jpg')).toBe('image/jpeg');
    expect(getMimeFromFilename('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeFromFilename('icon.png')).toBe('image/png');
    expect(getMimeFromFilename('anim.gif')).toBe('image/gif');
    expect(getMimeFromFilename('photo.webp')).toBe('image/webp');
  });

  it('应识别常见视频格式', () => {
    expect(getMimeFromFilename('video.mp4')).toBe('video/mp4');
    expect(getMimeFromFilename('clip.mov')).toBe('video/quicktime');
    expect(getMimeFromFilename('stream.webm')).toBe('video/webm');
  });

  it('应识别常见音频格式', () => {
    expect(getMimeFromFilename('song.mp3')).toBe('audio/mpeg');
    expect(getMimeFromFilename('voice.silk')).toBe('audio/silk');
    expect(getMimeFromFilename('audio.wav')).toBe('audio/wav');
  });

  it('应识别常见文档格式', () => {
    expect(getMimeFromFilename('doc.pdf')).toBe('application/pdf');
    expect(getMimeFromFilename('sheet.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(getMimeFromFilename('note.txt')).toBe('text/plain');
  });

  it('大小写不敏感', () => {
    expect(getMimeFromFilename('Photo.JPG')).toBe('image/jpeg');
    expect(getMimeFromFilename('VIDEO.MP4')).toBe('video/mp4');
  });

  it('无扩展名应返回 octet-stream', () => {
    expect(getMimeFromFilename('noext')).toBe('application/octet-stream');
  });

  it('未知扩展名应返回 octet-stream', () => {
    expect(getMimeFromFilename('file.xyz')).toBe('application/octet-stream');
  });
});

describe('getExtensionFromMime', () => {
  it('应返回正确的扩展名', () => {
    expect(getExtensionFromMime('image/jpeg')).toBe('.jpg');
    expect(getExtensionFromMime('video/mp4')).toBe('.mp4');
    expect(getExtensionFromMime('application/pdf')).toBe('.pdf');
  });

  it('未知 MIME 应返回 .bin', () => {
    expect(getExtensionFromMime('application/unknown')).toBe('.bin');
  });
});

describe('getMediaItemType', () => {
  it('image/* → IMAGE(2)', () => {
    expect(getMediaItemType('image/jpeg')).toBe(2);
    expect(getMediaItemType('image/png')).toBe(2);
  });

  it('video/* → VIDEO(5)', () => {
    expect(getMediaItemType('video/mp4')).toBe(5);
  });

  it('其他 → FILE(4)', () => {
    expect(getMediaItemType('application/pdf')).toBe(4);
    expect(getMediaItemType('audio/mpeg')).toBe(4);
    expect(getMediaItemType('text/plain')).toBe(4);
  });
});
