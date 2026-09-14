import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminBotDetailConsole } from '@/components/admin/admin-bot-detail-console';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { getAdminBotDetail } from '@/lib/admin-bots';
import { ApiError } from '@/lib/api-error';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { getRepositories } from '@/lib/repositories';

export const dynamic = 'force-dynamic';

export default async function AdminBotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const { id } = await params;
  let data;

  try {
    data = await getAdminBotDetail(id, getRepositories());
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <section className="grid gap-8">
      <PageHeader
        actions={<Button asChild variant="outline"><Link href="/admin/bots">{messages.adminBots.backToBots}</Link></Button>}
        description={messages.adminBots.detailDescription}
        title={data.inventory.name}
      />
      <AdminBotDetailConsole initialData={data} />
    </section>
  );
}
