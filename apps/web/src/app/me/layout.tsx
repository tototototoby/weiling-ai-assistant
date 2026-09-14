import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { isAdminEmail } from '@/lib/admin';
import { getFastAgentCliVersion } from '@/lib/fastagent-cli-version';
import { requireServerSession } from '@/lib/session';

export default async function MeLayout({ children }: { children: ReactNode }) {
  const [session, fastAgentCliVersion] = await Promise.all([
    requireServerSession(),
    getFastAgentCliVersion(),
  ]);

  return (
    <AppShell
      email={session.user.email}
      fastAgentCliVersion={fastAgentCliVersion}
      isAdmin={isAdminEmail(session.user.email)}
    >
      {children}
    </AppShell>
  );
}
