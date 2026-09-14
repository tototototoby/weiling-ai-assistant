// @vitest-environment jsdom

import * as React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLocale } from '@/test/render';
import { beforeEach, expect, it, vi } from 'vitest';
import { SignInForm } from '../sign-in-form';

const { pushMock, refreshMock, signInEmailMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  signInEmailMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: {
      email: signInEmailMock,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it('renders English field labels when the locale is en', () => {
  renderWithLocale(<SignInForm />, { locale: 'en' });

  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
});

it('announces sign-in failures with an alert region', async () => {
  signInEmailMock.mockResolvedValue({
    error: {
      message: 'Nope.',
    },
  });

  renderWithLocale(<SignInForm />, { locale: 'en' });

  await userEvent.type(screen.getByLabelText('Email'), 'bot@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Nope.');
});

it('returns successful sign-ins to the role-aware home route', async () => {
  signInEmailMock.mockResolvedValue({ error: null });

  renderWithLocale(<SignInForm />, { locale: 'en' });

  await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  expect(pushMock).toHaveBeenCalledWith('/');
  expect(refreshMock).toHaveBeenCalled();
});
