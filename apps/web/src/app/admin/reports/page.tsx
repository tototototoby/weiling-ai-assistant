import { AdminReportsConsole } from '@/components/admin/admin-reports-console';
import { PageHeader } from '@/components/layout/page-header';
import { getAdminReports } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  const data = await getAdminReports(7);

  return (
    <section className="grid gap-8">
      <PageHeader
        description="按 Bot、主动消息和邮件投递汇总最近运行情况。"
        title="运行报表"
      />
      <AdminReportsConsole initialData={data} />
    </section>
  );
}
