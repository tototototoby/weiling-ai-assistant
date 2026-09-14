import { EmployeeJoinForm } from '@/components/auth/employee-join-form';
import { AuthShell } from '@/components/layout/auth-shell';
import { getMessages, getRequestLocale } from '@/lib/locale';

export const dynamic = 'force-dynamic';

export default async function EmployeeJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const messages = getMessages(await getRequestLocale());
  const onboarding = messages.employeeOnboarding;
  return (
    <AuthShell
      brandImageUrl="/brand/weiling-mark.png"
      brandLabel="微Link · 微灵 AI 助手"
      eyebrow={onboarding.joinEyebrow}
      footer={onboarding.joinFooter}
      heroDescription={onboarding.joinHeroDescription}
      heroHighlights={[onboarding.joinHighlightModel, onboarding.joinHighlightWeixin, onboarding.joinHighlightLive]}
      heroTitle={onboarding.joinHeroTitle}
      subtitle={onboarding.joinSubtitle}
      title={onboarding.joinTitle}
    >
      <EmployeeJoinForm token={token} />
    </AuthShell>
  );
}
