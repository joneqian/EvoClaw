import { useState, useEffect, useCallback } from 'react';
import { get, post, del } from '../lib/api';

/** 已安装 Skill */
interface InstalledSkillItem {
  name: string;
  description: string;
  version?: string;
  author?: string;
  source: 'clawhub' | 'github' | 'local';
  installPath: string;
  gatesPassed: boolean;
  disableModelInvocation: boolean;
}

/** 搜索结果项 */
interface SearchResultItem {
  name: string;
  slug?: string;
  description: string;
  version?: string;
  author?: string;
  downloads?: number;
  source: 'clawhub' | 'github' | 'local';
}

/** 安装准备结果 */
interface PrepareResult {
  prepareId: string;
  metadata: { name: string; description: string; version?: string };
  securityReport: {
    riskLevel: 'low' | 'medium' | 'high';
    findings: Array<{ type: string; file: string; line: number; snippet: string; severity: string }>;
  };
  gateResults?: Array<{ type: string; name: string; satisfied: boolean; message?: string }>;
}

/** 来源标签 */
const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  clawhub: { label: 'ClawHub', color: 'bg-purple-100 text-purple-700' },
  github: { label: 'GitHub', color: 'bg-gray-100 text-gray-700' },
  local: { label: '本地', color: 'bg-blue-100 text-blue-700' },
};

/** 风险等级样式 */
const RISK_STYLES: Record<string, { label: string; color: string }> = {
  low: { label: '低风险', color: 'text-green-600' },
  medium: { label: '中风险', color: 'text-yellow-600' },
  high: { label: '高风险', color: 'text-red-600' },
};

