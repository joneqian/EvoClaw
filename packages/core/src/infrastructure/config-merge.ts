/**
 * 配置合并工具 — 多层配置 deep merge + enforced 强制回写
 *
 * 合并优先级（低→高）: managed.json → config.d/*.json → 用户配置
 * enforced 字段：managed.json 中标记的路径强制使用 managed 的值
 * denylist 特殊处理：始终取并集（安全策略只增不减）
 */

/** 深度合并两个对象（overlay 覆盖 base） */
export function deepMerge<T extends Record<string, unknown>>(base: T, overlay: Partial<T>): T {
  const result = { ...base };

  for (const key of Object.keys(overlay) as Array<keyof T>) {
    const baseVal = base[key];
    const overlayVal = overlay[key];

    if (overlayVal === undefined) continue;

    // denylist 特殊处理：取并集
    if (key === 'denylist' && Array.isArray(baseVal) && Array.isArray(overlayVal)) {
      result[key] = [...new Set([...baseVal, ...overlayVal])] as T[keyof T];
      continue;
    }

    // 两者都是普通对象 → 递归合并
    if (isPlainObject(baseVal) && isPlainObject(overlayVal)) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overlayVal as Record<string, unknown>,
      ) as T[keyof T];
      continue;
    }

    // 其他情况：overlay 直接覆盖（含数组直接替换）
    result[key] = overlayVal as T[keyof T];
  }

  return result;
}

/**
 * 将 enforced 路径的值从 managed 强制回写到 merged
 *
 * @param merged 合并后的配置
 * @param managed 管理员配置（包含强制值）
 * @param enforcedPaths enforced 路径列表（如 ["security.skills.denylist"]）
 */
export function applyEnforced(
  merged: Record<string, unknown>,
  managed: Record<string, unknown>,
  enforcedPaths: string[],
): void {
  for (const path of enforcedPaths) {
    const value = getValueByPath(managed, path);
    if (value !== undefined) {
      setValueByPath(merged, path, value);
    }
  }
}

/** 通过点号路径读取嵌套值 */
export function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/** 通过点号路径设置嵌套值（自动创建中间对象） */
export function setValueByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

/** 合并多个配置层（按数组顺序，后者覆盖前者） */
export function mergeLayers(...layers: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
  let result: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer) {
      result = deepMerge(result, layer);
    }
  }
  return result;
}

/** 判断是否为普通对象（非数组、非 null） */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}
