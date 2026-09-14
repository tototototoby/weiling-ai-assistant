import { AdminGlobalAgentConsole } from '@/components/admin/admin-global-agent-console';
import { AdminImagegenConfigCard } from '@/components/admin/admin-imagegen-config-card';
import { PageHeader } from '@/components/layout/page-header';
import { getImagegenConfig } from '@/lib/admin-configs';
import { listAdminGlobalAgent } from '@/lib/global-agent-admin';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { getRepositories } from '@/lib/repositories';

export const dynamic = 'force-dynamic';

export default async function AdminGlobalAgentPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const [data, imagegenConfig] = await Promise.all([
    listAdminGlobalAgent(getRepositories()),
    getImagegenConfig(),
  ]);

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.adminGlobalAgent.pageDescription}
        title={messages.adminGlobalAgent.pageTitle}
      />
      <AdminGlobalAgentConsole initialData={data} />
      <AdminImagegenConfigCard initialConfig={imagegenConfig} />
    </section>
  );
}
