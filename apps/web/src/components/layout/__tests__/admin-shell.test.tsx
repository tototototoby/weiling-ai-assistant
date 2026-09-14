// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { AdminShell } from '../admin-shell';

const usePathnameMock = vi.fn(() => '/admin/sandbox-runtime');

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  usePathnameMock.mockReturnValue('/admin/sandbox-runtime');
  document.cookie = 'locale=; Max-Age=0; path=/';
  document.cookie = 'theme=; Max-Age=0; path=/';
});

function renderShell() {
  return render(
    <ThemeProvider initialTheme="light">
      <LocaleProvider initialLocale="en">
        <AdminShell email="admin@example.com">
          <div>Admin Content</div>
        </AdminShell>
      </LocaleProvider>
    </ThemeProvider>
  );
}

it('renders an independent admin navigation shell', () => {
  renderShell();

  const rail = document.querySelector('[data-admin-shell-nav="rail"]');
  const main = document.querySelector<HTMLElement>('[data-admin-shell-main]');

  expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  expect(screen.getByText('微Link · 微灵 AI 助手')).toBeInTheDocument();
  expect(screen.getByLabelText('微Link · 微灵 AI 助手 avatar')).toBeInTheDocument();
  expect(rail).not.toBeNull();
  expect(main).not.toBeNull();
  expect(main).not.toHaveClass('shadow-[var(--shadow-soft)]');
  expect(screen.getByRole('link', { name: 'Sandbox Runtime' })).toHaveAttribute('href', '/admin/sandbox-runtime');
  expect(screen.getByRole('link', { name: 'Sandbox Runtime' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Morning Briefings' })).toHaveAttribute('href', '/admin/morning-briefings');
  expect(screen.getByRole('link', { name: 'Global Agent' })).toHaveAttribute('href', '/admin/global-agent');
  expect(screen.getByRole('link', { name: 'LLM Profiles' })).toHaveAttribute('href', '/admin/llm-profiles');
  expect(screen.getByRole('link', { name: 'Dify Knowledge' })).toHaveAttribute('href', '/admin/dify');
  expect(screen.getByRole('link', { name: 'RAGFlow Knowledge' })).toHaveAttribute('href', '/admin/ragflow');
  expect(screen.getByRole('link', { name: 'WeCom' })).toHaveAttribute('href', '/admin/wecom');
  expect(screen.getByRole('link', { name: 'Invites' })).toHaveAttribute('href', '/admin/invites');
  expect(screen.getByRole('link', { name: 'Bots' })).toHaveAttribute('href', '/admin/bots');
  expect(screen.getByRole('link', { name: 'Create Bot' })).toHaveAttribute('href', '/admin/bots/new');
  expect(screen.queryByRole('link', { name: /overview/i })).not.toBeInTheDocument();
  expect(within(rail as HTMLElement).getByText('admin@example.com')).toBeInTheDocument();
  expect(screen.getByText('Admin Content')).toBeInTheDocument();
});

it('marks LLM Profiles active inside the admin console', () => {
  usePathnameMock.mockReturnValue('/admin/llm-profiles');

  renderShell();

  expect(screen.getByRole('link', { name: 'LLM Profiles' })).toHaveAttribute('aria-current', 'page');
});
