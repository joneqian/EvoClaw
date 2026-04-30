/**
 * PR3 Phase F 测试：envelope / 卡片发送 / 审批生命周期 / card action 路由
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEnvelope,
  decodeEnvelope,
  FEISHU_ENVELOPE_VERSION,
} from '../../channel/adapters/feishu/card/card-envelope.js';
import {
  sendInteractiveCard,
  updateInteractiveCard,
} from '../../channel/adapters/feishu/card/send-card.js';
import {
  ApprovalRegistry,
  buildApprovalCard,
  buildResolvedApprovalCard,
  requestApprovalViaCard,
} from '../../channel/adapters/feishu/card/send-approval.js';
import { handleCardAction } from '../../channel/adapters/feishu/card/card-action.js';
import { FeishuApiError } from '../../channel/adapters/feishu/outbound/index.js';

// ─── envelope ──────────────────────────────────────────────────────────

describe('createEnvelope / decodeEnvelope', () => {
  it('createEnvelope 基本字段齐全', () => {
    const env = createEnvelope(
      {
        kind: 'approval',
        actionId: 'ap_1',
        sessionKey: 'agent:a:feishu:group:oc_x',
        operatorOpenId: 'ou_u',
        metadata: { x: 1 },
        ttlMs: 60_000,
      },
      1_000_000,
    );
    expect(env.oc).toBe(FEISHU_ENVELOPE_VERSION);
    expect(env.k).toBe('approval');
    expect(env.a).toBe('ap_1');
    expect(env.c.s).toBe('agent:a:feishu:group:oc_x');
    expect(env.c.u).toBe('ou_u');
    expect(env.c.e).toBe(1_000_000 + 60_000);
    expect(env.m).toEqual({ x: 1 });
  });

  it('decode 合法 envelope', () => {
    const env = createEnvelope(
      { kind: 'approval', actionId: 'a', sessionKey: 's1' },
      1_000,
    );
    const r = decodeEnvelope(env, { now: 2_000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.a).toBe('a');
  });

  it('decode 过期返回 expired', () => {
    const env = createEnvelope(
      { kind: 'approval', actionId: 'a', sessionKey: 's1', ttlMs: 100 },
      0,
    );
    const r = decodeEnvelope(env, { now: 1_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
  });

  it('decode session 不匹配', () => {
    const env = createEnvelope(
      { kind: 'approval', actionId: 'a', sessionKey: 's1' },
      0,
    );
    const r = decodeEnvelope(env, {
      now: 1,
      expectedSessionKey: 's_other',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('session_mismatch');
  });

  it('decode operator 不匹配', () => {
    const env = createEnvelope(
      {
        kind: 'approval',
        actionId: 'a',
        sessionKey: 's1',
        operatorOpenId: 'ou_u1',
      },
      0,
    );
    const r = decodeEnvelope(env, { now: 1, operatorOpenId: 'ou_u2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('operator_mismatch');
  });

  it('decode 版本不对', () => {
    const r = decodeEnvelope({ oc: 'other', k: 'button', a: 'x', c: { s: 's', e: 999_999_999_999 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('version_mismatch');
  });

  it('decode 形状非法', () => {
    expect(decodeEnvelope(null).ok).toBe(false);
    expect(decodeEnvelope('string').ok).toBe(false);
    expect(decodeEnvelope({ oc: FEISHU_ENVELOPE_VERSION }).ok).toBe(false);
  });
});

// ─── 卡片发送 ──────────────────────────────────────────────────────────

describe('sendInteractiveCard / updateInteractiveCard', () => {
  it('sendInteractiveCard 调 message.create interactive 并回 message_id', async () => {
    const create = vi.fn().mockResolvedValue({
      code: 0,
      data: { message_id: 'om_1' },
    });
    const client = { im: { v1: { message: { create } } } } as any;

    const id = await sendInteractiveCard(client, 'ou_u', { elements: [] }, 'private');
    expect(id).toBe('om_1');
    const call = create.mock.calls[0][0];
    expect(call.params.receive_id_type).toBe('open_id');
    expect(call.data.msg_type).toBe('interactive');
  });

  it('sendInteractiveCard code 非 0 抛 FeishuApiError', async () => {
    const create = vi.fn().mockResolvedValue({ code: 40001, msg: 'bad' });
    const client = { im: { v1: { message: { create } } } } as any;
    await expect(sendInteractiveCard(client, 'ou_u', {})).rejects.toBeInstanceOf(
      FeishuApiError,
    );
  });

  it('updateInteractiveCard 调 message.patch', async () => {
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    const client = { im: { v1: { message: { patch } } } } as any;
    await updateInteractiveCard(client, 'om_1', { elements: [] });
    const call = patch.mock.calls[0][0];
    expect(call.path.message_id).toBe('om_1');
    expect(typeof call.data.content).toBe('string');
  });
});

// ─── 审批卡模板 ─────────────────────────────────────────────────────────

describe('buildApprovalCard / buildResolvedApprovalCard', () => {
  it('approval 卡带两按钮，value 是 ecf1 envelope', () => {
    const card = buildApprovalCard({
      title: '执行删除？',
      body: '即将删除文件 a.txt',
      actionId: 'ap_1',
      sessionKey: 's_x',
      operatorOpenId: 'ou_u',
      ttlMs: 60_000,
    });
    // 取 action 元素
    const action = (card.elements as any[]).find((e) => e.tag === 'action');
    expect(action).toBeTruthy();
    expect(action.actions).toHaveLength(2);
    const [approve, deny] = action.actions;
    expect(approve.value.oc).toBe(FEISHU_ENVELOPE_VERSION);
    expect(approve.value.a).toBe('ap_1');
    expect(approve.value.m.decision).toBe('approve');
    expect(deny.value.m.decision).toBe('deny');
  });

  it('resolved 卡反映 decision → template', () => {
    expect(
      buildResolvedApprovalCard({
        title: 't',
        body: 'b',
        decision: 'approve',
      }).header?.template,
    ).toBe('green');
    expect(
      buildResolvedApprovalCard({ title: 't', body: 'b', decision: 'deny' })
        .header?.template,
    ).toBe('red');
    expect(
      buildResolvedApprovalCard({ title: 't', body: 'b', decision: 'timeout' })
        .header?.template,
    ).toBe('grey');
  });
});

// ─── 审批注册表 / 完整 Promise 生命周期 ───────────────────────────────

describe('ApprovalRegistry / requestApprovalViaCard', () => {
  let registry: ApprovalRegistry;

  beforeEach(() => {
    registry = new ApprovalRegistry();
  });

  function makeClient() {
    return {
      im: {
        v1: {
          message: {
            create: vi.fn().mockResolvedValue({
              code: 0,
              data: { message_id: 'om_1' },
            }),
            patch: vi.fn().mockResolvedValue({ code: 0 }),
          },
        },
      },
    };
  }

  it('nextActionId 递增', () => {
    const a = registry.nextActionId();
    const b = registry.nextActionId();
    expect(a).not.toBe(b);
  });

  /** 等 async 链跑完（create 微任务 + register() 同步登记） */
  async function waitForRegister(reg: ApprovalRegistry, expected: number): Promise<void> {
    for (let i = 0; i < 20 && reg.size < expected; i += 1) {
      await Promise.resolve();
    }
  }

  it('requestApprovalViaCard 点击 approve 时 Promise resolve', async () => {
    const client = makeClient();

    const pending = requestApprovalViaCard(client as any, registry, {
      peerId: 'ou_u',
      sessionKey: 's',
      title: 't',
      body: 'b',
      chatType: 'private',
      ttlMs: 60_000,
    });

    await waitForRegister(registry, 1);
    expect(client.im.v1.message.create).toHaveBeenCalled();
    expect(registry.size).toBe(1);

    const content = client.im.v1.message.create.mock.calls[0][0].data.content;
    const card = JSON.parse(content);
    const action = card.elements.find((e: any) => e.tag === 'action');
    const actionId = action.actions[0].value.a as string;

    registry.resolveAction(actionId, 'approve', 'ou_actor');

    const result = await pending;
    expect(result.decision).toBe('approve');
    expect(result.operatorOpenId).toBe('ou_actor');
    expect(registry.size).toBe(0);
  });

  it('超时未点击时 Promise resolve 为 timeout + 卡片更新', async () => {
    const client = makeClient();

    const pending = requestApprovalViaCard(client as any, registry, {
      peerId: 'ou_u',
      sessionKey: 's',
      title: 't',
      body: 'b',
      ttlMs: 50,
    });

    await waitForRegister(registry, 1);
    expect(registry.size).toBe(1);

    const result = await pending;
    expect(result.decision).toBe('timeout');
    expect(registry.size).toBe(0);

    // patch 为异步触发，等一轮微任务
    await new Promise((r) => setTimeout(r, 10));
    expect(client.im.v1.message.patch).toHaveBeenCalled();
  });

  it('cancelAll 触发所有待审批 timeout', async () => {
    const client = makeClient();

    const p1 = requestApprovalViaCard(client as any, registry, {
      peerId: 'ou_u',
      sessionKey: 's1',
      title: 't1',
      body: 'b',
      ttlMs: 60_000,
    });
    const p2 = requestApprovalViaCard(client as any, registry, {
      peerId: 'ou_u',
      sessionKey: 's2',
      title: 't2',
      body: 'b',
      ttlMs: 60_000,
    });
    await waitForRegister(registry, 2);
    expect(registry.size).toBe(2);

    registry.cancelAll();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.decision).toBe('timeout');
    expect(r2.decision).toBe('timeout');
    expect(registry.size).toBe(0);
    expect(registry.isClosed).toBe(true);
  });

  it('cancelAll 之后再 register 立即 resolve timeout（不留僵尸）', async () => {
    registry.cancelAll();
    let resolved: string | null = null;
    registry.register({
      actionId: 'ap_zombie',
      sessionKey: 's',
      messageId: null,
      title: 't',
      body: 'b',
      createdAt: 0,
      expiresAt: Date.now() + 60_000,
      resolve: (d) => { resolved = d; },
      timer: setTimeout(() => {}, 60_000),
    });
    expect(resolved).toBe('timeout');
    expect(registry.size).toBe(0);
  });

  it('reopen 后 register 恢复正常登记', async () => {
    registry.cancelAll();
    expect(registry.isClosed).toBe(true);
    registry.reopen();
    expect(registry.isClosed).toBe(false);

    registry.register({
      actionId: 'ap_ok',
      sessionKey: 's',
      messageId: null,
      title: 't',
      body: 'b',
      createdAt: 0,
      expiresAt: Date.now() + 60_000,
      resolve: () => {},
      timer: setTimeout(() => {}, 60_000),
    });
    expect(registry.size).toBe(1);
    registry.cancelAll();
  });
});

