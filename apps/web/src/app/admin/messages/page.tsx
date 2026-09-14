import { AdminMessagesConsole } from '@/components/admin/admin-messages-console';
import { AdminBroadcastConfigCard } from '@/components/admin/admin-broadcast-config-card';
import { AdminDeliveryHealthCard } from '@/components/admin/admin-delivery-health-card';
import { PageHeader } from '@/components/layout/page-header';
import {
  getBroadcastConfig,
  getDeliveryHealthConfig,
  listDeliveryHealthChecks,
} from '@/lib/admin-configs';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { listAdminMessages } from '@/lib/admin-messages';
import { listEmployeeOptions } from '@/lib/group-admin';
import { getRepositories } from '@/lib/repositories';

export const dynamic = 'force-dynamic';

export default async function AdminMessagesPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const [data, broadcastConfig, deliveryHealthConfig, deliveryHealthChecks, employees] = await Promise.all([
    listAdminMessages(getRepositories()),
    getBroadcastConfig(),
    getDeliveryHealthConfig(),
    listDeliveryHealthChecks(),
    listEmployeeOptions(),
  ]);

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.adminMessages.pageDescription}
        title={messages.adminMessages.pageTitle}
      />
      <AdminMessagesConsole initialData={data} />
      <AdminBroadcastConfigCard employees={employees} initialConfig={broadcastConfig} />
      <AdminDeliveryHealthCard checks={deliveryHealthChecks} initialConfig={deliveryHealthConfig} />
    </section>
  );
}
