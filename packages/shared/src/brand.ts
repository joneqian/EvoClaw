// ⚠️ 此文件由 scripts/brand-apply.mjs 自动生成，请勿手动编辑
// 品牌: EvoClaw | 生成时间: 2026-03-19T06:44:53.687Z

/** 品牌配置类型 */
export interface BrandConfig {
  name: string;
  identifier: string;
  abbreviation: string;
  dataDir: string;
  dbFilename: string;
  configFilename: string;
  keychainService: string;
  eventPrefix: string;
  colors: {
    primary: string;
    primaryDark: string;
    gradient: [string, string];
  };
  windowTitle: string;
}

/** 当前品牌配置 */
export const BRAND: BrandConfig = {
  "name": "EvoClaw",
  "identifier": "com.evoclaw.app",
  "abbreviation": "EC",
  "dataDir": ".evoclaw",
  "dbFilename": "evoclaw.db",
  "configFilename": "evo_claw.json",
  "keychainService": "com.evoclaw",
  "eventPrefix": "evoclaw",
  "colors": {
    "primary": "#00d4aa",
    "primaryDark": "#00a88a",
    "gradient": [
      "#00d4aa",
      "#00a88a"
    ]
  },
  "windowTitle": "EvoClaw"
} as const;

// 便捷导出
export const BRAND_NAME = BRAND.name;
export const BRAND_ABBREVIATION = BRAND.abbreviation;
export const BRAND_IDENTIFIER = BRAND.identifier;
export const BRAND_DATA_DIR = BRAND.dataDir;
export const BRAND_DB_FILENAME = BRAND.dbFilename;
export const BRAND_CONFIG_FILENAME = BRAND.configFilename;
export const BRAND_KEYCHAIN_SERVICE = BRAND.keychainService;
export const BRAND_EVENT_PREFIX = BRAND.eventPrefix;
export const BRAND_COLORS = BRAND.colors;
