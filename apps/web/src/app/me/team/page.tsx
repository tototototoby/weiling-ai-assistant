import { MeTeamConsole } from '@/components/me/me-team-console';
import { PageHeader } from '@/components/layout/page-header';
import { listMyTeam } from '@/lib/group-admin';
import { requireServerSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MeTeamPage() {
  const session = await requireServerSession();
  const payload = await listMyTeam(session.user.id);

  return (
    <section className="grid gap-8">
      <PageHeader
        description="查看你所在或管理的分组、成员绑定情况与近 7/30 天活跃消息数。"
        title="我的团队"
      />
      <MeTeamConsole initialPayload={payload} />
    </section>
  );
}
