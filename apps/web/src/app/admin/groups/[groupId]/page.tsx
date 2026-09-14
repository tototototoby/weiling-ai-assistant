import { notFound } from 'next/navigation';
import { AdminGroupDetailConsole } from '@/components/admin/admin-group-detail-console';
import { PageHeader } from '@/components/layout/page-header';
import {
  getAdminGroupDetail,
  listGroupTasks,
} from '@/lib/group-admin';

export const dynamic = 'force-dynamic';

interface GroupDetailPageProps {
  params: Promise<{ groupId: string }>;
}

export default async function AdminGroupDetailPage({ params }: GroupDetailPageProps) {
  const { groupId } = await params;
  const [detail, tasks] = await Promise.all([
    getAdminGroupDetail(groupId).catch(() => null),
    listGroupTasks(groupId).catch(() => null),
  ]);
  if (!detail || !tasks) notFound();

  return (
    <section className="grid gap-8">
      <PageHeader
        description={`${detail.group.name} · ${detail.group.memberCount} 名成员`}
        title={detail.group.name}
      />
      <AdminGroupDetailConsole
        initialGroup={detail.group}
        initialMembers={detail.members}
        initialTasks={tasks}
        initialUnassigned={detail.unassignedEmployees}
      />
    </section>
  );
}
