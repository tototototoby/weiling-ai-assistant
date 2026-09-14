'use client';

import { useState, useTransition } from 'react';
import { useLocale } from '@/components/providers/locale-provider';
import { SectionCard } from '@/components/layout/section-card';
import { ErrorNotice } from '@/components/ui/error-notice';
import type { BotDetailItem } from '@/lib/bot-service';
import { BotConfirmActionButton } from './bot-confirm-action-button';
import { BotQrShareControls } from './bot-qr-share-controls';
import { QrCodePanel } from './qr-code-panel';

interface BotQrSharePanelProps {
  bot: BotDetailItem;
  onBotUpdated(bot: BotDetailItem): void;
}

interface BotCommandResponse {
  data: BotDetailItem | null;
  error: {
    code: string;
    message: string;
  } | null;
}

export function BotQrSharePanel({ bot, onBotUpdated }: BotQrSharePanelProps) {
  const { t } = useLocale();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isQrSharePending, setIsQrSharePending] = useState(false);
  const [isPending, startTransition] = useTransition();
  const shouldShowQr = bot.status === 'waiting_for_qr';
  const isActionDisabled = isPending || isQrSharePending;

  return (
    <section aria-label={t((messages) => messages.botDetail.qrShareTitle)}>
      <SectionCard
        contentClassName="grid gap-5"
        title={t((messages) => messages.botDetail.qrShareTitle)}
      >
        <div className="grid gap-3">
          <QrCodePanel
            actions={
              <BotConfirmActionButton
                actionLabel={t((messages) => messages.botDetail.reissueQr)}
                cancelLabel={t((messages) => messages.botDetail.cancelDelete)}
                confirmLabel={t((messages) => messages.botDetail.confirmAction({
                  action: messages.botDetail.reissueQr,
                }))}
                disabled={isActionDisabled}
                description={t((messages) => messages.botDetail.confirmActionDescription({
                  action: messages.botDetail.reissueQr,
                }))}
                isPending={isPending}
                onConfirm={runQrReissue}
                size="sm"
                variant="outline"
              />
            }
            compact
            embedded
            qrCodeId={shouldShowQr ? bot.lastQrCodeId : null}
            qrCodeIssuedAt={shouldShowQr ? bot.qrCodeIssuedAt : null}
            qrCodeUrl={shouldShowQr ? bot.lastQrCodeUrl : null}
          />
        </div>

        <BotQrShareControls
          botId={bot.id}
          disabled={isPending}
          onPendingChange={setIsQrSharePending}
        />

        {errorMessage ? (
          <ErrorNotice>{errorMessage}</ErrorNotice>
        ) : null}
      </SectionCard>
    </section>
  );

  function runQrReissue() {
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/bots/${bot.id}/reissue-qr`, {
          method: 'POST',
        });
        const payload = (await response.json()) as BotCommandResponse;

        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.botDetail.reissueQrFailed));
          return;
        }

        onBotUpdated(payload.data);
      } catch {
        setErrorMessage(t((messages) => messages.botDetail.reissueQrFailed));
      }
    });
  }
}
