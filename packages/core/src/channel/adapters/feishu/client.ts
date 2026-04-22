/**
 * 飞书 SDK Client / WSClient / EventDispatcher 工厂
 *
 * 薄封装，便于测试时用 mock 替换 SDK。
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuCredentials } from './config.js';

/** SDK 客户端集合 */
export interface FeishuSdkBundle {
  client: Lark.Client;
  wsClient: Lark.WSClient;
  dispatcher: Lark.EventDispatcher;
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
  sdk: FeishuSdk = defaultSdk,
): FeishuSdkBundle {
  const domain = sdk.Domain.Feishu;

  const client = new sdk.Client({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain,
    loggerLevel: sdk.LoggerLevel.warn,
  });

  const wsClient = new sdk.WSClient({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain,
    loggerLevel: sdk.LoggerLevel.warn,
  });

  const dispatcher = new sdk.EventDispatcher({
    encryptKey: credentials.encryptKey,
    verificationToken: credentials.verificationToken,
    loggerLevel: sdk.LoggerLevel.warn,
  });

  return { client, wsClient, dispatcher };
}
