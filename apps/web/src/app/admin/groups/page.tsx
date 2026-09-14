import { AdminGroupsConsole } from '@/components/admin/admin-groups-console';
import { PageHeader } from '@/components/layout/page-header';
import { listAdminGroups, listEmployeeOptions } from '@/lib/group-admin';

export const dynamic = 'force-dynamic';

export default async function AdminGroupsPage() {
  const [groups, employees] = await Promise.all([
    listAdminGroups(),
    listEmployeeOptions(),
  ]);

  return (
    <section className="grid gap-8">
      <PageHeader
        description="维护员工分组与组长，并进入分组管理成员和任务闭环。"
        title="分组管理"
      />
      <AdminGroupsConsole employees={employees} initialGroups={groups} />
    </section>
  );
}
