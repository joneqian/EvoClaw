/**
 * M6 T2c: Profile 切换管理
 *
 * - 显示当前 profile 徽章
 * - 下拉切换
 * - 新建（复制当前）/ 删除
 */

import { useState, useEffect, useCallback } from 'react';
import { get, post, del } from '../lib/api';

interface ProfilesResponse {
  current: string;
  profiles: string[];
}

interface Props {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

const DEFAULT_PROFILE = 'default';
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export default function ProfileManager({ showToast }: Props) {
  const [current, setCurrent] = useState<string>('default');
  const [profiles, setProfiles] = useState<string[]>(['default']);
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await get<ProfilesResponse>('/config/profiles');
      setCurrent(data.current);
      setProfiles(data.profiles);
    } catch {
      // 静默
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSwitch = useCallback(async (name: string) => {
    if (name === current) return;
    setSwitching(true);
    try {
      await post('/config/profile/switch', { name });
      await refresh();
      showToast(`已切换到 ${name} — MCP / 配置 正在重载`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '切换失败', 'error');
    } finally {
      setSwitching(false);
    }
  }, [current, refresh, showToast]);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!NAME_PATTERN.test(trimmed)) {
      showToast('名称只能包含字母 / 数字 / - / _', 'error');
      return;
    }
    if (profiles.includes(trimmed)) {
      showToast('名称已存在', 'error');
      return;
    }
    setCreating(true);
    try {
      // 默认复制当前 profile（最少操作成本）
      await post('/config/profile/create', { name: trimmed, copyFrom: current });
      showToast(`已创建 profile: ${trimmed}（复制自 ${current}）`);
      setNewName('');
      setShowCreate(false);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建失败', 'error');
    } finally {
      setCreating(false);
    }
  }, [newName, profiles, current, refresh, showToast]);

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`确定删除 profile "${name}"？此操作不可撤销。`)) return;
    try {
      await del(`/config/profile/${encodeURIComponent(name)}`);
      showToast(`已删除 profile: ${name}`);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败', 'error');
    }
  }, [refresh, showToast]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
            Profile
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand/10 text-brand">
              🏷️ {current}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            切换后 MCP 服务器 / LLM 凭据 / 环境变量会重载，进行中的对话不中断
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:border-brand hover:text-brand"
        >
          + 新建
        </button>
      </div>

      {/* 新建表单 */}
      {showCreate && (
        <div className="flex items-center gap-2 mb-3 p-2.5 bg-slate-50 rounded-lg">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新 profile 名（字母/数字/-/_）"
            className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded"
            disabled={creating}
          />
          <span className="text-[10px] text-slate-400">复制自 {current}</span>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="px-2.5 py-1 text-xs rounded bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
          >
            {creating ? '创建中…' : '创建'}
          </button>
          <button
            onClick={() => { setShowCreate(false); setNewName(''); }}
            disabled={creating}
            className="px-2.5 py-1 text-xs rounded border border-slate-200 text-slate-600"
          >
            取消
          </button>
        </div>
      )}

      {/* profile 列表 */}
      <div className="space-y-1">
        {profiles.map((name) => {
          const isCurrent = name === current;
          const canDelete = !isCurrent && name !== DEFAULT_PROFILE;
          return (
            <div
              key={name}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border ${isCurrent ? 'border-brand/30 bg-brand/5' : 'border-slate-100 hover:border-slate-200'}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800">{name}</span>
                {name === DEFAULT_PROFILE && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">默认</span>}
                {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/20 text-brand font-semibold">当前</span>}
              </div>
              <div className="flex items-center gap-2">
                {!isCurrent && (
                  <button
                    onClick={() => handleSwitch(name)}
                    disabled={switching}
                    className="text-xs text-brand hover:underline disabled:opacity-40"
                  >
                    切换到此
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => handleDelete(name)}
                    className="text-xs text-slate-400 hover:text-red-500"
                    title="删除"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
