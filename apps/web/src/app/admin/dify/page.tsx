import { AdminDifyConsole } from '@/components/admin/admin-dify-console';
import { PageHeader } from '@/components/layout/page-header';
import { listAdminDify } from '@/lib/dify-admin';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { getRepositories } from '@/lib/repositories';

export const dynamic = 'force-dynamic';

export default async function AdminDifyPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const data = await listAdminDify(getRepositories());

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.adminDify.pageDescription}
        title={messages.adminDify.pageTitle}
      />
      <AdminDifyConsole initialData={data} />
    </section>
  );
}
