import type {
  EmailDeliveryRecord,
  GlobalEmailConfigRecord,
} from '@weiling-ai/db';
import { describe, expect, it, vi } from 'vitest';
import { EmailDeliveryDispatcher } from '../email-delivery-dispatcher';
import { GlobalEmailSecretReader } from '../global-email-secret';
import { GlobalEmailSender } from '../global-email-sender';

describe('GlobalEmailSecretReader', () => {
  it('reads a configured environment secret without logging or transforming it', async () => {
    const reader = new GlobalEmailSecretReader({
      env: { EMAIL_SMTP_PASSWORD: '  local-only-secret  ' },
    });

    await expect(reader.read()).resolves.toBe('  local-only-secret  ');
  });

  it('reads a mounted secret file and removes only its terminal newline', async () => {
    const reader = new GlobalEmailSecretReader({
      env: { EMAIL_SMTP_PASSWORD_FILE: '/run/secrets/smtp-password' },
      readFileImpl: vi.fn().mockResolvedValue('file-secret\n'),
    });

    await expect(reader.read()).resolves.toBe('file-secret');
  });
});

describe('GlobalEmailSender', () => {
  it('maps SSL/STARTTLS config into a nodemailer transport and message', async () => {
    const createTransport = vi.fn().mockReturnValue({
      close: vi.fn(),
      sendMail: vi.fn().mockResolvedValue({ messageId: 'local-test' }),
    });
    const sender = new GlobalEmailSender({
      createTransport,
      secretReader: { read: vi.fn().mockResolvedValue('local-only-secret') },
    });

    await sender.send(createConfig(), {
      message: 'Body',
      recipientEmail: 'employee@example.com',
      subject: 'Subject',
    });

    expect(createTransport).toHaveBeenCalledWith({
      auth: { pass: 'local-only-secret', user: 'sender@example.com' },
      host: 'smtp.example.com',
      port: 465,
      secure: true,
    });
    expect(createTransport.mock.results[0]?.value.sendMail).toHaveBeenCalledWith({
      from: 'WeClaws <sender@example.com>',
      subject: 'Subject',
      text: 'Body',
      to: 'employee@example.com',
    });
  });
});

describe('EmailDeliveryDispatcher', () => {
  it('claims and marks a delivery sent, then records the observed revision', async () => {
    const delivery = createDelivery();
    const deliveries = {
      claimReady: vi.fn().mockResolvedValue([delivery]),
      markAttemptFailed: vi.fn(),
      markSent: vi.fn().mockResolvedValue(undefined),
    };
    const configStore = {
      ensure: vi.fn().mockResolvedValue(createConfig()),
      recordObservedRevision: vi.fn().mockResolvedValue(undefined),
    };
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const dispatcher = new EmailDeliveryDispatcher({
      config: configStore,
      deliveries,
      sender,
    });

    await dispatcher.runOnce(new Date('2026-08-05T00:00:00.000Z'));

    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), delivery);
    expect(deliveries.markSent).toHaveBeenCalledWith(delivery.id, expect.any(Date));
    expect(configStore.recordObservedRevision).toHaveBeenCalledWith(4);
  });

  it('leaves pending work untouched while email delivery is disabled', async () => {
    const deliveries = {
      claimReady: vi.fn(),
      markAttemptFailed: vi.fn(),
      markSent: vi.fn(),
    };
    const dispatcher = new EmailDeliveryDispatcher({
      config: {
        ensure: vi.fn().mockResolvedValue({ ...createConfig(), enabled: false }),
        recordObservedRevision: vi.fn(),
      },
      deliveries,
      sender: { send: vi.fn() },
    });

    await dispatcher.runOnce();

    expect(deliveries.claimReady).not.toHaveBeenCalled();
  });
});

function createConfig(): GlobalEmailConfigRecord {
  const now = new Date('2026-08-05T00:00:00.000Z');
  return {
    createdAt: now,
    enabled: true,
    id: 'global',
    observedRevision: null,
    revision: 4,
    senderEmail: 'sender@example.com',
    senderName: 'WeClaws',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecurity: 'ssl',
    updatedAt: now,
    updatedByUserId: 'admin_1',
  };
}

function createDelivery(): EmailDeliveryRecord {
  const now = new Date('2026-08-05T00:00:00.000Z');
  return {
    attemptCount: 1,
    botInstanceId: 'bot_1',
    createdAt: now,
    createdByUserId: 'admin_1',
    id: 'email_1',
    lastError: null,
    message: 'Body',
    nextAttemptAt: now,
    recipientEmail: 'employee@example.com',
    recipientUserId: 'user_1',
    semanticKey: 'admin:email_1',
    sentAt: null,
    source: 'admin',
    status: 'delivering',
    subject: 'Subject',
    updatedAt: now,
  };
}
