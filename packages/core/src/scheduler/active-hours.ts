/** 默认活跃时段 */
export const DEFAULT_ACTIVE_HOURS = { start: '08:00', end: '22:00' };

/**
 * 检查当前时间是否在活跃时段内
 * 支持跨午夜（如 start='22:00', end='06:00'）
 *
 * @param config 活跃时段配置（HH:MM 格式）
 * @param now 当前时间（默认 new Date()），用于测试注入
 */
export function isInActiveHours(
  config: { start: string; end: string } = DEFAULT_ACTIVE_HOURS,
  now: Date = new Date(),
): boolean {
  const [startH, startM] = config.start.split(':').map(Number);
  const [endH, endM] = config.end.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes <= endMinutes) {
    // 非跨午夜：08:00 - 22:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // 跨午夜：22:00 - 06:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
