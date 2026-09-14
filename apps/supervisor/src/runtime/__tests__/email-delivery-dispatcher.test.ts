import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailDeliveryDispatcher } from '../email-delivery-dispatcher';

describe('EmailDeliveryDispatcher', () => {
  afterEach(() => vi.restoreAllMocks());

  it('claims and marks a queued email without touching SMTP when a sender stub is used', async () => {
    const delivery = {
      attemptCount: 1,
      botInstanceId: 'bot_1',
      createdAt: new Date(),
      createdByUserId: 'user_1',
      id: 'delivery_1',
      lastError: null,
      message: 'hello',
      nextAttemptAt: new Date(),
      recipientEmail: 'person@example.com',
      recipientUserId: 'user_1',
      semanticKey: 'admin-email:batch:bot_1',
      sentAt: null,
      source: 'admin' as const,
      status: 'delivering' as const,
      subject: 'Notice',
      updatedAt: new Date(),
    };
    const deliveries = {
      claimReady: vi.fn().mockResolvedValue([delivery]),
      markAttemptFailed: vi.fn(),
      markSent: vi.fn().mockResolvedValue(undefined),
    };
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const config = {
      ensure: vi.fn().mockResolvedValue({
        enabled: true,
        id: 'global',
        observedRevision: null,
        revision: 2,
        senderEmail: 'sender@example.com',
        senderName: 'Sender',
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpSecurity: 'ssl' as const,
      }),
      recordObservedRevision: vi.fn().mockResolvedValue(undefined),
    };

    await new EmailDeliveryDispatcher({ config, deliveries, sender }).runOnce();

    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ senderEmail: 'sender@example.com' }), delivery);
    expect(deliveries.markSent).toHaveBeenCalledWith('delivery_1', expect.any(Date));
    expect(deliveries.markAttemptFailed).not.toHaveBeenCalled();
  });

  it('returns a failed SMTP attempt to the retry queue with exponential backoff', async () => {
    const delivery = {
      attemptCount: 3,
      botInstanceId: 'bot_1',
      createdAt: new Date(),
      createdByUserId: 'user_1',
      id: 'delivery_1',
      lastError: null,
      message: 'hello',
      nextAttemptAt: new Date(),
      recipientEmail: 'person@example.com',
      recipientUserId: 'user_1',
      semanticKey: 'admin-email:batch:bot_1',
      sentAt: null,
      source: 'admin' as const,
      status: 'delivering' as const,
      subject: 'Notice',
      updatedAt: new Date(),
    };
    const deliveries = {
      claimReady: vi.fn().mockResolvedValue([delivery]),
      markAttemptFailed: vi.fn().mockResolvedValue('pending'),
      markSent: vi.fn(),
    };
    const config = {
      ensure: vi.fn().mockResolvedValue({
        enabled: true,
        id: 'global',
        observedRevision: null,
        revision: 2,
        senderEmail: 'sender@example.com',
        senderName: 'Sender',
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpSecurity: 'ssl' as const,
      }),
      recordObservedRevision: vi.fn().mockResolvedValue(undefined),
    };

    await new EmailDeliveryDispatcher({
      config,
      deliveries,
      sender: { send: vi.fn().mockRejectedValue(new Error('Temporary SMTP failure')) },
    }).runOnce();

    expect(deliveries.markSent).not.toHaveBeenCalled();
    expect(deliveries.markAttemptFailed).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Temporary SMTP failure',
      id: 'delivery_1',
      maxAttempts: 5,
      nextAttemptAt: expect.any(Date),
      updatedAt: expect.any(Date),
    }));
    const failure = deliveries.markAttemptFailed.mock.calls[0]?.[0];
    expect(failure.nextAttemptAt.getTime() - failure.updatedAt.getTime()).toBe(40_000);
  });
});
