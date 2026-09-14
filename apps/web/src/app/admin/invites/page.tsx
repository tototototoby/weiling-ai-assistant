import { AdminInvitesConsole } from '@/components/admin/admin-invites-console';
import { EmployeeOnboardingConsole } from '@/components/admin/employee-onboarding-console';
import { PageHeader } from '@/components/layout/page-header';
import { toAdminInviteItems } from '@/lib/admin-invites';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { getRepositories } from '@/lib/repositories';
import { getEnv } from '@/lib/env';
import { listEmployeeDirectory, listEmployeeInviteLinks } from '@/lib/employee-onboarding';

export const dynamic = 'force-dynamic';

export default async function AdminInvitesPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const repositories = getRepositories();
  const [invites, employees, links] = await Promise.all([
    repositories.registrationInvites.listRecent(),
    listEmployeeDirectory(),
    listEmployeeInviteLinks(),
  ]);
  const inviteItems = await toAdminInviteItems(invites, repositories);

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.adminInvites.pageDescription}
        title={messages.adminInvites.pageTitle}
      />

      <AdminInvitesConsole
        invites={inviteItems}
      />
      <EmployeeOnboardingConsole appBaseUrl={getEnv().APP_BASE_URL} employees={employees} links={links} />
    </section>
  );
}
