// @vitest-environment jsdom

import * as React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLocale } from '@/test/render';
import { afterEach, expect, it, vi } from 'vitest';
import { SignUpForm } from '../sign-up-form';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

it('renders Chinese CTA copy when the locale is zh-CN', () => {
  renderWithLocale(<SignUpForm />, { locale: 'zh-CN' });

  expect(screen.getByRole('button', { name: '创建账号' })).toBeInTheDocument();
});

it('shows required markers and keeps invite code after password', () => {
  const { container } = renderWithLocale(<SignUpForm />, { locale: 'en' });

  const fieldLabels = Array.from(container.querySelectorAll('[data-sign-up-label]')).map((label) =>
    label.textContent?.replace(/\s+/g, ' ').trim()
  );

  expect(fieldLabels).toEqual(['Email *', 'Password *', 'Invite Code']);
  expect(container.querySelectorAll('[data-required-indicator]')).toHaveLength(2);
  expect(screen.getByLabelText('Invite Code')).not.toBeRequired();
});

it('submits an invite code through the custom invite signup API when provided', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        user: {
          id: 'user_1',
        },
      },
      error: null,
    }),
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<SignUpForm />, { locale: 'en' });

  await userEvent.type(screen.getByLabelText('Email'), 'bot@example.com');
  await userEvent.type(screen.getByLabelText('Invite Code'), 'VALID-CODE');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Create Account' }));

  expect(fetchMock).toHaveBeenCalledWith('/api/auth/register-with-invite', expect.objectContaining({
    body: JSON.stringify({
      email: 'bot@example.com',
      inviteCode: 'VALID-CODE',
      password: 'password123',
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  }));
  expect(pushMock).toHaveBeenCalledWith('/');
  expect(refreshMock).toHaveBeenCalled();
});

it('disables submit while the invite signup request is pending', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

  renderWithLocale(<SignUpForm />, { locale: 'en' });

  await userEvent.type(screen.getByLabelText('Email'), 'bot@example.com');
  await userEvent.type(screen.getByLabelText('Invite Code'), 'VALID-CODE');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Create Account' }));

  expect(screen.getByRole('button', { name: 'Creating Account...' })).toBeDisabled();
});

it('announces invite sign-up failures with an alert region', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({
      data: null,
      error: {
        code: 'INVALID_INVITE',
        message: 'Invite is not valid.',
      },
    }),
  }));

  renderWithLocale(<SignUpForm />, { locale: 'en' });

  await userEvent.type(screen.getByLabelText('Email'), 'bot@example.com');
  await userEvent.type(screen.getByLabelText('Invite Code'), 'USED-CODE');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Create Account' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Invite is not valid.');
});
