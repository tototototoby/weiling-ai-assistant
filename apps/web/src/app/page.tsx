import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { getServerSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getServerSession();

  if (!session) {
    redirect('/login');
  }

  redirect(isAdminEmail(session.user.email) ? '/admin/bots' : '/chat');
}
