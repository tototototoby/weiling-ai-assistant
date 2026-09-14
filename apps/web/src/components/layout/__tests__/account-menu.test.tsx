// @vitest-environment jsdom

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { AccountMenu } from '../account-menu';

const { pushMock, signOutMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signOut: signOutMock,
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  document.cookie = 'locale=; Max-Age=0; path=/';
  document.cookie = 'theme=; Max-Age=0; path=/';
});

function renderAccountMenu(isAdmin = false) {
  return render(
    <ThemeProvider initialTheme="light">
      <LocaleProvider initialLocale="en">
        <AccountMenu email="admin@example.com" isAdmin={isAdmin} />
      </LocaleProvider>
    </ThemeProvider>
  );
}

it('renders account identity and disabled placeholder actions in the menu', async () => {
  renderAccountMenu();

  expect(screen.getByText('admin@example.com')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /open account menu/i }));

  expect(await screen.findByRole('menu')).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: /details/i })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('menuitem', { name: /settings/i })).toHaveAttribute('href', '/settings');
  expect(screen.getByRole('menuitem', { name: /logout/i })).toBeEnabled();
  expect(screen.getAllByText('Coming Soon')).toHaveLength(1);
});

it('shows the admin console entry only for admins', async () => {
  renderAccountMenu(true);

  await userEvent.click(screen.getByRole('button', { name: /open account menu/i }));

  expect(await screen.findByRole('menuitem', { name: /settings/i })).toHaveAttribute('href', '/admin/llm-profiles');
  expect(await screen.findByRole('menuitem', { name: /admin console/i })).toHaveAttribute('href', '/admin/sandbox-runtime');
});

it('signs out and redirects to login from the account menu', async () => {
  signOutMock.mockImplementation(async ({ fetchOptions }: {
    fetchOptions?: { onSuccess?: () => void };
  }) => {
    fetchOptions?.onSuccess?.();
    return {
      data: null,
      error: null,
    };
  });

  renderAccountMenu();

  await userEvent.click(screen.getByRole('button', { name: /open account menu/i }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /logout/i }));

  expect(signOutMock).toHaveBeenCalledWith(expect.objectContaining({
    fetchOptions: expect.objectContaining({
      onSuccess: expect.any(Function),
    }),
  }));
  expect(pushMock).toHaveBeenCalledWith('/login');
});
