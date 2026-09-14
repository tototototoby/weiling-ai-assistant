import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/layout/admin-shell';
import { isAdminEmail } from '@/lib/admin';
import { requireServerSession } from '@/lib/session';

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const session = await requireServerSession();

  if (!isAdminEmail(session.user.email)) {
    redirect('/bots');
  }

  return (
    <AdminShell
      avatarUrl={session.user.image || '/brand/weiling-mark.png'}
      email={session.user.email}
      userName={session.user.name}
    >
      {children}
    </AdminShell>
  );
}
