'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { normalizeTrustedQrCodeUrl } from '@weiling-ai/shared';
import { useLocale } from '@/components/providers/locale-provider';
import { SectionCard } from '@/components/layout/section-card';
import { Button } from '@/components/ui/button';
import { getQrCodeExpiresAt, isQrCodeExpired } from '@/lib/qr-code-expiry';

interface QrCodePanelProps {
  actions?: ReactNode;
  compact?: boolean;
  embedded?: boolean;
  qrCodeId: string | null;
  qrCodeIssuedAt?: string | null;
  qrCodeUrl: string | null;
}

export function QrCodePanel({
  actions,
  compact = false,
  embedded = false,
  qrCodeId,
  qrCodeIssuedAt = null,
  qrCodeUrl,
}: QrCodePanelProps) {
  const { t } = useLocale();
  const [now, setNow] = useState(0);
  const expiresAt = getQrCodeExpiresAt(qrCodeIssuedAt);
  const expired = now > 0 && Boolean(qrCodeUrl) && isQrCodeExpired(qrCodeIssuedAt, now);
  const trustedQrCodeUrl = expired ? null : normalizeTrustedQrCodeUrl(qrCodeUrl);
  const qrPreviewUrl = trustedQrCodeUrl ? `/api/qrcode?value=${encodeURIComponent(trustedQrCodeUrl)}` : null;

  useEffect(() => {
    setNow(Date.now());
    if (!qrCodeIssuedAt || !qrCodeUrl) return undefined;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [qrCodeIssuedAt, qrCodeUrl]);

  const content = trustedQrCodeUrl ? (
    <div className="grid gap-4">
      {qrPreviewUrl ? (
        <div className="grid place-items-center rounded-[1.4rem] border border-[color:var(--border-soft)] bg-[color:var(--surface-elevated)] p-4">
          <img
            alt={qrCodeId ?? 'Weixin QR code'}
            className="w-full max-w-[320px] rounded-[1.2rem] border border-[color:var(--border-soft)] bg-white"
            src={qrPreviewUrl}
          />
        </div>
      ) : null}

      <div
        className={
          compact
            ? 'flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground'
            : 'grid gap-2 text-sm leading-6 text-muted-foreground'
        }
      >
        <div className="min-w-0">
          {qrCodeId ? (
            <p className="m-0">
              {t((messages) => messages.botDetail.qrId)}: <span className="font-mono text-foreground">{qrCodeId}</span>
            </p>
          ) : null}
          {compact ? null : (
            <>
              <p className="m-0">
                {qrCodeId
                  ? t((messages) => messages.botDetail.qrSourcePair)
                  : t((messages) => messages.botDetail.qrSourceUrlOnly)}
              </p>
              <p className="m-0">{t((messages) => messages.botDetail.qrPreviewDescription)}</p>
            </>
          )}
          {expiresAt && now > 0 ? (
            <p className="m-0">
              {t((messages) => messages.botDetail.qrExpiresIn({ time: formatRemaining(expiresAt.getTime() - now) }))}
            </p>
          ) : null}
        </div>

        <div
          aria-label={t((messages) => messages.botDetail.qrActionsRegion)}
          className="flex flex-wrap items-center gap-2"
          role="group"
        >
          <Button asChild size={compact ? 'sm' : 'default'} type="button" variant="outline">
            <a href={trustedQrCodeUrl} rel="noreferrer" target="_blank">
              {t((messages) => messages.botDetail.openQrPage)}
            </a>
          </Button>
          {actions}
        </div>
      </div>
    </div>
  ) : (
    <div className="grid gap-3 rounded-[1.25rem] border border-dashed border-[color:var(--border-strong)]/75 bg-[color:var(--surface-muted)]/72 px-5 py-6">
      <div className="grid gap-2">
        <strong className="text-base font-semibold text-foreground">{expired ? t((messages) => messages.botDetail.qrExpiredTitle) : t((messages) => messages.botDetail.noQrTitle)}</strong>
        <p className="m-0 text-sm leading-6 text-muted-foreground">{expired ? t((messages) => messages.botDetail.qrExpiredDescription) : t((messages) => messages.botDetail.noQrDescription)}</p>
      </div>
      {actions ? (
        <div
          aria-label={t((messages) => messages.botDetail.qrActionsRegion)}
          className="flex flex-wrap items-center gap-2"
          role="group"
        >
          {actions}
        </div>
      ) : null}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <SectionCard title={t((messages) => messages.botDetail.qrCode)}>
      {content}
    </SectionCard>
  );
}

function formatRemaining(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
