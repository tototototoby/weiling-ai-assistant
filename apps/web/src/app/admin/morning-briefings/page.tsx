import { AdminMorningBriefingsConsole } from '@/components/admin/admin-morning-briefings-console';
import { PageHeader } from '@/components/layout/page-header';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { listAdminMorningBriefings } from '@/lib/morning-briefing-admin';
import { getRepositories } from '@/lib/repositories';

export const dynamic = 'force-dynamic';

export default async function AdminMorningBriefingsPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const data = await listAdminMorningBriefings(getRepositories());

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.adminMorningBriefings.pageDescription}
        title={messages.adminMorningBriefings.pageTitle}
      />

      <AdminMorningBriefingsConsole initialData={data} />
    </section>
  );
}
