import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { getRequestLocale } from '@/lib/locale';
import { getRequestTheme } from '@/lib/theme';

interface RootLayoutProps {
  children: ReactNode;
}

export const metadata: Metadata = {
  title: '微Link · 微灵 AI 助手',
  description: '微Link · 微灵 AI 助手 - 微信智能体管理平台。',
  icons: {
    icon: '/brand/weiling-mark.png',
  },
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const [locale, theme] = await Promise.all([
    getRequestLocale(),
    getRequestTheme(),
  ]);
  const sourceCodeUrl = process.env.WEILING_SOURCE_CODE_URL?.trim()
    || 'https://github.com/totototoby/weiling-ai-assistant';

  return (
    <html data-theme={theme} lang={locale}>
      <body>
        <ThemeProvider initialTheme={theme}>
          <LocaleProvider initialLocale={locale}>
            <main className="min-h-screen">{children}</main>
            <a
              className="fixed bottom-3 right-3 z-50 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)]/95 px-3 py-2 text-xs font-semibold text-[color:var(--text-soft)] shadow-[var(--shadow-soft)] backdrop-blur transition-colors hover:text-foreground"
              href={sourceCodeUrl}
              rel="noreferrer"
              target="_blank"
            >
              获取源码 · AGPL-3.0
            </a>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
