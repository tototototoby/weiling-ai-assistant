import {
  createDatabaseClient as createUntrackedDatabaseClient,
  type DatabaseClientOptions,
} from '@weiling-ai/db';

type DatabaseClient = ReturnType<typeof createUntrackedDatabaseClient>;

const clients = new Set<DatabaseClient>();

export function createTrackedDatabaseClient(options?: DatabaseClientOptions) {
  const client = createUntrackedDatabaseClient(options);
  clients.add(client);
  return client;
}

export function closeTrackedDatabaseClients() {
  for (const client of clients) {
    try {
      client.close();
    } catch {
      // A test may have closed the client while exercising shutdown paths.
    }
  }
  clients.clear();
}
