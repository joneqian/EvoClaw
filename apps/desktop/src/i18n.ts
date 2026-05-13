/**
 * M15 PR-U4: i18n 初始化
 *
 * 双语支持：中文（zh-CN，默认 fallback）/ 英文（en-US）
 *
 * 探测顺序：localStorage → 浏览器语言 → fallback zh-CN
 * 持久化 key: `evoclaw:locale` / `healthclaw:locale`（跟随品牌名）
 *
 * 用法：
 *   const { t } = useTranslation();
 *   <span>{t('chat.placeholder')}</span>
 *
 * 命名空间策略：单一默认 namespace，按 page/component 前缀分类
 *   - app.* / nav.* / chat.* / agents.* / skills.* / memory.* /
 *     settings.* / security.* / models.* / etc.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { BRAND_NAME } from '@evoclaw/shared';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = `${BRAND_NAME.toLowerCase()}:locale`;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    fallbackLng: 'zh-CN',
    supportedLngs: SUPPORTED_LOCALES,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export default i18n;
