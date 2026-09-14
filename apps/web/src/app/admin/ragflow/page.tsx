import { AdminRagflowConsole } from '@/components/admin/admin-ragflow-console';
import { PageHeader } from '@/components/layout/page-header';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { listAdminRagflow } from '@/lib/ragflow-admin';
import { getRepositories } from '@/lib/repositories';

export const dynamic = 'force-dynamic';

export default async function AdminRagflowPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const data = await listAdminRagflow(getRepositories());

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.adminRagflow.pageDescription}
        title={messages.adminRagflow.pageTitle}
      />
      <AdminRagflowConsole initialData={data} />
    </section>
  );
}
