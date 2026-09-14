import { AdminFeishuConsole } from '@/components/admin/admin-feishu-console';
import { PageHeader } from '@/components/layout/page-header';
import { listAdminFeishu } from '@/lib/feishu-admin';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { getRepositories } from '@/lib/repositories';

export const dynamic = 'force-dynamic';

export default async function AdminFeishuPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const data = await listAdminFeishu(getRepositories());

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.adminFeishu.pageDescription}
        title={messages.adminFeishu.pageTitle}
      />
      <AdminFeishuConsole initialData={data} />
    </section>
  );
}
