// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import { AdminRagflowConsole } from '../admin-ragflow-console';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps the API key redacted and saves normalized dataset IDs', async () => {
  const updated = createPayload({ datasetIds: ['dataset_a', 'dataset_b'], revision: 3 });
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: updated, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminRagflowConsole initialData={createPayload()} />, { locale: 'en' });

  expect(screen.getByLabelText('API Key')).toHaveValue('');
  expect(screen.getByText('Configured')).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('stored-secret');

  const datasetIds = screen.getByLabelText('Dataset IDs');
  await userEvent.clear(datasetIds);
  await userEvent.type(datasetIds, 'dataset_b, dataset_a{enter}dataset_b');
  await userEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/ragflow', expect.objectContaining({ method: 'PATCH' }));
  expect(body).toMatchObject({
    apiBaseUrl: 'https://ragflow.example.com/api/v1',
    datasetIds: ['dataset_a', 'dataset_b'],
    enabled: true,
    knowledgeBaseName: 'Company RAG',
  });
  expect(body).not.toHaveProperty('apiKey');
});

function createPayload(input: { datasetIds?: string[]; revision?: number } = {}) {
  return {
    applications: [{
      appliedRevision: 1,
      botId: 'bot_1',
      botName: 'Bot One',
      lastSyncError: null,
      lastSyncedAt: null,
      syncStatus: 'pending',
    }],
    config: {
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      apiKeyConfigured: true,
      datasetIds: input.datasetIds ?? ['dataset_a'],
      enabled: true,
      knowledgeBaseName: 'Company RAG',
      lastTestError: null,
      lastTestStatus: 'untested',
      lastTestedAt: null,
      revision: input.revision ?? 2,
      updatedAt: '2026-07-23T08:00:00.000Z',
    },
    summary: {
      botCount: 1,
      errorCount: 0,
      pendingCount: 1,
      syncedCount: 0,
    },
  };
}
