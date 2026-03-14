import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  external: ['better-sqlite3'],
  sourcemap: true,
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});

// 复制迁移 SQL 文件到 dist（MigrationRunner 通过 import.meta.url 查找）
const srcMigrations = 'src/infrastructure/db/migrations';
// esbuild 将所有代码打包到 dist/server.mjs，import.meta.url 指向 dist/
// MigrationRunner 的 __dirname 在 bundle 后为 dist/，所以迁移目录是 dist/migrations/
const destMigrations = 'dist/migrations';
if (fs.existsSync(srcMigrations)) {
  fs.mkdirSync(destMigrations, { recursive: true });
  for (const file of fs.readdirSync(srcMigrations).filter(f => f.endsWith('.sql'))) {
    fs.copyFileSync(path.join(srcMigrations, file), path.join(destMigrations, file));
  }
  console.log(`Copied ${fs.readdirSync(destMigrations).length} migration files`);
}

console.log('Build complete: dist/server.mjs');
