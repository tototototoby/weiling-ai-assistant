'use client';

import { useEffect, useState } from 'react';
import { normalizeTrustedQrCodeUrl } from '@weiling-ai/shared';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';

interface PublicQrShareViewProps {
  token: string;
}

interface PublicQrSharePayload {
  canReissue: boolean;
  qrCodeExpired: boolean;
  qrCodeExpiresAt: string | null;
  qrCodeIssuedAt: string | null;
  qrCodeUrl: string | null;
  reissueRequestedAt: string | null;
  shareId: string;
  status: string;
  updatedAt: string;
}

interface PublicQrShareResponse {
  data: PublicQrSharePayload | null;
  error: {
    code: string;
    message: string;
  } | null;
}

const POLL_INTERVAL_MS = 2_000;

export function PublicQrShareView({ token }: PublicQrShareViewProps) {
  const { locale, t } = useLocale();
  const copy = getPublicShareCopy(locale);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [payload, setPayload] = useState<PublicQrSharePayload | null>(null);
  const [isReissuePending, setIsReissuePending] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/share/qr/${token}`, {
          cache: 'no-store',
        });
        const nextPayload = (await response.json()) as PublicQrShareResponse;

        if (isCancelled) {
          return;
        }

        if (!response.ok || !nextPayload.data) {
          setPayload(null);
          setErrorMessage(nextPayload.error?.message ?? t((messages) => messages.botDetail.noQrDescription));
          return;
        }

        setPayload(nextPayload.data);
        setErrorMessage(null);
      } catch {
        if (!isCancelled) {
          setErrorMessage(t((messages) => messages.botDetail.noQrDescription));
        }
      }
    };

    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [t, token]);

  const trustedQrCodeUrl = normalizeTrustedQrCodeUrl(payload?.qrCodeUrl ?? null);
  const qrPreviewUrl = trustedQrCodeUrl ? `/api/qrcode?value=${encodeURIComponent(trustedQrCodeUrl)}` : null;
  const qrExpired = payload?.qrCodeExpired ?? false;

  return (
    <section className="mx-auto grid min-h-screen w-full max-w-3xl content-center gap-6 px-6 py-10">
      <div className="grid gap-5 rounded-[1.65rem] border border-[color:var(--border-soft)] bg-[color:var(--surface)]/92 p-6 shadow-[var(--shadow-panel)]">
        <div className="flex items-center gap-4">
          <img
            alt={copy.avatarAlt}
            className="h-16 w-16 shrink-0 rounded-[1.25rem] border border-[color:var(--border-soft)] object-cover"
            height="64"
            src="/brand/weiling-mark.png"
            width="64"
          />
          <div className="grid min-w-0 gap-1.5">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-soft)]">
              {copy.eyebrow}
            </p>
            <h1 className="m-0 text-3xl font-semibold text-foreground">
              {copy.title}
            </h1>
          </div>
        </div>
        <p className="m-0 text-sm leading-6 text-muted-foreground">
          {trustedQrCodeUrl ? copy.readyDescription : qrExpired ? copy.expiredDescription : copy.waitingDescription}
        </p>
      </div>

      <div className="grid gap-4 rounded-[1.65rem] border border-[color:var(--border-soft)] bg-[color:var(--surface)]/92 p-6 shadow-[var(--shadow-panel)]">
        {qrPreviewUrl ? (
          <div className="grid place-items-center rounded-[1.4rem] border border-[color:var(--border-soft)] bg-[color:var(--surface-elevated)] p-4">
            <img
              alt={payload?.shareId ?? 'Weixin QR code'}
              className="w-full max-w-[320px] rounded-[1.2rem] border border-[color:var(--border-soft)] bg-white"
              src={qrPreviewUrl}
            />
          </div>
        ) : (
          <div className="grid gap-2 rounded-[1.25rem] border border-dashed border-[color:var(--border-strong)]/75 bg-[color:var(--surface-muted)]/72 px-5 py-6">
            <strong className="text-base font-semibold text-foreground">{qrExpired ? t((messages) => messages.botDetail.qrExpiredTitle) : t((messages) => messages.botDetail.noQrTitle)}</strong>
            <p className="m-0 text-sm leading-6 text-muted-foreground">
              {errorMessage ?? (qrExpired ? copy.expiredDescription : t((messages) => messages.botDetail.noQrDescription))}
            </p>
            {qrExpired ? (
              <div className="mt-2">
                <Button disabled={!payload?.canReissue || isReissuePending} onClick={requestReissue} type="button">
                  <RefreshCw className="h-4 w-4" />
                  {isReissuePending || payload?.reissueRequestedAt ? copy.reissuing : copy.reissue}
                </Button>
              </div>
            ) : null}
          </div>
        )}

        <div className="grid gap-2 text-sm text-muted-foreground">
          <p className="m-0">
            {t((messages) => messages.botDetail.statusLabel)}: <span className="text-foreground">{payload?.status ?? unavailableLabel(t)}</span>
          </p>
          <p className="m-0">
            {t((messages) => messages.botsList.updated)}:{' '}
            <LocalizedDateTime
              locale={locale}
              unavailableLabel={unavailableLabel(t)}
              value={payload?.updatedAt ?? null}
            />
          </p>
        </div>
      </div>

      <aside
        className="grid gap-3 rounded-[1.65rem] border border-[color:var(--border-soft)] bg-[color:var(--surface)]/92 p-6 shadow-[var(--shadow-panel)]"
        role="note"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[1rem] bg-[color:var(--accent-soft)] text-foreground">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="grid gap-0.5">
            <h2 className="m-0 text-lg font-semibold text-foreground">{copy.privacyTitle}</h2>
            <p className="m-0 text-sm font-medium text-foreground">{copy.privacySummary}</p>
          </div>
        </div>
        <p className="m-0 text-sm leading-7 text-muted-foreground">{copy.privacyDetails}</p>
      </aside>
    </section>
  );

  async function requestReissue() {
    setErrorMessage(null);
    setIsReissuePending(true);
    try {
      const response = await fetch(`/api/share/qr/${token}`, { method: 'POST' });
      const result = await response.json() as { data: { requested: boolean } | null; error: { message: string } | null };
      if (!response.ok || !result.data?.requested) {
        setErrorMessage(result.error?.message ?? copy.reissueFailed);
        return;
      }
      setPayload((current) => current ? {
        ...current,
        canReissue: false,
        qrCodeUrl: null,
        reissueRequestedAt: new Date().toISOString(),
      } : current);
    } catch {
      setErrorMessage(copy.reissueFailed);
    } finally {
      setIsReissuePending(false);
    }
  }
}

function getPublicShareCopy(locale: 'en' | 'zh-CN') {
  if (locale === 'en') {
    return {
      avatarAlt: 'weiling · 微Link AI Assistant avatar',
      eyebrow: 'Weixin AI Assistant',
      privacyDetails: 'It only processes content you actively send, assistant replies, and the minimum information needed to maintain the conversation. It does not ask for or read your Weixin password, contacts, Moments, past chats, or payment information, and it will not add contacts, transfer money, change your profile, or perform other account actions on your behalf.',
      privacySummary: 'This assistant is only here to chat with you in Weixin.',
      privacyTitle: 'Privacy and permissions',
      expiredDescription: 'This QR code has expired after 10 minutes. Request a fresh code, then scan again.',
      readyDescription: 'Scan the QR code with Weixin to start chatting. This page automatically follows the latest QR code.',
      reissue: 'Request new QR code',
      reissueFailed: 'Failed to request a new QR code. Try again.',
      reissuing: 'Requesting...',
      title: 'weiling · 微Link AI Assistant',
      waitingDescription: 'The QR code is being prepared. This page refreshes automatically, so please wait a moment.',
    };
  }

  return {
    avatarAlt: '微Link · 微灵 AI 助手头像',
    eyebrow: '微信 AI 助手',
    privacyDetails: '它仅处理你主动发送给助手的内容、助手回复，以及维持会话所必需的最少信息；不会索取或读取你的微信密码、通讯录、朋友圈、历史聊天或支付信息，也不会代替你添加好友、转账、修改资料或进行其他微信账号操作。',
    privacySummary: '本龙虾只在微信里与你进行 AI 对话。',
    privacyTitle: '关于隐私与权限',
    expiredDescription: '二维码已超过 10 分钟有效期，请点击重新出码后再扫码。',
    readyDescription: '请使用微信扫描下方二维码，与本龙虾开始对话。二维码更新后，本页面会自动刷新。',
    reissue: '重新出码',
    reissueFailed: '重新出码失败，请稍后再试。',
    reissuing: '正在重新出码...',
    title: '微Link · 微灵 AI 助手',
    waitingDescription: '二维码正在准备中，本页面会自动刷新，请稍候。',
  };
}

function unavailableLabel(t: ReturnType<typeof useLocale>['t']) {
  return t((messages) => messages.common.unavailable);
}
