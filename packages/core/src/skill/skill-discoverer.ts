/**
 * Skill 发现服务 — 搜索 ClawHub API + 扫描本地安装
 *
 * ClawHub API: GET /api/v1/search?q=&limit= （向量语义搜索）
 * skills.sh 无公开 REST API，通过 GitHub URL 直装兼容其生态
 */

import type { SkillSearchResult } from '@evoclaw/shared';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSkillMd } from './skill-parser.js';

/** ClawHub API 基地址 */
const CLAWHUB_API = 'https://clawhub.ai/api/v1';

/** 搜索缓存 TTL（10 分钟） */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 搜索缓存项 */
interface CacheEntry {
  results: SkillSearchResult[];
  timestamp: number;
}

/** Skill 发现器 */
export class SkillDiscoverer {
  private cache = new Map<string, CacheEntry>();
  private skillsBaseDir: string;

  constructor(skillsBaseDir?: string) {
    this.skillsBaseDir = skillsBaseDir ?? path.join(os.homedir(), '.evoclaw', 'skills');
  }

  /** 搜索 Skill（ClawHub + 本地） */
  async search(query: string, limit = 10): Promise<SkillSearchResult[]> {
    const results: SkillSearchResult[] = [];

    // 本地搜索（始终可用）
    const localResults = this.listLocal().filter(s =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase()),
    );
    results.push(...localResults);

    // ClawHub API 搜索
    const remoteResults = await this.searchClawHub(query, limit);
    results.push(...remoteResults);

    // 去重（本地优先）
    const seen = new Set(localResults.map(r => r.name));
    const deduplicated = [...localResults];
    for (const r of remoteResults) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        deduplicated.push(r);
      }
    }

    return deduplicated.slice(0, limit);
  }

  /** 搜索 ClawHub API */
  async searchClawHub(query: string, limit = 10): Promise<SkillSearchResult[]> {
    // 检查缓存
    const cacheKey = `clawhub:${query}:${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.results;
    }

    try {
      const url = `${CLAWHUB_API}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return [];

      const data = await res.json() as {
        results?: Array<{
          slug: string;
          displayName?: string;
          name?: string;
          summary?: string;
          description?: string;
          version?: string;
          author?: string;
          downloads?: number;
        }>;
      };

      const results: SkillSearchResult[] = (data.results ?? []).map(r => ({
        name: r.displayName ?? r.name ?? r.slug,
        slug: r.slug,
        description: r.summary ?? r.description ?? '',
        version: r.version,
        author: r.author,
        downloads: r.downloads,
        source: 'clawhub' as const,
      }));

      // 写入缓存
      this.cache.set(cacheKey, { results, timestamp: Date.now() });
      return results;
    } catch {
      // ClawHub 不可用 — 静默降级
      return [];
    }
  }

  /** 浏览 ClawHub 技能列表（热门/最新） */
  async browse(limit = 30, sort: 'trending' | 'updated' | 'downloads' = 'trending'): Promise<SkillSearchResult[]> {
    const cacheKey = `clawhub:browse:${sort}:${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.results;
    }

    try {
      const url = `${CLAWHUB_API}/skills?limit=${limit}&sort=${sort}&nonSuspiciousOnly=true`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return [];

      const data = await res.json() as {
        items?: Array<{
          slug: string;
          displayName?: string;
          name?: string;
          summary?: string;
          description?: string;
          version?: string;
          author?: string;
          downloads?: number;
        }>;
      };

      const results: SkillSearchResult[] = (data.items ?? []).map(r => ({
        name: r.displayName ?? r.name ?? r.slug,
        slug: r.slug,
        description: r.summary ?? r.description ?? '',
        version: r.version,
        author: r.author,
        downloads: r.downloads,
        source: 'clawhub' as const,
      }));

      this.cache.set(cacheKey, { results, timestamp: Date.now() });
      return results;
    } catch {
      return [];
    }
  }

  /** 获取 ClawHub Skill 详情 */
  async getSkillInfo(slug: string): Promise<SkillSearchResult | null> {
    try {
      const url = `${CLAWHUB_API}/skills/${encodeURIComponent(slug)}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return null;

      const data = await res.json() as {
        slug: string;
        name: string;
        description: string;
        version?: string;
        author?: string;
        downloads?: number;
      };

      return {
        name: data.name,
        slug: data.slug,
        description: data.description,
        version: data.version,
        author: data.author,
        downloads: data.downloads,
        source: 'clawhub',
      };
    } catch {
      return null;
    }
  }

  /** 扫描本地已安装的 Skill */
  listLocal(): SkillSearchResult[] {
    const results: SkillSearchResult[] = [];

    if (!fs.existsSync(this.skillsBaseDir)) return results;

    try {
      const entries = fs.readdirSync(this.skillsBaseDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(this.skillsBaseDir, entry.name);

        if (entry.isDirectory()) {
          // 子目录 → 查找 SKILL.md
          const skillMdPath = path.join(fullPath, 'SKILL.md');
          const parsed = this.tryParseSkillFile(skillMdPath);
          if (parsed) {
            results.push({
              name: parsed.name,
              description: parsed.description,
              version: parsed.version,
              source: 'local',
              localPath: fullPath,
            });
          }
        } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
          // 根目录 .md 文件直接作为 Skill
          const parsed = this.tryParseSkillFile(fullPath);
          if (parsed) {
            results.push({
              name: parsed.name,
              description: parsed.description,
              version: parsed.version,
              source: 'local',
              localPath: fullPath,
            });
          }
        }
      }
    } catch {
      // 忽略权限错误
    }

    return results;
  }

  /** 清除搜索缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  private tryParseSkillFile(filePath: string): { name: string; description: string; version?: string } | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseSkillMd(content);
      if (!parsed) return null;
      return {
        name: parsed.metadata.name,
        description: parsed.metadata.description,
        version: parsed.metadata.version,
      };
    } catch {
      return null;
    }
  }
}
