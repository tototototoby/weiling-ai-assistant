import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY } from '@weiling-ai/db';
import {
  DynamicAdminMessageCopyProvider,
  renderAdminMessageCopy,
} from '../admin-message-copy';

describe('DynamicAdminMessageCopyProvider', () => {
  it('reads the current copy on every request without a Supervisor restart', async () => {
    const ensure = vi.fn()
      .mockResolvedValueOnce({ ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY })
      .mockResolvedValueOnce({
        ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
        assistantName: '新助手',
        mealStandardReminder: '新助手提醒：{{date}}',
      });
    const provider = new DynamicAdminMessageCopyProvider({ ensure } as never);

    await expect(provider.getCopy()).resolves.toMatchObject({ assistantName: '微Link · 微灵 AI 助手' });
    await expect(provider.getCopy()).resolves.toMatchObject({
      assistantName: '新助手',
      mealStandardReminder: '新助手提醒：{{date}}',
    });
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('keeps the last known copy when the database is temporarily unavailable', async () => {
    const ensure = vi.fn()
      .mockResolvedValueOnce({ ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY, assistantName: '已缓存' })
      .mockRejectedValueOnce(new Error('database unavailable'));
    const provider = new DynamicAdminMessageCopyProvider({ ensure } as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await provider.getCopy();
      await expect(provider.getCopy()).resolves.toMatchObject({ assistantName: '已缓存' });
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to read the global admin message copy; using the last known copy.',
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('renderAdminMessageCopy', () => {
  it('replaces supported variables and preserves values omitted by the caller', () => {
    expect(renderAdminMessageCopy(
      '{{assistantName}} {{date}} {{employeeName}} {{unknown}}',
      { assistantName: '微Link · 微灵 AI 助手', date: '2026-07-28' },
    )).toBe('微Link · 微灵 AI 助手 2026-07-28 {{employeeName}} {{unknown}}');
  });
});
