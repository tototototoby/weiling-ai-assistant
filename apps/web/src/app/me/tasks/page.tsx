import { MeTasksConsole } from '@/components/me/me-tasks-console';
import { PageHeader } from '@/components/layout/page-header';
import { listMyTasks } from '@/lib/group-admin';
import { requireServerSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MeTasksPage() {
  const session = await requireServerSession();
  const payload = await listMyTasks(session.user.id);

  return (
    <section className="grid gap-8">
      <PageHeader
        description="查看指派给你的任务，并提交完成说明与证据路径。"
        title="我的任务"
      />
      <MeTasksConsole initialPayload={payload} />
    </section>
  );
}
