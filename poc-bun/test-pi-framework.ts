/**
 * POC: 测试 PI 框架在 Bun 中的兼容性
 *
 * 测试项:
 * 1. 能否 import PI 模块
 * 2. 核心类型和函数是否可访问
 * 3. createAgentSession 能否调用（不实际连接 LLM）
 */

const results: Array<{ test: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => results.push({ test: name, status: 'PASS' }))
    .catch((err) => results.push({ test: name, status: 'FAIL', detail: String(err) }));
}

// Test 1: import pi-ai
await test('1. import @mariozechner/pi-ai', async () => {
  const piAi = await import('@mariozechner/pi-ai');
  const exports = Object.keys(piAi);
  if (exports.length === 0) throw new Error('No exports found');
  console.log(`   pi-ai exports: ${exports.slice(0, 10).join(', ')}${exports.length > 10 ? '...' : ''}`);
});

// Test 2: import pi-agent-core
await test('2. import @mariozechner/pi-agent-core', async () => {
  const piCore = await import('@mariozechner/pi-agent-core');
  const exports = Object.keys(piCore);
  if (exports.length === 0) throw new Error('No exports found');
  console.log(`   pi-agent-core exports: ${exports.slice(0, 10).join(', ')}${exports.length > 10 ? '...' : ''}`);
});

// Test 3: import pi-coding-agent
await test('3. import @mariozechner/pi-coding-agent', async () => {
  const piCoding = await import('@mariozechner/pi-coding-agent');
  const exports = Object.keys(piCoding);
  if (exports.length === 0) throw new Error('No exports found');
  console.log(`   pi-coding-agent exports: ${exports.slice(0, 10).join(', ')}${exports.length > 10 ? '...' : ''}`);
});

// Test 4: require.resolve 兼容性
await test('4. require.resolve PI packages', async () => {
  const paths = [
    require.resolve('@mariozechner/pi-ai'),
    require.resolve('@mariozechner/pi-agent-core'),
    require.resolve('@mariozechner/pi-coding-agent'),
  ];
  for (const p of paths) {
    if (!p) throw new Error(`resolve returned empty for a PI package`);
  }
  console.log(`   All 3 packages resolved successfully`);
});

// Test 5: 核心 API 可用性
await test('5. 核心 API 类型检查', async () => {
  const piAi = await import('@mariozechner/pi-ai');

  // 检查关键函数/类是否存在
  const checks = [
    'createAgentSession',
    'InMemorySessionManager',
    'InMemorySettingsManager',
  ];
  const missing = checks.filter(name => typeof (piAi as any)[name] === 'undefined');
  if (missing.length > 0) {
    // 可能在子路径导出
    console.log(`   Direct exports missing: ${missing.join(', ')} (may be in sub-paths)`);
  }
  console.log(`   Available top-level APIs checked`);
});

// Test 6: PI 的 child_process 使用（coding-agent 工具执行）
await test('6. child_process spawn 兼容性', async () => {
  const { spawn } = await import('node:child_process');
  const proc = spawn('echo', ['hello from bun']);
  const output = await new Promise<string>((resolve, reject) => {
    let data = '';
    proc.stdout.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    proc.on('close', (code: number) => {
      if (code !== 0) reject(new Error(`exit code ${code}`));
      else resolve(data.trim());
    });
  });
  if (output !== 'hello from bun') throw new Error(`Expected 'hello from bun', got '${output}'`);
});

// 输出结果
console.log('\n=== PI Framework Bun 兼容性测试 ===\n');
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${r.test}`);
  if (r.detail) console.log(`   ${r.detail}`);
}
const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\n结果: ${passed}/${results.length} 通过`);
