export interface ApiErrorShape {
  code: string;
  message: string;
  status: number;
}

export class ApiError extends Error implements ApiErrorShape {
  code: string;

  status: number;

  constructor({ code, message, status }: ApiErrorShape) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  return new ApiError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected server error.',
    status: 500,
  });
}

export function ok<T>(data: T, status: number = 200): Response {
  return Response.json(
    {
      data,
      error: null,
    },
    { status },
  );
}

export function fail(error: unknown): Response {
  const normalized = toApiError(error);

  return Response.json(
    {
      data: null,
      error: {
        code: normalized.code,
        message: normalized.message,
      },
    },
    { status: normalized.status },
  );
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError({
      code: 'INVALID_JSON_BODY',
      message: 'Request body must be valid JSON.',
      status: 400,
    });
  }
}
