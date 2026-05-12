/**
 * Checkpoint Store — 内容寻址文件存储 + GC
 *
 * 每个被改文件的"改前快照"按 sha256 哈希存到 `.evoclaw/checkpoints/objects/<sha256>.gz`。
 * 多次 checkpoint 引用同一原文件（同一 sha256）只占一份磁盘——这是参考 Hermes
 * commit a0fedfbb1 single-store 设计的关键："去重 + 引用计数 + GC"，避免 per-call
 * 目录结构在长跑 sidecar 上撑爆磁盘。
 *
 * 引用计数不入 SQLite —— 通过扫描 checkpoint_log.files_json 中所有 sha256_before
 * 引用动态计算（GC 时一次性扫，不进热路径）。这样：
 * - 写：O(1) 把 blob gzip 后落盘（已存在则跳过）
 * - 读：O(1) 按 sha256 加载 + gunzip
 * - GC：O(N+M) 全表扫得到引用集，对 objects/ 列表差集删除
 *
 * 路径策略：
 * - DEFAULT_DATA_DIR/.evoclaw 下子目录 `checkpoints/objects/`
 * - 文件名 = sha256(content) + '.gz'，gzip 压缩节省 ~3-10× 磁盘
 *
 * 不可变性：objects/ 文件一旦写入永不修改，只能整体删除（GC）—— 让并发安全极简。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createLogger } from '../../infrastructure/logger.js';
import { getDataDir } from '../../infrastructure/data-dir.js';

const log = createLogger('checkpoint-store');

/** Checkpoint 根目录 */
function defaultRoot(): string {
  return path.join(getDataDir(), 'checkpoints');
}

function objectsDir(root: string): string {
  return path.join(root, 'objects');
}

function objectPath(root: string, sha256: string): string {
  return path.join(objectsDir(root), `${sha256}.gz`);
}

/** 按内容计算 sha256（hex） */
export function hashContent(content: Buffer | string): string {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return createHash('sha256').update(buf).digest('hex');
}

/** Checkpoint Store 实例（依赖注入 root，便于测试隔离） */
export class CheckpointStore {
  constructor(private readonly root: string = defaultRoot()) {
    fs.mkdirSync(objectsDir(this.root), { recursive: true });
  }

  /** 仅暴露给测试 / 路由的诊断字段 */
  get rootDir(): string {
    return this.root;
  }

  /**
   * 把内容存为 object（按 sha256 寻址，已存在则跳过）。
   *
   * @returns 内容的 sha256 哈希
   */
  writeObject(content: Buffer): string {
    const sha = hashContent(content);
    const target = objectPath(this.root, sha);
    if (fs.existsSync(target)) {
      log.debug(`[store] object 已存在跳过 sha=${sha.slice(0, 12)}... size=${content.length}`);
      return sha;
    }
    const gzipped = gzipSync(content);
    // 原子写：先写临时文件再 rename（防止半写状态被读到）
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, gzipped);
    fs.renameSync(tmp, target);
    log.debug(
      `[store] object 写入 sha=${sha.slice(0, 12)}... raw=${content.length} gz=${gzipped.length}`,
    );
    return sha;
  }

  /**
   * 按 sha256 读取内容并解压。
   *
   * @throws 文件不存在或解压失败
   */
  readObject(sha256: string): Buffer {
    const target = objectPath(this.root, sha256);
    const gzipped = fs.readFileSync(target);
    return gunzipSync(gzipped);
  }

  /** object 是否存在（GC / 诊断用） */
  hasObject(sha256: string): boolean {
    return fs.existsSync(objectPath(this.root, sha256));
  }

  /** 列出所有 object sha256（GC 用） */
  listObjects(): string[] {
    const dir = objectsDir(this.root);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.gz'))
      .map((f) => f.slice(0, -'.gz'.length));
  }

  /** 强制删除单个 object（GC 用） */
  deleteObject(sha256: string): void {
    const target = objectPath(this.root, sha256);
    try {
      fs.unlinkSync(target);
    } catch (err) {
      // 已不存在不算错
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`[store] 删除 object 失败 sha=${sha256.slice(0, 12)}...: ${(err as Error).message}`);
      }
    }
  }

  /**
   * GC：删除引用集之外的 object（孤儿）。
   *
   * @param referencedShas 仍被 checkpoint_log.files_json 引用的 sha256 集合
   * @returns 实际删除的 object 数
   */
  gcOrphans(referencedShas: Set<string>): number {
    const all = this.listObjects();
    let deleted = 0;
    for (const sha of all) {
      if (!referencedShas.has(sha)) {
        this.deleteObject(sha);
        deleted += 1;
      }
    }
    return deleted;
  }

  /** 当前 objects/ 占用字节（诊断 / GC 上限判断用） */
  totalBytes(): number {
    const dir = objectsDir(this.root);
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    for (const f of fs.readdirSync(dir)) {
      try {
        total += fs.statSync(path.join(dir, f)).size;
      } catch {
        // 并发删除等罕见路径，忽略
      }
    }
    return total;
  }
}
