'use client';

import { UserRound } from 'lucide-react';
import { EmptyState } from '@/components/layout/empty-state';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import type { MyTeamPayload } from '@/lib/group-admin';
import { getEmployeeDisplayName } from '@/lib/employee-display';

export function MeTeamConsole({ initialPayload }: { initialPayload: MyTeamPayload }) {
  if (!initialPayload.bound) {
    return (
      <EmptyState
        description="当前账号还没有绑定员工目录条目，请联系管理员完成绑定后再查看团队。"
        title="尚未绑定员工"
      />
    );
  }

  return (
    <div className="grid gap-6">
      {initialPayload.groups.map((group) => (
        <SectionCard
          contentClassName="grid gap-4"
          description={group.role === 'leader'
            ? '这是你管理的分组，可以查看成员绑定与最近活跃情况。'
            : `组长：${group.leaderName ?? '未设置'}`}
          key={group.groupId}
          title={`${group.groupName} · ${group.role === 'leader' ? '我管理的组' : '我所在的组'}`}
        >
          <div className="flex flex-wrap gap-2">
            <Badge variant={group.role === 'leader' ? 'success' : 'neutral'}>
              {group.role === 'leader' ? '组长' : '组员'}
            </Badge>
            <Badge variant="outline">{group.members.length} 名成员</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border-soft)] text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="py-3 pr-4 font-semibold">成员</th>
                  <th className="py-3 pr-4 font-semibold">Bot</th>
                  <th className="py-3 pr-4 font-semibold">近 7 天</th>
                  <th className="py-3 font-semibold">近 30 天</th>
                </tr>
              </thead>
              <tbody>
                {group.members.map((member) => (
                  <tr className="border-b border-[color:var(--border-soft)] last:border-b-0" key={member.employeeId}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-muted-foreground" />
                        <strong>{getEmployeeDisplayName(member) ?? member.employeeId}</strong>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={member.botBound ? 'success' : 'neutral'}>
                        {member.botBound ? '已绑定' : '未绑定'}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4">{member.activity7}</td>
                    <td className="py-3">{member.activity30}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
