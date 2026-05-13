/**
 * LanguageSwitcher — 界面语言切换器（M15 PR-U4）
 *
 * 用 react-i18next 提供的 useTranslation 切换 locale；
 * 状态自动写到 localStorage（i18n.ts 配 caches=['localStorage']）。
 */
import { useTranslation } from 'react-i18next';
import Select from './Select';
import { SUPPORTED_LOCALES, type Locale } from '../i18n';

const LABELS: Record<Locale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
};

interface LanguageSwitcherProps {
  className?: string;
}

export default function LanguageSwitcher({ className = 'w-[140px]' }: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const current = (SUPPORTED_LOCALES.includes(i18n.language as Locale)
    ? i18n.language
    : 'zh-CN') as Locale;

  return (
    <Select
      value={current}
      onChange={(val) => void i18n.changeLanguage(val)}
      options={SUPPORTED_LOCALES.map((code) => ({ value: code, label: LABELS[code] }))}
      className={className}
    />
  );
}
