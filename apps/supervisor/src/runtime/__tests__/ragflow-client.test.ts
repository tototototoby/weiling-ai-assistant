import { describe, expect, it, vi } from 'vitest';
import { queryRagflowKnowledge } from '../ragflow-client';

describe('queryRagflowKnowledge', () => {
  it('queries configured datasets and returns bounded chunks', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        chunks: [{ content: 'Leave policy', document_name: 'HR.pdf', similarity: 0.92 }],
        total: 1,
      },
    }), { status: 200 }));

    await expect(queryRagflowKnowledge({
      apiBaseUrl: 'https://ragflow.example.com/api/v1/',
      apiKey: 'secret',
      datasetIds: ['dataset_1', 'dataset_1'],
      fetchImpl,
      knowledgeBaseName: 'Company KB',
      query: ' leave policy ',
    })).resolves.toEqual({
      answer: 'Leave policy',
      chunks: [{ content: 'Leave policy', documentName: 'HR.pdf', similarity: 0.92 }],
      knowledgeBase: 'Company KB',
      ok: true,
      total: 1,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ragflow.example.com/api/v1/retrieval',
      expect.objectContaining({
        body: JSON.stringify({
          dataset_ids: ['dataset_1'],
          page: 1,
          page_size: 8,
          question: 'leave policy',
        }),
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
        method: 'POST',
      }),
    );
  });

  it('surfaces RAGFlow application errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 102,
      message: 'dataset not found',
    }), { status: 200 }));

    await expect(queryRagflowKnowledge({
      apiBaseUrl: 'https://ragflow.example.com',
      apiKey: 'secret',
      datasetIds: ['missing'],
      fetchImpl,
      knowledgeBaseName: 'Company KB',
      query: 'question',
    })).rejects.toThrow('dataset not found');
  });

  it('rejects an incomplete configuration before calling RAGFlow', async () => {
    const fetchImpl = vi.fn();
    await expect(queryRagflowKnowledge({
      apiBaseUrl: '',
      apiKey: '',
      datasetIds: [],
      fetchImpl,
      knowledgeBaseName: 'Company KB',
      query: 'question',
    })).rejects.toThrow('has not enabled and configured RAGFlow');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
