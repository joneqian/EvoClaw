/**
 * M6 T1: Provider 凭据池编辑弹窗
 *
 * 支持配置多把 apiKey + 策略选择（failover / round-robin），
 * 每把 key 显示运行时状态徽章（正常 / cooldown / 永久禁用）。
 */

import { useState, useEffect, useCallback } from 'react';
import { get, post, put } from '../lib/api';

export interface PoolKey {
  id: string;
  apiKey: string;
  enabled: boolean;
}

export interface CredentialPool {
  strategy: 'failover' | 'round-robin';
  keys: PoolKey[];
}

interface KeyRuntimeState {
  failCount: number;
  lastFailAt?: number;
  cooldownUntil?: number;
  disabled: boolean;
  reason?: 'auth' | 'rate-limit' | 'service-unavailable' | 'network' | 'unknown';
}

interface KeyStatusEntry {
  id: string;
  enabled: boolean;
  state: KeyRuntimeState;
}

interface Props {
  providerId: string;
  /** 当前已持久化的 pool；undefined 表示尚未启用 */
  initialPool?: CredentialPool;
  /** 保存完成回调（父组件刷新列表） */
  onSaved: () => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 父组件的 toast */
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

function genKeyId(existing: PoolKey[]): string {
  const used = new Set(existing.map((k) => k.id));
  if (!used.has('primary')) return 'primary';
  if (!used.has('backup')) return 'backup';
  let i = 1;
  while (used.has(`key-${i}`)) i++;
  return `key-${i}`;
}

function describeState(state: KeyRuntimeState): { label: string; color: string } {
  if (state.disabled) {
    return { label: `已禁用（${state.reason ?? 'auth'}）`, color: 'bg-red-50 text-red-700' };
  }
  if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
    const remain = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
    return { label: `冷却 ${remain}s`, color: 'bg-amber-50 text-amber-700' };
  }
  if (state.failCount > 0) {
    return { label: `失败 ${state.failCount} 次`, color: 'bg-slate-100 text-slate-600' };
  }
  return { label: '正常', color: 'bg-green-50 text-green-700' };
}

