import {
  accounts,
  sessions,
  users,
  verifications,
} from '@weiling-ai/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { getEnv } from './env';
import { inviteOnlyRegistrationPlugin } from './auth-invite';
import { getDatabaseClient } from './repositories';

export type WebAuth = ReturnType<typeof betterAuth>;
export type AuthInstance = ReturnType<typeof createAuth>;

let cachedAuth: AuthInstance | null = null;

export function getAuth(): AuthInstance {
  if (!cachedAuth) {
    cachedAuth = createAuth();
  }

  return cachedAuth;
}

function createAuth() {
  const env = getEnv();
  const databaseClient = getDatabaseClient();

  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(databaseClient.db, {
      provider: 'sqlite',
      schema: {
        users,
        sessions,
        accounts,
        verifications,
      },
      usePlural: true,
    }),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [inviteOnlyRegistrationPlugin, nextCookies()],
  });
}

export const auth = new Proxy({} as AuthInstance, {
  get(_target, property, receiver) {
    return Reflect.get(getAuth(), property, receiver);
  },
});
