/**
 * SopTagsPage — SOP 标签设计临时功能
 *
 * 两栏工作流：
 *   - 左栏：上传 SOP 文档 + 文档列表
 *   - 右栏：标签编辑器（草稿 / 已确认 双 tab）
 *
 * 顶部"AI 生成草稿"按钮 → 单次 LLM 调用（非 agent loop、非流式）→ 直接落盘到 draft.json
 * 用户在右栏审核 + 编辑后点"确认保存"将草稿落盘为正式标签。
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSopStore, type SopParentTag, type SopChildTag, type SopDoc } from '../stores/sop-store';

const ACCEPT_EXT = '.docx,.md,.markdown,.xlsx';

type TabKey = 'draft' | 'confirmed';

export default function SopTagsPage() {
  const {
    docs, tags, draft, generating,
    fetchDocs, uploadDoc, deleteDoc,
    fetchTags, clearTags,
    fetchDraft, saveDraft, discardDraft, promoteDraft,
    generateDraft,
  } = useSopStore();

  const [tab, setTab] = useState<TabKey>('draft');
  const [editing, setEditing] = useState<SopParentTag[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState('');
  /** 自定义确认对话框（Tauri WKWebView 不支持原生 window.confirm，用自渲染 modal 替代） */
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 初始加载
  useEffect(() => {
    fetchDocs();
    fetchTags();
    fetchDraft();
  }, [fetchDocs, fetchTags, fetchDraft]);

  // draft 变化时同步到本地编辑状态
  useEffect(() => {
    if (tab === 'draft') {
      setEditing(deepClone(draft ?? []));
    }
  }, [draft, tab]);

  // 成功提示 3 秒后自动消失
  useEffect(() => {
    if (!okMsg) return;
    const t = setTimeout(() => setOkMsg(null), 3000);
    return () => clearTimeout(t);
  }, [okMsg]);

  // 错误提示 6 秒后自动消失（错误信息看更久）
  useEffect(() => {
    if (!errMsg) return;
    const t = setTimeout(() => setErrMsg(null), 6000);
    return () => clearTimeout(t);
  }, [errMsg]);

  // ─── 文档操作 ───

  const handleFileSelect = useCallback(async (file: File) => {
    setErrMsg(null);
    setOkMsg(null);
    const result = await uploadDoc(file);
    if (!result.ok) {
      setErrMsg(`上传失败: ${result.error}`);
    } else {
      setOkMsg(`已上传: ${file.name}`);
    }
  }, [uploadDoc]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    if (e.target) e.target.value = '';
  }, [handleFileSelect]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ─── 标签编辑 ───

  const addParent = () => {
    setEditing([
      ...editing,
      { name: '新阶段', children: [{ name: '新场景', meaning: '', mustDo: '', mustNotDo: '' }] },
    ]);
  };

  const updateParent = (i: number, patch: Partial<SopParentTag>) => {
    const next = [...editing];
    next[i] = { ...next[i]!, ...patch };
    setEditing(next);
  };

  const removeParent = (i: number) => {
    setConfirmModal({
      title: '删除阶段',
      message: '确定删除该父标签及其所有子标签？（仅在编辑器内移除，未保存草稿）',
      danger: true,
      confirmLabel: '删除',
      onConfirm: () => setEditing(editing.filter((_, idx) => idx !== i)),
    });
  };

  const addChild = (pi: number) => {
    const next = [...editing];
    const parent = next[pi]!;
    next[pi] = {
      ...parent,
      children: [...parent.children, { name: '新场景', meaning: '', mustDo: '', mustNotDo: '' }],
    };
    setEditing(next);
  };

  const updateChild = (pi: number, ci: number, patch: Partial<SopChildTag>) => {
    const next = [...editing];
    const parent = next[pi]!;
    const children = [...parent.children];
    children[ci] = { ...children[ci]!, ...patch };
    next[pi] = { ...parent, children };
    setEditing(next);
  };

  const removeChild = (pi: number, ci: number) => {
    const next = [...editing];
    const parent = next[pi]!;
    next[pi] = { ...parent, children: parent.children.filter((_, idx) => idx !== ci) };
    setEditing(next);
  };

  // ─── 保存 ───

  const handleSaveDraft = async () => {
    setErrMsg(null);
    setOkMsg(null);
    const result = await saveDraft(editing);
    if (!result.ok) setErrMsg(result.error ?? '保存草稿失败');
    else setOkMsg('草稿已更新');
  };

  const handleConfirmSave = () => {
    setConfirmModal({
      title: '保存为正式标签',
      message: '将当前草稿保存为正式 SOP 标签？这会覆盖现有已确认标签。',
      confirmLabel: '确认保存',
      onConfirm: async () => {
        setErrMsg(null);
        setOkMsg(null);
        const saveRes = await saveDraft(editing);
        if (!saveRes.ok) {
          setErrMsg(saveRes.error ?? '保存草稿失败');
          return;
        }
        const promoteRes = await promoteDraft();
        if (!promoteRes.ok) {
          setErrMsg(promoteRes.error ?? '提升草稿失败');
          return;
        }
        setOkMsg('已确认保存');
        setTab('confirmed');
      },
    });
  };

  const handleDiscardDraft = () => {
    setConfirmModal({
      title: '丢弃草稿',
      message: '确认丢弃当前草稿？此操作不可撤销，但可以重新让 AI 生成。',
      danger: true,
      confirmLabel: '丢弃',
      onConfirm: async () => {
        setErrMsg(null);
        setOkMsg(null);
        const result = await discardDraft();
        if (!result.ok) {
          setErrMsg(`丢弃失败: ${result.error}`);
          return;
        }
        setEditing([]);
        await fetchDraft();
        setOkMsg('草稿已丢弃');
      },
    });
  };

  const handleClearTags = () => {
    setConfirmModal({
      title: '清空已确认标签',
      message: '确认清空所有已确认 SOP 标签？此操作不可撤销。',
      danger: true,
      confirmLabel: '清空',
      onConfirm: async () => {
        await clearTags();
        setOkMsg('已清空标签');
      },
    });
  };

  const handleDeleteDoc = (doc: SopDoc) => {
    setConfirmModal({
      title: '删除文档',
      message: `确认删除文档「${doc.originalName}」？删除后该文档将不再用于 AI 生成草稿。`,
      danger: true,
      confirmLabel: '删除',
      onConfirm: async () => {
        await deleteDoc(doc.id);
      },
    });
  };

  // ─── AI 生成草稿 ───

  const handleGenerate = useCallback(async () => {
    setErrMsg(null);
    setOkMsg(null);
    if (docs.length === 0) {
      setErrMsg('请先上传至少一份 SOP 文档');
      return;
    }
    const result = await generateDraft(aiInstruction.trim() || undefined);
    if (!result.ok) {
      setErrMsg(`AI 生成失败: ${result.error}`);
    } else {
      setOkMsg('AI 已生成草稿，请在右侧审核');
      setTab('draft');
      setAiInstruction('');
    }
  }, [docs.length, generateDraft, aiInstruction]);

  // ─── 渲染 ───

  const validation = validateLocal(editing);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* 自定义确认对话框 */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 w-[400px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-800 mb-2">{confirmModal.title}</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">{confirmModal.message}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  const fn = confirmModal.onConfirm;
                  setConfirmModal(null);
                  await fn();
                }}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                  confirmModal.danger
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-brand hover:bg-brand-hover'
                }`}
              >
                {confirmModal.confirmLabel ?? '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部操作栏 */}
      <header className="shrink-0 px-6 py-3 border-b border-slate-200/80 bg-white">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-sm font-semibold text-slate-800">SOP 标签设计</h1>
            <p className="text-[11px] text-slate-400">
              上传文档 → AI 一键生成草稿 → 审核编辑 → 确认保存
            </p>
          </div>
          <button
            onClick={() => { fetchDocs(); fetchTags(); fetchDraft(); }}
            className="px-3 py-1 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            刷新
          </button>
        </div>
        {/* AI 生成行 */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={aiInstruction}
            onChange={(e) => setAiInstruction(e.target.value)}
            placeholder="（可选）补充指令，例如：分 5 个阶段、聚焦售后场景、参考已有草稿完善..."
            disabled={generating || docs.length === 0}
            className="flex-1 text-xs text-slate-700 px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-brand/60 disabled:bg-slate-50 disabled:text-slate-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !generating && docs.length > 0) {
                handleGenerate();
              }
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={generating || docs.length === 0}
            className="shrink-0 px-4 py-1.5 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {generating ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                生成中…
              </>
            ) : (
              <>🤖 AI 生成草稿</>
            )}
          </button>
        </div>
        {generating && (
          <p className="mt-1.5 text-[11px] text-slate-400">
            正在调用大模型阅读全部文档并生成标签，预计 20-60 秒…
          </p>
        )}
      </header>

      {/* 主体 — 两栏 */}
      <div className="flex-1 min-h-0 flex">
        {/* ─── 左栏：文档管理 ─── */}
        <aside className="w-[280px] shrink-0 border-r border-slate-200/80 bg-white flex flex-col">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">参考文档</h2>

            {/* 上传区 */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-brand/50 hover:bg-brand/5 transition-colors"
            >
              <p className="text-xs text-slate-500">
                拖拽文件至此或点击上传
              </p>
              <p className="text-[10px] text-slate-400 mt-1">
                支持 docx / md / xlsx，最大 10MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_EXT}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>

          {/* 文档列表 */}
          <div className="flex-1 overflow-y-auto">
            {docs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                暂无已上传文档
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.map((doc) => (
                  <li key={doc.id} className="px-4 py-3 hover:bg-slate-50 group">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                        {doc.ext}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-700 truncate" title={doc.originalName}>
                          {doc.originalName}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {formatTime(doc.uploadedAt)} · {formatSize(doc.size)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteDoc(doc)}
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-red-500 hover:text-red-600 transition-opacity"
                      >
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ─── 右栏：标签编辑器 ─── */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Tab */}
          <div className="px-6 pt-4 flex items-center gap-1 bg-white border-b border-slate-200/80">
            <button
              onClick={() => setTab('draft')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === 'draft'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              草稿（待审核）{draft && draft.length > 0 ? <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded-full">{draft.length}</span> : ''}
            </button>
            <button
              onClick={() => setTab('confirmed')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === 'confirmed'
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              已确认 {tags.length > 0 ? <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-700 rounded-full">{tags.length}</span> : ''}
            </button>
          </div>

          {/* 提示信息 */}
          {(errMsg || okMsg) && (
            <div className={`mx-6 mt-3 px-3 py-2 rounded-lg text-xs ${
              errMsg ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            }`}>
              {errMsg ?? okMsg}
            </div>
          )}

          {/* Tab 内容 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {tab === 'draft' ? (
              <DraftEditor
                editing={editing}
                onAddParent={addParent}
                onUpdateParent={updateParent}
                onRemoveParent={removeParent}
                onAddChild={addChild}
                onUpdateChild={updateChild}
                onRemoveChild={removeChild}
                validation={validation}
              />
            ) : (
              <ConfirmedView tags={tags} onClear={handleClearTags} />
            )}
          </div>

          {/* 底部操作栏（仅 draft tab） */}
          {tab === 'draft' && (
            <div className="shrink-0 border-t border-slate-200/80 bg-white px-6 py-3 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {validation.valid
                  ? `${editing.length} 父 / ${editing.reduce((s, p) => s + p.children.length, 0)} 子`
                  : <span className="text-red-500">{validation.error}</span>}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDiscardDraft}
                  disabled={!draft}
                  className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  丢弃草稿
                </button>
                <button
                  onClick={handleSaveDraft}
                  disabled={!validation.valid}
                  className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  保存为草稿
                </button>
                <button
                  onClick={handleConfirmSave}
                  disabled={!validation.valid || editing.length === 0}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  确认保存
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── 子组件 ───

interface DraftEditorProps {
  editing: SopParentTag[];
  onAddParent: () => void;
  onUpdateParent: (i: number, patch: Partial<SopParentTag>) => void;
  onRemoveParent: (i: number) => void;
  onAddChild: (pi: number) => void;
  onUpdateChild: (pi: number, ci: number, patch: Partial<SopChildTag>) => void;
  onRemoveChild: (pi: number, ci: number) => void;
  validation: { valid: boolean; error?: string };
}

function DraftEditor({
  editing, onAddParent, onUpdateParent, onRemoveParent,
  onAddChild, onUpdateChild, onRemoveChild,
}: DraftEditorProps) {
  if (editing.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="text-sm mb-2">暂无草稿</p>
        <p className="text-xs mb-4">点击右上角"让 Agent 规划标签"由 AI 阅读已上传文档生成草稿</p>
        <button
          onClick={onAddParent}
          className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          + 手动添加父标签
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {editing.map((parent, pi) => (
        <div key={pi} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {/* 父标签头 */}
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50/60 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-400">阶段 {pi + 1}</span>
            <input
              value={parent.name}
              onChange={(e) => onUpdateParent(pi, { name: e.target.value })}
              placeholder="父标签名称（如：咨询阶段）"
              className="flex-1 text-sm font-medium text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-0 px-2"
            />
            <button
              onClick={() => onRemoveParent(pi)}
              className="text-[10px] text-red-500 hover:text-red-600"
            >
              删除阶段
            </button>
          </div>

          {/* 子标签列表 */}
          <div className="divide-y divide-slate-100">
            {parent.children.map((child, ci) => (
              <div key={ci} className="px-4 py-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1">标签名称</label>
                  <input
                    value={child.name}
                    onChange={(e) => onUpdateChild(pi, ci, { name: e.target.value })}
                    className="w-full text-sm text-slate-800 px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-brand/60"
                  />
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] font-medium text-slate-500 mb-1">标签含义</label>
                    <input
                      value={child.meaning}
                      onChange={(e) => onUpdateChild(pi, ci, { meaning: e.target.value })}
                      placeholder="什么样的客户属于此标签"
                      className="w-full text-sm text-slate-800 px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-brand/60"
                    />
                  </div>
                  <button
                    onClick={() => onRemoveChild(pi, ci)}
                    className="text-[10px] text-red-500 hover:text-red-600 mt-5"
                  >
                    删除
                  </button>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-emerald-600 mb-1">需要做（必须说什么 / 做什么）</label>
                  <textarea
                    value={child.mustDo}
                    onChange={(e) => onUpdateChild(pi, ci, { mustDo: e.target.value })}
                    rows={2}
                    placeholder="具体可执行的动作（避免空话）"
                    className="w-full text-sm text-slate-800 px-2 py-1 border border-slate-200 rounded resize-none focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-red-600 mb-1">不能做（禁止说什么 / 做什么）</label>
                  <textarea
                    value={child.mustNotDo}
                    onChange={(e) => onUpdateChild(pi, ci, { mustNotDo: e.target.value })}
                    rows={2}
                    placeholder="具体禁止的动作"
                    className="w-full text-sm text-slate-800 px-2 py-1 border border-slate-200 rounded resize-none focus:outline-none focus:border-red-500/60"
                  />
                </div>
              </div>
            ))}
            <div className="px-4 py-2">
              <button
                onClick={() => onAddChild(pi)}
                className="text-xs text-brand hover:text-brand-hover"
              >
                + 添加子标签
              </button>
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={onAddParent}
        className="w-full py-3 text-xs text-slate-500 border-2 border-dashed border-slate-200 rounded-xl hover:border-brand/50 hover:text-brand transition-colors"
      >
        + 添加父标签（阶段）
      </button>
    </div>
  );
}

function ConfirmedView({ tags, onClear }: { tags: SopParentTag[]; onClear: () => void }) {
  if (tags.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="text-sm">暂无已确认的 SOP 标签</p>
        <p className="text-xs mt-1">在草稿 tab 编辑后点击"确认保存"</p>
      </div>
    );
  }
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-end">
        <button
          onClick={onClear}
          className="text-[10px] text-red-500 hover:text-red-600"
        >
          清空所有标签
        </button>
      </div>
      {tags.map((parent, pi) => (
        <div key={pi} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50/60 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-400 mr-2">阶段 {pi + 1}</span>
            <span className="text-sm font-semibold text-slate-800">{parent.name}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {parent.children.map((child, ci) => (
              <div key={ci} className="px-4 py-3">
                <div className="text-sm font-medium text-slate-800 mb-1">{child.name}</div>
                <div className="text-xs text-slate-500 mb-2">{child.meaning}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-xs">
                    <div className="font-medium text-emerald-600 mb-0.5">需要做</div>
                    <div className="text-slate-700 whitespace-pre-line">{child.mustDo}</div>
                  </div>
                  <div className="text-xs">
                    <div className="font-medium text-red-600 mb-0.5">不能做</div>
                    <div className="text-slate-700 whitespace-pre-line">{child.mustNotDo}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 工具函数 ───

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 前端校验：与后端 zod 同步保持一致 */
function validateLocal(tags: SopParentTag[]): { valid: boolean; error?: string } {
  for (let pi = 0; pi < tags.length; pi++) {
    const p = tags[pi]!;
    if (!p.name?.trim()) return { valid: false, error: `阶段 ${pi + 1} 缺少名称` };
    if (!p.children || p.children.length === 0) {
      return { valid: false, error: `阶段 ${pi + 1}（${p.name}）至少需要一个子标签` };
    }
    for (let ci = 0; ci < p.children.length; ci++) {
      const c = p.children[ci]!;
      if (!c.name?.trim()) return { valid: false, error: `${p.name} → 子标签 ${ci + 1} 缺少名称` };
      if (!c.meaning?.trim()) return { valid: false, error: `${p.name} → ${c.name} 缺少含义` };
      if (!c.mustDo?.trim()) return { valid: false, error: `${p.name} → ${c.name} 缺少"需要做"` };
      if (!c.mustNotDo?.trim()) return { valid: false, error: `${p.name} → ${c.name} 缺少"不能做"` };
    }
  }
  return { valid: true };
}
