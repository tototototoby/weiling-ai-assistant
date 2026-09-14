// @vitest-environment jsdom

import * as React from 'react';
import { screen } from '@testing-library/react';
import { renderWithLocale } from '@/test/render';
import { expect, it, vi } from 'vitest';
import { AuthShell } from '../auth-shell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

it('renders the shared product hero and a wider auth card next to route-specific form copy', () => {
  const { container } = renderWithLocale(
    <AuthShell
      eyebrow="Access"
      footer={<span>Need an account?</span>}
      heroDescription="Deploy personal AI assistants in the cloud through Weixin."
      heroHighlights={[
        'Multiple AI assistants',
        'Cloud hosted',
        'Weixin interaction',
        'Voice / image / file tasks',
      ]}
      heroTitle="Launch and manage multiple AI assistants after signup"
      subtitle="Use your email and password to sign in."
      title="Sign In"
    >
      <div>Form body</div>
    </AuthShell>,
    { locale: 'en' }
  );

  expect(screen.getByText('Launch and manage multiple AI assistants after signup')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Sign In' })).toBeInTheDocument();
  expect(screen.getByText('Multiple AI assistants')).toBeInTheDocument();
  expect(container.querySelector('[data-auth-shell-grid]')).toHaveClass('max-w-[110rem]', 'lg:gap-8');
  expect(container.querySelector('[data-auth-hero-title]')).toHaveClass('leading-[1.08]');
  expect(container.querySelector('[data-auth-hero-content]')).toHaveClass('max-w-[46rem]');
  expect(container.querySelector('[data-auth-hero-brand] [data-brand-frame]')).toHaveClass('h-[2.1rem]', 'w-[2.1rem]');
  expect(container.querySelector('[data-auth-hero-brand] [data-brand-label]')).toHaveClass('text-[18px]');
  expect(container.querySelector('[data-auth-card]')).toHaveClass('w-full', 'max-w-none', 'lg:max-w-[42rem]');
});

it('supports route-specific branding without changing the shared authentication shell', () => {
  const { container } = renderWithLocale(
    <AuthShell
      brandImageUrl="/brand/weiling-mark.png"
      brandLabel="微Link · 微灵 AI 助手"
      eyebrow="企业员工邀请"
      footer={<span>员工清单验证</span>}
      heroDescription="领取团队智能助理。"
      heroHighlights={[]}
      heroTitle="领取你的智能助理"
      subtitle="输入姓名或昵称。"
      title="验证员工身份"
    >
      <div>Form body</div>
    </AuthShell>,
    { locale: 'zh-CN' }
  );

  expect(screen.getAllByText('微Link · 微灵 AI 助手')).toHaveLength(2);
  expect(screen.getAllByAltText('微Link · 微灵 AI 助手 avatar')).toHaveLength(2);
  expect(container.querySelector('[data-auth-hero-brand] [data-brand-frame]')).toHaveClass('h-[4.5rem]', 'w-[4.5rem]');
});
