import { FastAgentJsonlEventSchema, type FastAgentJsonlEvent } from '@weiling-ai/shared';

export interface InvalidFastAgentLine {
  error: Error;
  line: string;
}

export interface FastAgentEventReaderOptions {
  onEvent(event: FastAgentJsonlEvent): void;
  onInvalidLine?(input: InvalidFastAgentLine): void;
}

export interface FastAgentEventReader {
  flush(): void;
  push(chunk: Buffer | string): void;
}

export function createFastAgentEventReader(options: FastAgentEventReaderOptions): FastAgentEventReader {
  let bufferedLine = '';

  const emitInvalidLine = (line: string, cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error('Invalid FastAgent JSONL line.');
    options.onInvalidLine?.({
      error,
      line,
    });
  };

  const processLine = (line: string) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmedLine) as unknown;
      const event = FastAgentJsonlEventSchema.parse(parsed);
      options.onEvent(event);
    } catch (error) {
      emitInvalidLine(trimmedLine, error);
    }
  };

  return {
    flush() {
      if (!bufferedLine) {
        return;
      }

      processLine(bufferedLine);
      bufferedLine = '';
    },
    push(chunk) {
      bufferedLine += chunk.toString();

      const lines = bufferedLine.split('\n');
      bufferedLine = lines.pop() ?? '';

      for (const line of lines) {
        processLine(line);
      }
    },
  };
}
