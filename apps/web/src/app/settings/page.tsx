import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { LlmProfilesConsole } from '@/components/settings/llm-profiles-console';
import { listUserLlmProfiles } from '@/lib/llm-profiles';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { requireServerSession } from '@/lib/session';
import { isAdminEmail } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const session = await requireServerSession();
  const canManageRegistrationDefault = isAdminEmail(session.user.email);
  if (canManageRegistrationDefault) {
    redirect('/admin/llm-profiles');
  }

  const profiles = await listUserLlmProfiles(session.user.id);

  return (
    <section className="grid max-w-5xl gap-6">
      <PageHeader
        description={messages.settings.pageDescription}
        title={messages.settings.pageTitle}
      />

      <LlmProfilesConsole
        profiles={profiles}
      />
    </section>
  );
}