/** Skill 管理页面 */
export default function SkillPage() {
  const [skills, setSkills] = useState<InstalledSkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [githubUrl, setGithubUrl] = useState('');
  const [prepareResult, setPrepareResult] = useState<PrepareResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  /** 加载已安装列表 */
  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<{ skills: InstalledSkillItem[] }>('/skill/list');
      setSkills(data.skills);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  /** 搜索 Skill */
  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError('');
    try {
      const data = await post<{ results: SearchResultItem[] }>('/skill/search', {
        query: searchQuery.trim(),
        limit: 10,
      });
      setSearchResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  /** 准备安装（ClawHub） */
  const handlePrepare = useCallback(async (slug: string, source: 'clawhub' | 'github') => {
    setInstalling(true);
    setError('');
    try {
      const data = await post<{ result: PrepareResult }>('/skill/prepare', {
        source,
        identifier: slug,
      });
      setPrepareResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '准备安装失败');
    } finally {
      setInstalling(false);
    }
  }, []);

  /** 从 GitHub URL 安装 */
  const handleGitHubInstall = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubUrl.trim()) return;
    await handlePrepare(githubUrl.trim(), 'github');
    setGithubUrl('');
  }, [githubUrl, handlePrepare]);

  /** 确认安装 */
  const handleConfirm = useCallback(async () => {
    if (!prepareResult) return;
    setInstalling(true);
    setError('');
    try {
      await post('/skill/confirm', { prepareId: prepareResult.prepareId });
      setPrepareResult(null);
      await fetchSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setInstalling(false);
    }
  }, [prepareResult, fetchSkills]);

  /** 卸载 */
  const handleUninstall = useCallback(async (name: string) => {
    try {
      await del(`/skill/${encodeURIComponent(name)}`);
      await fetchSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : '卸载失败');
    }
  }, [fetchSkills]);

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Skill 管理</h2>

        {/* 搜索 ClawHub */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索 ClawHub Skill..."
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/30 focus:border-[#00d4aa]"
          />
          <button
            type="submit"
            disabled={!searchQuery.trim() || searching}
            className="px-4 py-2 text-sm font-medium text-white bg-[#00d4aa] rounded-lg hover:bg-[#00a88a] disabled:opacity-50 transition-colors"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
        </form>

        {/* GitHub URL 安装 */}
        <form onSubmit={handleGitHubInstall} className="flex gap-2">
          <input
            type="text"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="GitHub URL 或 owner/repo（兼容 skills.sh 生态）"
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/30 focus:border-[#00d4aa]"
          />
          <button
            type="submit"
            disabled={!githubUrl.trim() || installing}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            从 GitHub 安装
          </button>
        </form>

        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>

      {/* 安装确认弹层 */}
      {prepareResult && (
        <div className="px-6 py-4 bg-yellow-50 border-b border-yellow-200">
          <h3 className="text-sm font-bold text-gray-900 mb-2">
            确认安装: {prepareResult.metadata.name}
            {prepareResult.metadata.version && ` v${prepareResult.metadata.version}`}
          </h3>
          <p className="text-xs text-gray-600 mb-2">{prepareResult.metadata.description}</p>

          {/* 安全报告 */}
          <div className="mb-2">
            <span className={`text-xs font-medium ${RISK_STYLES[prepareResult.securityReport.riskLevel]?.color ?? ''}`}>
              安全评估: {RISK_STYLES[prepareResult.securityReport.riskLevel]?.label}
            </span>
            {prepareResult.securityReport.findings.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {prepareResult.securityReport.findings.slice(0, 5).map((f, i) => (
                  <li key={i} className="text-xs text-gray-500">
                    [{f.severity}] {f.file}:{f.line} — {f.snippet}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 门控结果 */}
          {prepareResult.gateResults && prepareResult.gateResults.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-medium text-gray-700">门控检查:</p>
              <ul className="mt-0.5 space-y-0.5">
                {prepareResult.gateResults.map((g, i) => (
                  <li key={i} className={`text-xs ${g.satisfied ? 'text-green-600' : 'text-red-500'}`}>
                    {g.satisfied ? '✓' : '✗'} {g.type}: {g.name} {g.message ?? ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleConfirm}
              disabled={installing || prepareResult.securityReport.riskLevel === 'high'}
              className="px-4 py-1.5 text-sm font-medium text-white bg-[#00d4aa] rounded-lg hover:bg-[#00a88a] disabled:opacity-50 transition-colors"
            >
              {installing ? '安装中...' : '确认安装'}
            </button>
            <button
              onClick={() => setPrepareResult(null)}
              className="px-4 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 搜索结果 */}
      {searchResults.length > 0 && (
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-2">搜索结果</h3>
          <div className="space-y-2">
            {searchResults.map((r) => {
              const sourceStyle = SOURCE_LABELS[r.source] ?? SOURCE_LABELS.local;
              return (
                <div key={`${r.source}-${r.name}`} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-500 truncate">{r.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${sourceStyle.color}`}>{sourceStyle.label}</span>
                      {r.version && <span className="text-xs text-gray-400">v{r.version}</span>}
                      {r.downloads !== undefined && <span className="text-xs text-gray-400">{r.downloads} 下载</span>}
                    </div>
                  </div>
                  {r.source !== 'local' && (
                    <button
                      onClick={() => handlePrepare(r.slug ?? r.name, r.source as 'clawhub' | 'github')}
                      disabled={installing}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-[#00d4aa] rounded-lg hover:bg-[#00a88a] disabled:opacity-50 transition-colors"
                    >
                      安装
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 已安装列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-sm">加载中...</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-lg">暂无已安装 Skill</p>
            <p className="text-sm mt-1">搜索 ClawHub 或输入 GitHub URL 安装 Skill</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            <p className="text-xs text-gray-400 mb-2">已安装 {skills.length} 个 Skill</p>
            {skills.map((skill) => {
              const sourceStyle = SOURCE_LABELS[skill.source] ?? SOURCE_LABELS.local;
              return (
                <div key={skill.name} className="flex items-center gap-4 p-4 bg-white rounded-lg border border-gray-200 hover:border-[#00d4aa]/40 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00d4aa]/20 to-[#00a88a]/20 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-[#00a88a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{skill.name}</p>
                    <p className="text-xs text-gray-500 truncate">{skill.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${sourceStyle.color}`}>{sourceStyle.label}</span>
                      {skill.version && <span className="text-xs text-gray-400">v{skill.version}</span>}
                      {!skill.gatesPassed && <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-600">门控未通过</span>}
                      {skill.disableModelInvocation && <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">手动触发</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUninstall(skill.name)}
                    className="p-1.5 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="卸载"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
