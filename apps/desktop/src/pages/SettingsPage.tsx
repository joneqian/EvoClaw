import { useAppStore } from '../stores/app-store';

export default function SettingsPage() {
  const { theme, toggleTheme } = useAppStore();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">设置</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">应用常规设置</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* 外观设置 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">外观</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">主题模式</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">当前: {theme === 'dark' ? '深色' : '浅色'}</p>
              </div>
              <button
                onClick={toggleTheme}
                className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg
                  text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {theme === 'dark' ? '☀️ 切换浅色' : '🌙 切换深色'}
              </button>
            </div>
          </div>

          {/* 关于 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">关于</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">应用名称</span>
                <span className="text-sm text-gray-800 dark:text-gray-200 font-medium">EvoClaw</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">架构</span>
                <span className="text-sm text-gray-800 dark:text-gray-200">Tauri 2.0 + Node.js Sidecar</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
