import { useState, useEffect, useCallback } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent-store';
import AgentSelect from '../components/AgentSelect';
import { get, post, del } from '../lib/api';

/** 知识库文件 */
interface KBFile {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  chunk_count: number;
  status: 'pending' | 'indexing' | 'indexed' | 'error';
  error_message: string | null;
  created_at: string;
  indexed_at: string | null;
}

/** 状态标签颜色 */
const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  pending: { label: '待索引', color: 'bg-warning/15 text-warning' },
  indexing: { label: '索引中', color: 'bg-info/15 text-info' },
  indexed: { label: '已索引', color: 'bg-success/15 text-success' },
  error: { label: '失败', color: 'bg-danger/15 text-danger' },
};

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 知识库文件行 */
function FileRow({
  file,
  agentId,
  onRefresh,
}: {
  file: KBFile;
  agentId: string;
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const status = STATUS_STYLES[file.status] ?? STATUS_STYLES.pending;

  const handleDelete = useCallback(async () => {
    if (!deleting) {
      setDeleting(true);
      return;
    }
    await del(`/knowledge/${agentId}/files/${file.id}`);
    setDeleting(false);
    onRefresh();
  }, [agentId, file.id, deleting, onRefresh]);

  const handleReindex = useCallback(async () => {
    setReindexing(true);
    try {
      await post(`/knowledge/${agentId}/reindex`, { fileId: file.id });
      onRefresh();
    } catch {
      // 错误由 onRefresh 后的状态更新显示
    } finally {
      setReindexing(false);
    }
  }, [agentId, file.id, onRefresh]);

  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-card rounded-lg border border-border hover:border-brand/40 transition-colors">
      {/* 文件图标 */}
      <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
        <FileText className="w-4 h-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
      </div>

      {/* 文件信息 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-muted-foreground">{formatSize(file.file_size)}</span>
          <span className="text-xs text-muted-foreground">{file.chunk_count} 块</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>
            {status.label}
          </span>
        </div>
        {file.error_message && (
          <p className="text-xs text-danger mt-1 truncate">{file.error_message}</p>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleReindex}
          disabled={reindexing}
          className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-accent rounded-lg hover:bg-accent disabled:opacity-50 transition-colors"
          title="重新索引"
        >
          {reindexing ? '索引中...' : '重建索引'}
        </button>

        {deleting ? (
          <div className="flex items-center gap-1">
            <button
              onClick={handleDelete}
              className="px-2 py-1.5 text-xs rounded-lg bg-danger text-white hover:bg-danger transition-colors"
            >
              确认
            </button>
            <button
              onClick={() => setDeleting(false)}
              className="px-2 py-1.5 text-xs rounded-lg bg-accent text-muted-foreground hover:bg-border transition-colors"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger transition-colors"
            title="删除"
          >
            <Trash2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/** 知识库管理页面 */
export default function KnowledgePage() {
  const { t } = useTranslation();
  const { agents } = useAgentStore();
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [files, setFiles] = useState<KBFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  /** 初始化默认 agent */
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  /** 加载文件列表 */
  const fetchFiles = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoading(true);
    try {
      const data = await get<{ files: KBFile[] }>(`/knowledge/${selectedAgentId}/files`);
      setFiles(data.files);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [selectedAgentId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  /** 导入文件 */
  const handleImport = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId || !importPath.trim()) return;
    setImporting(true);
    setError('');
    try {
      await post(`/knowledge/${selectedAgentId}/ingest`, { filePath: importPath.trim() });
      setImportPath('');
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  }, [selectedAgentId, importPath, fetchFiles]);

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">{t('knowledgePage.title')}</h2>
          <AgentSelect
            agents={agents}
            value={selectedAgentId}
            onChange={setSelectedAgentId}
          />
        </div>

        {/* 导入表单 */}
        <form onSubmit={handleImport} className="flex gap-2">
          <input
            type="text"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            placeholder="输入文件路径（支持 .md / .txt / .pdf / 代码文件）"
            className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <button
            type="submit"
            disabled={!selectedAgentId || !importPath.trim() || importing}
            className="px-4 py-2 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-active disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {importing ? '导入中...' : '导入'}
          </button>
        </form>
        {error && (
          <p className="text-xs text-danger mt-2">{error}</p>
        )}
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedAgentId ? (
          <div className="text-center text-muted-foreground mt-20">
            <p className="text-lg">请先创建一个 Agent</p>
          </div>
        ) : loading ? (
          <div className="text-center text-muted-foreground mt-20">
            <p className="text-sm">加载中...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center text-muted-foreground mt-20">
            <p className="text-lg">{t('knowledgePage.noFiles')}</p>
            <p className="text-sm mt-1">输入文件路径导入文档，Agent 对话时将自动检索相关内容</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            <p className="text-xs text-muted-foreground mb-2">
              共 {files.length} 个文件
            </p>
            {files.map((file) => (
              <FileRow key={file.id} file={file} agentId={selectedAgentId} onRefresh={fetchFiles} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
