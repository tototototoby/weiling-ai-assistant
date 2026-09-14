import Link from 'next/link';
import { AdminBotsConsole } from '@/components/admin/admin-bots-console';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { listAdminBots } from '@/lib/admin-bots';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { getRepositories } from '@/lib/repositories';

export const dynamic = 'force-dynamic';

export default async function AdminBotsPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const data = await listAdminBots(getRepositories());

  return (
    <section className="grid gap-8">
      <PageHeader
        actions={(
          <Button asChild>
            <Link href="/admin/bots/new">{messages.shell.createBot}</Link>
          </Button>
        )}
        description={messages.adminBots.pageDescription}
        title={messages.adminBots.pageTitle}
      />
      <AdminBotsConsole initialData={data} />
    </section>
  );
}
