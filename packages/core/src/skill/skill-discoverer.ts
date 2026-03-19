/**
 * Skill 发现服务 — lightmake.site API（技能商店） + ClawHub（下载安装） + 本地扫描
 *
 * 浏览/搜索: lightmake.site/api/skills（22000+ 技能，支持分类/排序/搜索/分页）
 * 下载安装: clawhub.ai/api/v1/download（ZIP 包下载）
 */

import type { SkillSearchResult, SkillGateResult } from '@evoclaw/shared';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSkillMd } from './skill-parser.js';
import { checkGates, allGatesPassed } from './skill-gate.js';

/** 已安装 Skill（含门控详情） */
export interface InstalledSkillDetail extends SkillSearchResult {
  installPath: string;
  gatesPassed: boolean;
  gateResults: SkillGateResult[];
  disableModelInvocation: boolean;
}

/** 技能商店 API 基地址 */
const SKILL_STORE_API = 'https://lightmake.site/api';

/** ClawHub 下载 API（安装仍用 ClawHub） */
const CLAWHUB_API = 'https://clawhub.ai/api/v1';

/** 搜索缓存 TTL（5 分钟） */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 缓存项 */
interface CacheEntry {
  results: SkillSearchResult[];
  total: number;
  timestamp: number;
}

/** 排序方式 */
export type SkillSortBy = 'score' | 'downloads' | 'installs';

/** 技能商店 API 返回的原始数据 */
interface StoreSkillItem {
  name: string;
  slug: string;
  description: string;
  description_zh?: string;
  version?: string;
  ownerName?: string;
  downloads?: number;
  installs?: number;
  stars?: number;
  score?: number;
  category?: string;
  homepage?: string;
  updated_at?: number;
  tags?: Record<string, string> | null;
}

/** Skill 发现器 */
export class SkillDiscoverer {
  private cache = new Map<string, CacheEntry>();
  private skillsBaseDir: string;

  constructor(skillsBaseDir?: string) {
    this.skillsBaseDir = skillsBaseDir ?? path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');
  }

  /** 浏览技能列表（支持分类、排序、分页） */
  async browse(opts?: {
    page?: number;
    pageSize?: number;
    sortBy?: SkillSortBy;
    category?: string;
    keyword?: string;
  }): Promise<{ results: SkillSearchResult[]; total: number }> {
    const { page = 1, pageSize = 24, sortBy = 'score', category, keyword } = opts ?? {};

    const cacheKey = `store:${page}:${pageSize}:${sortBy}:${category ?? ''}:${keyword ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { results: cached.results, total: cached.total };
    }

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        order: 'desc',
      });
      if (category) params.set('category', category);
      if (keyword) params.set('keyword', keyword);

      const res = await fetch(`${SKILL_STORE_API}/skills?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return { results: [], total: 0 };

      const data = await res.json() as {
        code: number;
        data: { skills: StoreSkillItem[]; total: number };
      };

      if (data.code !== 0) return { results: [], total: 0 };

      const results: SkillSearchResult[] = (data.data.skills ?? []).map(r => ({
        name: r.name,
        slug: r.slug,
        description: r.description,
        descriptionZh: r.description_zh,
        version: r.version,
        author: r.ownerName,
        downloads: r.downloads,
        installs: r.installs,
        stars: r.stars,
        score: r.score,
        category: r.category,
        source: 'clawhub' as const,
      }));

      const total = data.data.total ?? 0;
      this.cache.set(cacheKey, { results, total, timestamp: Date.now() });
      return { results, total };
    } catch {
      return { results: [], total: 0 };
    }
  }

  /** 搜索技能（本地 + 远程） */
  async search(query: string, limit = 24): Promise<SkillSearchResult[]> {
    const results: SkillSearchResult[] = [];

    // 本地搜索
    const localResults = this.listLocal().filter(s =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase()),
    );
    results.push(...localResults);

    // 远程搜索
    const { results: remote } = await this.browse({ keyword: query, pageSize: limit, sortBy: 'score' });

    // 去重（本地优先）
    const seen = new Set(localResults.map(r => r.name));
    for (const r of remote) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        results.push(r);
      }
    }

    return results.slice(0, limit);
  }

  /** 获取 ClawHub Skill 详情（用于安装） */
  async getSkillInfo(slug: string): Promise<SkillSearchResult | null> {
    try {
      const url = `${CLAWHUB_API}/skills/${encodeURIComponent(slug)}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return null;

      const data = await res.json() as {
        skill?: { slug: string; displayName?: string; summary?: string };
        latestVersion?: { version?: string };
      };

      if (!data.skill) return null;

      return {
        name: data.skill.displayName ?? data.skill.slug,
        slug: data.skill.slug,
        description: data.skill.summary ?? '',
        version: data.latestVersion?.version,
        source: 'clawhub' as const,
      };
    } catch {
      return null;
    }
  }

  /** 扫描本地已安装 Skill */
  listLocal(): SkillSearchResult[] {
    const results: SkillSearchResult[] = [];

    if (!fs.existsSync(this.skillsBaseDir)) return results;

    const entries = fs.readdirSync(this.skillsBaseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(this.skillsBaseDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMd(content);

        results.push({
          name: parsed?.metadata?.name || entry.name,
          slug: entry.name,
          description: parsed?.metadata?.description || '',
          source: 'local' as const,
          localPath: path.join(this.skillsBaseDir, entry.name),
        });
      } catch {
        results.push({
          name: entry.name,
          description: '',
          source: 'local' as const,
          localPath: path.join(this.skillsBaseDir, entry.name),
        });
      }
    }

    return results;
  }

  /** 扫描本地已安装 Skill（含门控检查详情） */
  listLocalWithGates(): InstalledSkillDetail[] {
    const results: InstalledSkillDetail[] = [];

    if (!fs.existsSync(this.skillsBaseDir)) return results;

    const entries = fs.readdirSync(this.skillsBaseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(this.skillsBaseDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMd(content);
        if (!parsed) continue;

        const gateResults = checkGates(parsed.metadata);

        results.push({
          name: parsed.metadata.name || entry.name,
          slug: entry.name,
          description: parsed.metadata.description || '',
          version: parsed.metadata.version,
          author: parsed.metadata.author,
          source: 'local' as const,
          installPath: path.join(this.skillsBaseDir, entry.name),
          gatesPassed: allGatesPassed(gateResults),
          gateResults,
          disableModelInvocation: parsed.metadata.disableModelInvocation ?? false,
        });
      } catch {
        results.push({
          name: entry.name,
          description: '',
          source: 'local' as const,
          installPath: path.join(this.skillsBaseDir, entry.name),
          gatesPassed: true,
          gateResults: [],
          disableModelInvocation: false,
        });
      }
    }

    return results;
  }
}
