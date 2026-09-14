import type {
  WecomOnboardingBindResult,
  WecomOnboardingReceiptClaimResult,
  WecomOnboardingReceiptReplayResult,
  WecomOnboardingSessionRecord,
} from '@weiling-ai/db';
import {
  type AdminMessageCopyProvider,
  renderAdminMessageCopy,
} from './admin-message-copy';

const SESSION_TTL_MS = 15 * 60_000;

export interface WecomOnboardingRepositoryLike {
  beginOrGetSession(input: {
    expiresAt: Date;
    now: Date;
    wecomUserId: string;
  }): Promise<{ created: boolean; session: WecomOnboardingSessionRecord }>;
  bindByName(input: {
    messageId: string;
    name: string;
    now: Date;
    successResponse: string;
    wecomUserId: string;
  }): Promise<WecomOnboardingBindResult>;
  claimReceipt(input: {
    messageId: string;
    now: Date;
    staleBefore: Date;
    wecomUserId: string;
  }): Promise<WecomOnboardingReceiptClaimResult>;
  completeReceipt(messageId: string, response: string, now: Date): Promise<void>;
  findReceipt(
    messageId: string,
    wecomUserId: string,
  ): Promise<WecomOnboardingReceiptReplayResult | null>;
  recordFailedAttempt(input: {
    error?: string;
    now: Date;
    wecomUserId: string;
  }): Promise<WecomOnboardingSessionRecord>;
}

export interface WecomOnboardingMessageInput {
  messageId: string;
  now?: Date;
  text: string | null;
  wecomUserId: string;
}

export interface WecomOnboardingReceiptInput {
  messageId: string;
  wecomUserId: string;
}

export interface WecomOnboardingHandler {
  findReceiptResponse(input: WecomOnboardingReceiptInput): Promise<string | null>;
  handleMessage(input: WecomOnboardingMessageInput): Promise<string>;
}

export class WecomOnboardingFlow implements WecomOnboardingHandler {
  constructor(
    private readonly repository: WecomOnboardingRepositoryLike,
    private readonly messageCopy: AdminMessageCopyProvider,
  ) {}

  async findReceiptResponse(input: WecomOnboardingReceiptInput): Promise<string | null> {
    const receipt = await this.repository.findReceipt(input.messageId, input.wecomUserId);
    if (!receipt) return null;
    if (receipt.status === 'completed') return receipt.response;
    return this.renderCopy('wecomDuplicate');
  }

  async handleMessage(input: WecomOnboardingMessageInput): Promise<string> {
    const now = input.now ?? new Date();
    const receipt = await this.repository.claimReceipt({
      messageId: input.messageId,
      now,
      staleBefore: new Date(now.getTime() - 60_000),
      wecomUserId: input.wecomUserId,
    });

    if (receipt.status === 'completed') return receipt.response;
    if (receipt.status === 'processing') return this.renderCopy('wecomDuplicate');

    const { created, session } = await this.repository.beginOrGetSession({
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      now,
      wecomUserId: input.wecomUserId,
    });

    if (created) {
      return this.complete(input.messageId, await this.renderCopy('wecomBindingNamePrompt'), now);
    }
    if (session.cooldownUntil && session.cooldownUntil > now) {
      return this.complete(input.messageId, await this.renderCopy('wecomBindingNameInvalid'), now);
    }
    if (!input.text) {
      return this.complete(input.messageId, await this.renderCopy('wecomBindingNameInvalid'), now);
    }

    const successResponse = await this.renderCopy('wecomBindingSuccess');
    const result = await this.repository.bindByName({
      messageId: input.messageId,
      name: input.text.trim(),
      now,
      successResponse,
      wecomUserId: input.wecomUserId,
    });
    if (result.status === 'bound') {
      return successResponse;
    }

    await this.repository.recordFailedAttempt({
      error: result.outcome,
      now,
      wecomUserId: input.wecomUserId,
    });
    return this.complete(input.messageId, await this.renderCopy('wecomBindingNameInvalid'), now);
  }

  private async complete(messageId: string, response: string, now: Date): Promise<string> {
    await this.repository.completeReceipt(messageId, response, now);
    return response;
  }

  private async renderCopy(
    key: 'wecomBindingNameInvalid' | 'wecomBindingNamePrompt' | 'wecomBindingSuccess' | 'wecomDuplicate',
  ): Promise<string> {
    const copy = await this.messageCopy.getCopy();
    return renderAdminMessageCopy(copy[key], { assistantName: copy.assistantName });
  }
}