export default function CredentialPoolEditor({ providerId, initialPool, onSaved, onClose, showToast }: Props) {
  const [strategy, setStrategy] = useState<CredentialPool['strategy']>(initialPool?.strategy ?? 'failover');
  const [keys, setKeys] = useState<PoolKey[]>(initialPool?.keys ?? []);
  const [statuses, setStatuses] = useState<Record<string, KeyStatusEntry>>({});
  const [saving, setSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await get<{ strategy: string | null; keys: KeyStatusEntry[] }>(`/provider/${providerId}/key-status`);
      const map: Record<string, KeyStatusEntry> = {};
      for (const entry of data.keys) map[entry.id] = entry;
      setStatuses(map);
    } catch {
      // 静默，状态回显非关键
    }
  }, [providerId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleAdd = () => {
    setKeys([...keys, { id: genKeyId(keys), apiKey: '', enabled: true }]);
  };

  const handleUpdate = (idx: number, patch: Partial<PoolKey>) => {
    setKeys(keys.map((k, i) => (i === idx ? { ...k, ...patch } : k)));
  };

  const handleRemove = (idx: number) => {
    setKeys(keys.filter((_, i) => i !== idx));
  };

  const handleReset = async (keyId: string) => {
    try {
      await post(`/provider/${providerId}/key-reset`, { keyId });
      await fetchStatus();
      showToast(`已重置 ${keyId} 的失败状态`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '重置失败', 'error');
    }
  };

  const handleSave = async () => {
    // 基础校验
    if (keys.length === 0) {
      showToast('至少需要一把 key', 'error');
      return;
    }
    const ids = keys.map((k) => k.id.trim());
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      showToast('每把 key 的 id 必须非空且唯一', 'error');
      return;
    }
    if (keys.some((k) => !k.apiKey.trim())) {
      showToast('每把 key 都必须填写 apiKey', 'error');
      return;
    }
    setSaving(true);
    try {
      // 读取 provider 现有字段，merge credentialPool 后回写
      const existing = await get<{ provider: { baseUrl: string; api: string; models: Array<{ id: string; name: string }> } }>(
        `/config/provider/${providerId}`,
      );
      await put(`/config/provider/${providerId}`, {
        baseUrl: existing.provider.baseUrl,
        apiKey: '___KEEP___',
        api: existing.provider.api,
        models: existing.provider.models,
        credentialPool: {
          strategy,
          keys: keys.map((k) => ({ id: k.id.trim(), apiKey: k.apiKey.trim(), enabled: k.enabled })),
        },
      });
      showToast('已保存凭据池');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDisablePool = async () => {
    if (!confirm('移除凭据池后将退回到单 apiKey 模式，确定继续？')) return;
    setSaving(true);
    try {
      const existing = await get<{ provider: { baseUrl: string; api: string; models: Array<{ id: string; name: string }> } }>(
        `/config/provider/${providerId}`,
      );
      await put(`/config/provider/${providerId}`, {
        baseUrl: existing.provider.baseUrl,
        apiKey: '___KEEP___',
        api: existing.provider.api,
        models: existing.provider.models,
        credentialPool: null,  // 显式清空
      });
      showToast('已移除凭据池');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '移除失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[560px] max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">多 Key 凭据池</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              配置多把 apiKey，失败时自动切换（failover）或轮流使用（round-robin）
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 -mt-1 -mr-1 text-lg leading-none">×</button>
        </div>

        {/* 策略 */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-1.5">策略</label>
          <div className="flex gap-2">
            <button
              onClick={() => setStrategy('failover')}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border ${strategy === 'failover' ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <div className="font-semibold">Failover</div>
              <div className="text-[10px] opacity-70 mt-0.5">失败时切换到下一把</div>
            </button>
            <button
              onClick={() => setStrategy('round-robin')}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border ${strategy === 'round-robin' ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <div className="font-semibold">Round-Robin</div>
              <div className="text-[10px] opacity-70 mt-0.5">按顺序轮流使用</div>
            </button>
          </div>
        </div>

        {/* keys 列表 */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-600">Keys（{keys.length}）</label>
            <button onClick={handleAdd} className="text-xs text-brand hover:underline">+ 添加一把</button>
          </div>
          {keys.length === 0 && (
            <p className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3 text-center">尚未配置，点击「添加一把」开始</p>
          )}
          <div className="space-y-2">
            {keys.map((k, idx) => {
              const status = statuses[k.id];
              return (
                <div key={idx} className="border border-slate-200 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={k.id}
                      onChange={(e) => handleUpdate(idx, { id: e.target.value })}
                      placeholder="id（如 primary）"
                      className="w-[120px] px-2 py-1 text-xs border border-slate-200 rounded font-mono"
                    />
                    <input
                      type="password"
                      value={k.apiKey}
                      onChange={(e) => handleUpdate(idx, { apiKey: e.target.value })}
                      placeholder="API Key"
                      className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded font-mono"
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k.enabled}
                        onChange={(e) => handleUpdate(idx, { enabled: e.target.checked })}
                      />
                      启用
                    </label>
                    <button
                      onClick={() => handleRemove(idx)}
                      className="text-slate-300 hover:text-red-500 text-xs"
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                  {status?.state && (
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] ${describeState(status.state).color}`}>
                        {describeState(status.state).label}
                      </span>
                      {(status.state.disabled || (status.state.cooldownUntil && Date.now() < status.state.cooldownUntil)) && (
                        <button onClick={() => handleReset(k.id)} className="text-[10px] text-brand hover:underline">重置状态</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex justify-between items-center mt-5 pt-3 border-t border-slate-100">
          {initialPool ? (
            <button onClick={handleDisablePool} disabled={saving} className="text-xs text-red-500 hover:underline disabled:opacity-40">
              移除凭据池
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3.5 py-1.5 text-xs rounded-lg bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
