import { PageHeader } from '@/components/layout/page-header';
import { LlmProfilesConsole } from '@/components/settings/llm-profiles-console';
import { requireAdminServerSession } from '@/lib/admin';
import { getRegistrationDefaultProfileId } from '@/lib/employee-onboarding';
import { listUserLlmProfiles } from '@/lib/llm-profiles';
import { getMessages, getRequestLocale } from '@/lib/locale';

export const dynamic = 'force-dynamic';

export default async function AdminLlmProfilesPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const session = await requireAdminServerSession();
  const [profiles, registrationDefaultProfileId] = await Promise.all([
    listUserLlmProfiles(session.user.id),
    getRegistrationDefaultProfileId(),
  ]);

  return (
    <section className="grid gap-8">
      <PageHeader
        description={messages.settings.pageDescription}
        title={messages.settings.pageTitle}
      />
      <LlmProfilesConsole
        canManageRegistrationDefault
        profiles={profiles}
        registrationDefaultProfileId={registrationDefaultProfileId}
      />
    </section>
  );
}
