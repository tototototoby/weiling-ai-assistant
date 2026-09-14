// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import type { AdminGlobalAgentPayload } from '@/lib/global-agent-admin';
import { AdminGlobalAgentConsole } from '../admin-global-agent-console';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('edits global documents and shows managed skill state in one console', async () => {
  renderWithLocale(<AdminGlobalAgentConsole initialData={createPayload()} />, { locale: 'en' });

  expect(screen.getByRole('tab', { name: 'AGENTS.md' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('AGENTS.md')).toHaveValue('# Global rules');
  expect(screen.getByText('morning-briefing')).toBeInTheDocument();
  expect(screen.getByText('1 of 2 skills enabled')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: 'SOUL.md' }));
  expect(screen.getByLabelText('SOUL.md')).toHaveValue('# Soul');
});

it('saves AGENTS and SOUL as one published revision', async () => {
  const nextPayload = createPayload();
  nextPayload.config.agentsMarkdown = '# Updated rules';
  nextPayload.config.revision = 4;
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: nextPayload, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);
  renderWithLocale(<AdminGlobalAgentConsole initialData={createPayload()} />, { locale: 'en' });

  await userEvent.clear(screen.getByLabelText('AGENTS.md'));
  await userEvent.type(screen.getByLabelText('AGENTS.md'), '# Updated rules');
  await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/global-agent', expect.objectContaining({
    body: JSON.stringify({ agentsMarkdown: '# Updated rules', soulMarkdown: '# Soul' }),
    method: 'PATCH',
  })));
});

it('toggles a managed skill through the admin policy API', async () => {
  const nextPayload = createPayload();
  nextPayload.skills[0] = { ...nextPayload.skills[0], enabled: false };
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: nextPayload, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);
  renderWithLocale(<AdminGlobalAgentConsole initialData={createPayload()} />, { locale: 'en' });

  await userEvent.click(screen.getByRole('button', { name: 'Disable' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/global-agent/skills/morning-briefing', expect.objectContaining({
    body: JSON.stringify({ enabled: false }),
    method: 'PATCH',
  })));
});

function createPayload(): AdminGlobalAgentPayload {
  return {
    applications: [{
      appliedRevision: 2,
      botId: 'bot_1',
      botName: 'Assistant One',
      lastSyncError: null,
      lastSyncedAt: '2026-07-21T02:00:00.000Z',
      syncStatus: 'pending',
    }],
    config: {
      agentsMarkdown: '# Global rules',
      revision: 3,
      soulMarkdown: '# Soul',
      updatedAt: '2026-07-21T02:00:00.000Z',
    },
    skills: [{
      content: '# Morning briefing',
      description: 'Create workday briefings.',
      enabled: true,
      name: 'morning-briefing',
    }, {
      content: '# Weather',
      description: 'Look up weather.',
      enabled: false,
      name: 'weather',
    }],
    summary: {
      botCount: 1,
      enabledSkillCount: 1,
      errorCount: 0,
      pendingCount: 1,
      syncedCount: 0,
    },
  };
}
