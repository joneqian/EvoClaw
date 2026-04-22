#!/usr/bin/env node
/**
 * 飞书 WS 连接最小复现脚本
 *
 * 用于判定 "ws connect failed" 是：
 * - Bun 运行时的 ws 模块兼容问题，还是
 * - 飞书服务侧 / 应用配置问题
 *
 * 用法（先 cd 到仓库根）：
 *   # 用 Bun 跑（复现 sidecar 行为）
 *   apps/desktop/src-tauri/bun-bin/bun scripts/feishu-ws-repro.mjs
 *
 *   # 用 Node 跑（对照组）
 *   node scripts/feishu-ws-repro.mjs
 *
 * 所有 SDK 日志会全量打到控制台（trace 级），失败时能看到具体错误事件。
 */

import { WSClient, EventDispatcher, Domain, LoggerLevel } from '@larksuiteoapi/node-sdk';

const APP_ID = process.env.FEISHU_APP_ID || 'cli_a925c1c3e1381cb1';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'rzbONo5JLzG933dwDVhQ4dhksV5WSGY1';

console.log(`运行时: ${typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`}`);
console.log(`AppId: ${APP_ID}`);

// 自定义 logger，全量打印（包括 debug / trace）
const verboseLogger = {
  error: (msgs) => console.error('[ERROR]', ...(Array.isArray(msgs) ? msgs : [msgs])),
  warn: (msgs) => console.warn('[WARN ]', ...(Array.isArray(msgs) ? msgs : [msgs])),
  info: (msgs) => console.info('[INFO ]', ...(Array.isArray(msgs) ? msgs : [msgs])),
  debug: (msgs) => console.log('[DEBUG]', ...(Array.isArray(msgs) ? msgs : [msgs])),
  trace: (msgs) => console.log('[TRACE]', ...(Array.isArray(msgs) ? msgs : [msgs])),
};

const dispatcher = new EventDispatcher({ loggerLevel: LoggerLevel.warn });

const wsClient = new WSClient({
  appId: APP_ID,
  appSecret: APP_SECRET,
  domain: Domain.Feishu,
  loggerLevel: LoggerLevel.trace,
  logger: verboseLogger,
  // 禁用自动重连，让失败暴露得更干净
  autoReconnect: false,
});

// 全局捕获未处理的错误 / ws 实例的 error 事件（SDK 没抓具体 error，补上）
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// 试图 monkey-patch SDK 内部 wsConfig 以捕获 wsInstance 的细节错误。
// SDK 版本不同可能路径不一样，尽力而为。
try {
  const origGetWS = wsClient.wsConfig?.getWS?.bind(wsClient.wsConfig);
  if (origGetWS) {
    wsClient.wsConfig.getWS = (key) => {
      const v = origGetWS(key);
      if (key === 'connectUrl' && v) {
        console.log('[REPRO] SDK 即将连的 WS URL =', v);
      }
      return v;
    };
  }
} catch (e) {
  console.log('[REPRO] monkey-patch 失败，忽略:', e?.message);
}

// 真正的原生 WebSocket 探测 —— 在 SDK 之外独立打一次，看底层能否握手
import('ws').then(async ({ default: WSCtor }) => {
  console.log('\n===== 第 1 步: 直接用原始 URL 走 ws 模块 =====');
  // 先拉一次 ticket
  try {
    const axios = await import('axios');
    const resp = await axios.default.post(
      'https://open.feishu.cn/open-apis/callback/ws/endpoint',
      { AppID: APP_ID, AppSecret: APP_SECRET },
      { headers: { locale: 'zh' }, timeout: 15000 },
    );
    const url = resp.data?.data?.URL;
    console.log('[REPRO] 拿到 WS URL:', url);
    if (url) {
      const rawWs = new WSCtor(url);
      rawWs.on('open', () => {
        console.log('[REPRO] ✅ 原始 WebSocket 握手成功！');
        rawWs.close();
      });
      rawWs.on('error', (err) => {
        console.error('[REPRO] ❌ 原始 WebSocket 握手失败:', err);
        console.error('  err.message =', err?.message);
        console.error('  err.code    =', err?.code);
        console.error('  err.stack   =', err?.stack?.split('\n').slice(0, 5).join('\n'));
      });
      rawWs.on('unexpected-response', (req, res) => {
        console.error('[REPRO] ❌ 服务器意外响应:', res.statusCode, res.statusMessage);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          console.error('  响应体:', Buffer.concat(chunks).toString().slice(0, 500));
        });
      });
    }
  } catch (err) {
    console.error('[REPRO] 拉 ticket 失败:', err?.message);
  }

  // 8 秒后退出
  setTimeout(() => {
    console.log('\n===== 脚本结束 =====');
    process.exit(0);
  }, 8000);
});

console.log('\n===== 第 2 步: 走 SDK WSClient.start() =====');
wsClient.start({ eventDispatcher: dispatcher }).then(() => {
  console.log('[REPRO] WSClient.start() resolved');
}).catch((err) => {
  console.error('[REPRO] WSClient.start() rejected:', err);
});
