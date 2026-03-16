import { useAppStore } from '../stores/app-store';

export default function SettingsPage() {
  const { theme, toggleTheme } = useAppStore();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">设置</h2>
        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">应用常规设置</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* 外观设置 */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">外观</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">主题模式</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">当前: {theme === 'dark' ? '深色' : '浅色'}</p>
              </div>
              <button
                onClick={toggleTheme}
                className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                  text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                {theme === 'dark' ? '☀️ 切换浅色' : '🌙 切换深色'}
              </button>
            </div>
          </div>

          {/* 关于 */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">关于</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">应用名称</span>
                <span className="text-sm text-slate-800 dark:text-slate-200 font-medium">EvoClaw</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">架构</span>
                <span className="text-sm text-slate-800 dark:text-slate-200">Tauri 2.0 + Node.js Sidecar</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
