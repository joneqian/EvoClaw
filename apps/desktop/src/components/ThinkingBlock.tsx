/**
 * ThinkingBlock — Extended Thinking 折叠展示组件
 *
 * 参考 Claude Code AssistantThinkingMessage:
 * - 默认折叠：显示 "∴ 正在思考..." + 展开按钮
 * - 展开后：Markdown 渲染完整思考内容
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ThinkingBlockProps {
  content: string;
  isExpanded: boolean;
  onToggle: () => void;
  isStreaming?: boolean;
}

export default function ThinkingBlock({ content, isExpanded, onToggle, isStreaming }: ThinkingBlockProps) {
  return (
    <div className="my-2 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
      {/* Header — 始终可见 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-base">∴</span>
          {isStreaming && !isExpanded ? (
            <span className="flex items-center gap-1">
              正在思考
              <span className="flex gap-0.5 ml-1">
                <span className="w-1 h-1 bg-slate-400 rounded-full animate-pulse" />
                <span className="w-1 h-1 bg-slate-400 rounded-full animate-pulse [animation-delay:150ms]" />
                <span className="w-1 h-1 bg-slate-400 rounded-full animate-pulse [animation-delay:300ms]" />
              </span>
            </span>
          ) : (
            <span>思考过程</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Content — 折叠区域 */}
      <div
        className={`transition-all duration-200 overflow-hidden ${
          isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 pb-3 border-t border-slate-200">
          <div className="mt-2 max-h-80 overflow-y-auto text-sm text-slate-600 prose prose-sm prose-slate">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || '(思考中...)'}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
