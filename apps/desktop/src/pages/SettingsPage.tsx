import { BRAND_NAME } from '@evoclaw/shared';

export default function SettingsPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <h2 className="text-lg font-bold text-slate-900">设置</h2>
        <p className="text-sm text-slate-400 mt-1">应用常规设置</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* 关于 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">关于</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">应用名称</span>
                <span className="text-sm text-slate-800 font-medium">{BRAND_NAME}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">架构</span>
                <span className="text-sm text-slate-800">Tauri 2.0 + Node.js Sidecar</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
