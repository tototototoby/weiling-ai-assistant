// @vitest-environment jsdom

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const {
  getRegistrationDefaultProfileIdMock,
  listUserLlmProfilesMock,
  requireAdminServerSessionMock,
} = vi.hoisted(() => ({
  getRegistrationDefaultProfileIdMock: vi.fn(),
  listUserLlmProfilesMock: vi.fn(),
  requireAdminServerSessionMock: vi.fn(),
}));

vi.mock('@/lib/admin', () => ({
  requireAdminServerSession: requireAdminServerSessionMock,
}));

vi.mock('@/lib/employee-onboarding', () => ({
  getRegistrationDefaultProfileId: getRegistrationDefaultProfileIdMock,
}));

vi.mock('@/lib/llm-profiles', () => ({
  listUserLlmProfiles: listUserLlmProfilesMock,
}));

vi.mock('@/lib/locale', () => ({
  getMessages: () => ({
    settings: {
      pageDescription: 'Manage profiles in admin.',
      pageTitle: 'LLM Profiles',
    },
  }),
  getRequestLocale: vi.fn().mockResolvedValue('en'),
}));

vi.mock('@/components/settings/llm-profiles-console', () => ({
  LlmProfilesConsole: ({
    canManageRegistrationDefault,
    profiles,
    registrationDefaultProfileId,
  }: {
    canManageRegistrationDefault: boolean;
    profiles: Array<{ id: string }>;
    registrationDefaultProfileId: string | null;
  }) => (
    <div>
      {canManageRegistrationDefault ? 'default-enabled' : 'default-disabled'}
      {` profiles:${profiles.length} default:${registrationDefaultProfileId ?? 'none'}`}
    </div>
  ),
}));

it('loads administrator profiles and the onboarding default inside the admin page', async () => {
  requireAdminServerSessionMock.mockResolvedValue({
    user: { email: 'admin@example.com', id: 'admin_1' },
  });
  listUserLlmProfilesMock.mockResolvedValue([{ id: 'profile_1' }]);
  getRegistrationDefaultProfileIdMock.mockResolvedValue('profile_1');

  const { default: AdminLlmProfilesPage } = await import('../page');
  render(await AdminLlmProfilesPage());

  expect(screen.getByRole('heading', { name: 'LLM Profiles' })).toBeInTheDocument();
  expect(screen.getByText('default-enabled profiles:1 default:profile_1')).toBeInTheDocument();
  expect(requireAdminServerSessionMock).toHaveBeenCalledOnce();
  expect(listUserLlmProfilesMock).toHaveBeenCalledWith('admin_1');
});
