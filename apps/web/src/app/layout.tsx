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

  return (
    <html data-theme={theme} lang={locale}>
      <body>
        <ThemeProvider initialTheme={theme}>
          <LocaleProvider initialLocale={locale}>
            <main className="min-h-screen">{children}</main>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
