import { AdminWecomConsole } from '@/components/admin/admin-wecom-console';
import { PageHeader } from '@/components/layout/page-header';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { getRepositories } from '@/lib/repositories';
import { listAdminWecom } from '@/lib/wecom-admin';

export const dynamic = 'force-dynamic';

export default async function AdminWecomPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const data = await listAdminWecom(getRepositories());

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.adminWecom.pageDescription}
        title={messages.adminWecom.pageTitle}
      />
      <AdminWecomConsole initialData={data} />
    </section>
  );
}