// ─── card.action.trigger 路由 ────────────────────────────────────────

describe('handleCardAction', () => {
  function makeCtx(registry: ApprovalRegistry) {
    return {
      getRegistry: () => registry,
      getClient: () =>
        ({
          im: {
            v1: {
              message: { patch: vi.fn().mockResolvedValue({ code: 0 }) },
            },
          },
        }) as any,
    };
  }

  it('忽略非 ecf1 envelope', async () => {
    const registry = new ApprovalRegistry();
    const resolveSpy = vi.spyOn(registry, 'resolveAction');
    await handleCardAction(
      { action: { value: { oc: 'other', k: 'approval', a: 'x' } } },
      makeCtx(registry),
    );
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('approval kind: approve 被分发到 registry', async () => {
    const registry = new ApprovalRegistry();
    const approveFn = vi.fn();
    registry.register({
      actionId: 'ap_1',
      sessionKey: 's',
      messageId: 'om_1',
      title: 't',
      body: 'b',
      createdAt: 0,
      expiresAt: Date.now() + 60_000,
      resolve: approveFn,
      timer: setTimeout(() => {}, 60_000),
    });

    const env = createEnvelope({
      kind: 'approval',
      actionId: 'ap_1',
      sessionKey: 's',
      metadata: { decision: 'approve' },
    });

    await handleCardAction(
      { operator: { open_id: 'ou_actor' }, action: { value: env } },
      makeCtx(registry),
    );

    expect(approveFn).toHaveBeenCalledWith('approve', 'ou_actor');
  });

  it('resolve 后结算卡复用原 title/body（不再写死"审批"）', async () => {
    const registry = new ApprovalRegistry();
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    const clientStub = {
      im: { v1: { message: { patch } } },
    } as any;

    registry.register({
      actionId: 'ap_ctx',
      sessionKey: 's',
      messageId: 'om_x',
      title: '执行删除？',
      body: '即将删除 a.txt',
      createdAt: 0,
      expiresAt: Date.now() + 60_000,
      resolve: () => {},
      timer: setTimeout(() => {}, 60_000),
    });

    const env = createEnvelope({
      kind: 'approval',
      actionId: 'ap_ctx',
      sessionKey: 's',
      metadata: { decision: 'deny' },
    });

    await handleCardAction(
      { operator: { open_id: 'ou_u' }, action: { value: env } },
      { getRegistry: () => registry, getClient: () => clientStub },
    );
    // patch 可能是异步发起，等一轮事件循环
    await new Promise((r) => setTimeout(r, 10));
    expect(patch).toHaveBeenCalled();
    const content = JSON.parse(patch.mock.calls[0][0].data.content);
    const headerTitle = content.header.title.content;
    expect(headerTitle).toBe('执行删除？'); // 复用原 title
    const bodyDiv = content.elements.find((e: any) => e.tag === 'div');
    expect(bodyDiv.text.content).toBe('即将删除 a.txt'); // 复用原 body
  });

  it('过期 envelope 不触发 resolve', async () => {
    const registry = new ApprovalRegistry();
    const resolveSpy = vi.spyOn(registry, 'resolveAction');

    const env = createEnvelope(
      {
        kind: 'approval',
        actionId: 'ap_2',
        sessionKey: 's',
        ttlMs: 100,
      },
      0, // 从时间戳 0 起算
    );

    await handleCardAction(
      { action: { value: env } }, // 当前时间远大于 100
      makeCtx(registry),
    );
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('operator 不匹配不触发', async () => {
    const registry = new ApprovalRegistry();
    const resolveSpy = vi.spyOn(registry, 'resolveAction');

    const env = createEnvelope({
      kind: 'approval',
      actionId: 'ap_3',
      sessionKey: 's',
      operatorOpenId: 'ou_expected',
    });

    await handleCardAction(
      { operator: { open_id: 'ou_other' }, action: { value: env } },
      makeCtx(registry),
    );
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
