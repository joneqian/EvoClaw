export default function AgentsPage() {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Agent 管理</h2>
      <p className="text-gray-500">暂无 Agent，点击下方按钮创建</p>
      <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
        创建 Agent
      </button>
    </div>
  );
}
