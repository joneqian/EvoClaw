// Pure helpers for brand-apply 的 release 字段注入 + 环境变量占位符解析。
//
// 占位符语法: "${ENV_VAR_NAME}" — 运行时用 process.env 替换。
// 未解析的占位符会带上 UNSET sentinel，触发"跳过整个 release 字段"逻辑，
// 避免把 "${MISSING}" 字面量写到 tauri.conf.json 里污染构建。

export const UNSET = '__BRAND_APPLY_UNSET__';

const PLACEHOLDER_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export function resolveEnv(value, env) {
  if (typeof value !== 'string') return value;
  if (!PLACEHOLDER_RE.test(value)) return value;
  PLACEHOLDER_RE.lastIndex = 0;
  return value.replace(PLACEHOLDER_RE, (_, name) => {
    const v = env[name];
    if (v == null || v === '') return UNSET;
    return v;
  });
}

export function resolveDeep(value, env) {
  if (typeof value === 'string') return resolveEnv(value, env);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, env));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveDeep(v, env);
    }
    return out;
  }
  return value;
}

export function hasUnset(value) {
  if (typeof value === 'string') return value.includes(UNSET);
  if (Array.isArray(value)) return value.some(hasUnset);
  if (value && typeof value === 'object') return Object.values(value).some(hasUnset);
  return false;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function setIfResolved(target, key, resolved) {
  if (resolved == null || hasUnset(resolved)) return false;
  target[key] = resolved;
  return true;
}

/**
 * 把 brand.json.release 的字段合并进 tauri.conf.json。
 * 占位符解析失败的字段整体跳过，保持 tauri.conf 不污染。
 *
 * @param {object} tauriConf  原 tauri.conf.json 解析后的对象
 * @param {object} release    brand.json.release
 * @param {Record<string, string|undefined>} env  process.env
 * @returns {object}          新 tauriConf（不修改输入）
 */
export function applyRelease(tauriConf, release, env) {
  const next = clone(tauriConf);
  if (!release || typeof release !== 'object') return next;

  // Pass 1 — 删除 release schema 声明的所有字段（保证幂等：未设置 env 的字段不会残留）
  next.bundle = next.bundle || {};
  next.plugins = next.plugins || {};
  if (release.macOS && typeof release.macOS === 'object') {
    next.bundle.macOS = next.bundle.macOS || {};
    for (const key of Object.keys(release.macOS)) {
      delete next.bundle.macOS[key];
    }
  }
  if (release.windows && typeof release.windows === 'object') {
    delete next.bundle.windows;
  }
  if (release.updater && typeof release.updater === 'object') {
    delete next.plugins.updater;
  }

  // Pass 2 — 解析占位符并注入（值未解析则该字段被跳过）
  const resolved = resolveDeep(release, env);

  if (resolved.macOS && typeof resolved.macOS === 'object') {
    for (const key of Object.keys(release.macOS)) {
      setIfResolved(next.bundle.macOS, key, resolved.macOS[key]);
    }
  }

  if (resolved.windows && typeof resolved.windows === 'object') {
    const windows = {};
    for (const key of Object.keys(release.windows)) {
      setIfResolved(windows, key, resolved.windows[key]);
    }
    // 必须至少有 certificateThumbprint 才建 windows 块（digestAlgorithm 无证书时无意义）
    if (windows.certificateThumbprint) {
      next.bundle.windows = windows;
    }
  }

  if (resolved.updater && typeof resolved.updater === 'object') {
    const { endpoints, pubkey } = resolved.updater;
    const endpointsOk = Array.isArray(endpoints) && endpoints.length > 0 && !hasUnset(endpoints);
    const pubkeyOk = typeof pubkey === 'string' && !hasUnset(pubkey);
    if (endpointsOk && pubkeyOk) {
      next.plugins.updater = { endpoints, pubkey };
    }
  }

  return next;
}
