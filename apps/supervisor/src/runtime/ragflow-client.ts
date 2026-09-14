export interface RagflowKnowledgeQueryInput {
  apiBaseUrl: string;
  apiKey: string;
  datasetIds: readonly string[];
  fetchImpl?: typeof fetch;
  knowledgeBaseName: string;
  query: string;
}

export interface RagflowKnowledgeChunk {
  content: string;
  documentName: string | null;
  similarity: number | null;
}

export interface RagflowKnowledgeResult {
  answer: string;
  chunks: RagflowKnowledgeChunk[];
  knowledgeBase: string;
  ok: true;
  total: number;
}

export async function queryRagflowKnowledge(
  input: RagflowKnowledgeQueryInput,
): Promise<RagflowKnowledgeResult> {
  const query = input.query.trim();
  const apiBaseUrl = input.apiBaseUrl.trim().replace(/\/+$/, '');
  const apiKey = input.apiKey.trim();
  const datasetIds = [...new Set(input.datasetIds.map((value) => value.trim()).filter(Boolean))];

  if (!query) throw new Error('RAGFlow knowledge query must not be empty.');
  if (query.length > 8_000) throw new Error('RAGFlow knowledge query exceeds 8000 characters.');
  if (!apiBaseUrl || !apiKey || datasetIds.length === 0) {
    throw new Error('The administrator has not enabled and configured RAGFlow.');
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(resolveRetrievalUrl(apiBaseUrl), {
    body: JSON.stringify({
      dataset_ids: datasetIds,
      page: 1,
      page_size: 8,
      question: query,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(`RAGFlow query failed (${response.status}): ${readRagflowError(body)}`);
  }
  if (!isRecord(body) || (typeof body.code === 'number' && body.code !== 0)) {
    throw new Error(`RAGFlow query failed: ${readRagflowError(body)}`);
  }

  const data = isRecord(body.data) ? body.data : null;
  if (!data || !Array.isArray(data.chunks)) {
    throw new Error('RAGFlow returned an invalid knowledge response.');
  }

  const chunks = data.chunks
    .slice(0, 8)
    .map(sanitizeChunk)
    .filter((chunk): chunk is RagflowKnowledgeChunk => chunk !== null);
  const total = typeof data.total === 'number' && Number.isFinite(data.total)
    ? data.total
    : chunks.length;

  return {
    answer: chunks.map((chunk) => chunk.content).join('\n\n'),
    chunks,
    knowledgeBase: input.knowledgeBaseName.trim() || '公司 RAGFlow 知识库',
    ok: true,
    total,
  };
}

function resolveRetrievalUrl(apiBaseUrl: string): string {
  return apiBaseUrl.endsWith('/api/v1')
    ? `${apiBaseUrl}/retrieval`
    : `${apiBaseUrl}/api/v1/retrieval`;
}

function sanitizeChunk(value: unknown): RagflowKnowledgeChunk | null {
  if (!isRecord(value) || typeof value.content !== 'string' || !value.content.trim()) return null;
  return {
    content: value.content.trim().slice(0, 3_000),
    documentName: typeof value.document_name === 'string'
      ? value.document_name.slice(0, 300)
      : null,
    similarity: typeof value.similarity === 'number' && Number.isFinite(value.similarity)
      ? value.similarity
      : null,
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function readRagflowError(value: unknown): string {
  if (isRecord(value)) {
    for (const key of ['message', 'error', 'code']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate) return candidate;
      if (typeof candidate === 'number') return String(candidate);
    }
  }
  return 'unknown error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
