/**
 * 飞书 SDK Client / WSClient / EventDispatcher 工厂
 *
 * 薄封装，便于测试时用 mock 替换 SDK。
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuCredentials } from './config.js';
import type { FeishuSdkLogger } from './ws-logger.js';

/** SDK 客户端集合 */
export interface FeishuSdkBundle {
  client: Lark.Client;
  wsClient: Lark.WSClient;
  dispatcher: Lark.EventDispatcher;
}

/** createFeishuSdkBundle 可选入参 */
export interface FeishuSdkBundleOptions {
  sdk?: FeishuSdk;
  /**
   * 自定义 WSClient logger（SDK 兼容接口）
   *
   * 传入后，WSClient 内部所有 `[ws] ...` 日志会走这个 logger 而非 console，
   * adapter 可据此观察运行期 WS 状态（连接/断开/重连）。
   */
  wsLogger?: FeishuSdkLogger;
  /**
   * WSClient 日志级别（默认 debug）
   *
   * 调 debug 是必要的 —— SDK 把关键诊断信息（`get connect config success, ws url: ...` /
   * `client closed` / `reconnect success`）都放在 debug 级别。info 级会错过这些，
   * 导致 WS 握手失败时排查完全没线索。debug 级的额外噪声（trace 级 ping 不包含）
   * 可接受。
   */
  wsLoggerLevel?: Lark.LoggerLevel;
}

/** SDK 注入点（测试时覆盖） */
export interface FeishuSdk {
  Client: typeof Lark.Client;
  WSClient: typeof Lark.WSClient;
  EventDispatcher: typeof Lark.EventDispatcher;
  Domain: typeof Lark.Domain;
  LoggerLevel: typeof Lark.LoggerLevel;
}

const defaultSdk: FeishuSdk = {
  Client: Lark.Client,
  WSClient: Lark.WSClient,
  EventDispatcher: Lark.EventDispatcher,
  Domain: Lark.Domain,
  LoggerLevel: Lark.LoggerLevel,
};

/**
 * 根据凭据创建完整的 SDK 套件（Client + WSClient + Dispatcher）
 *
 * Domain 硬编码为 Feishu（中国）。产品当前不对接海外 Lark。
 * 注意：此函数不启动 WS 连接，由调用方调用 wsClient.start()
 */
export function createFeishuSdkBundle(
  credentials: FeishuCredentials,
  options: FeishuSdkBundleOptions = {},
): FeishuSdkBundle {
  const sdk = options.sdk ?? defaultSdk;
  const domain = sdk.Domain.Feishu;

  const client = new sdk.Client({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain,
    loggerLevel: sdk.LoggerLevel.warn,
  });

  type WsClientParams = ConstructorParameters<typeof Lark.WSClient>[0];
  const wsClientParams = {
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain,
    // WSClient 默认 debug —— SDK 把 ws url、client closed、reconnect success 等关键
    // 诊断信息放在 debug 级别。上线产品排查 WS 问题必须能看到这些，info 级会漏掉。
    loggerLevel: options.wsLoggerLevel ?? sdk.LoggerLevel.debug,
    // SDK WSClient 构造函数接受 `logger` 参数（见 node-sdk lib/index.js class WSClient），
    // 但 TS 类型定义未导出；用类型断言传入。SDK logger 接口为 `{error/warn/info/debug/trace}`
    ...(options.wsLogger ? { logger: options.wsLogger } : {}),
  } as unknown as WsClientParams;
  const wsClient = new sdk.WSClient(wsClientParams);

  const dispatcher = new sdk.EventDispatcher({
    encryptKey: credentials.encryptKey,
    verificationToken: credentials.verificationToken,
    loggerLevel: sdk.LoggerLevel.warn,
  });

  return { client, wsClient, dispatcher };
}
