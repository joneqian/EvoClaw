/**
 * 日期工具 — 处理 SQLite UTC 时间字符串的解析与格式化
 *
 * SQLite datetime('now') 返回 "2026-03-19 09:07:55" 格式（UTC），
 * 但没有时区标记，JS 的 new Date() 会按本地时间解析，导致时区偏差。
 */

/** 将 SQLite datetime 字符串（UTC）转为正确的 Date 对象 */
export function parseUtcDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  // 已有时区信息的直接解析
  if (dateStr.endsWith('Z') || dateStr.includes('+') || dateStr.includes('T')) {
    return new Date(dateStr);
  }
  // SQLite 格式补 Z 后缀，按 UTC 解析
  return new Date(dateStr + 'Z');
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期 */
export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = parseUtcDate(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return parseUtcDate(dateStr).toLocaleDateString('zh-CN');
}

/** 短日期时间：MM/DD HH:mm */
export function formatDateTime(dateStr: string): string {
  try {
    return parseUtcDate(dateStr).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/** 仅日期：yyyy/MM/dd */
export function formatDate(dateStr: string): string {
  try {
    return parseUtcDate(dateStr).toLocaleDateString('zh-CN');
  } catch {
    return dateStr;
  }
}
