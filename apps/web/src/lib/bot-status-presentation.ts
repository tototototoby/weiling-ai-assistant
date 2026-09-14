import type { BotDesiredState } from '@weiling-ai/shared';
import type { Locale } from './locale';
import { getMessages } from './locale';

export type PresentationTone = 'attention' | 'danger' | 'neutral' | 'success';

interface Presentation {
  key: string;
  label: string;
  tone: PresentationTone;
}

type BotDetailMessages = ReturnType<typeof getMessages>['botDetail'];
type BotDetailStringKey = {
  [Key in keyof BotDetailMessages]: BotDetailMessages[Key] extends string ? Key : never;
}[keyof BotDetailMessages];

const RUNTIME_STATUS_CONFIG: Record<
  string,
  {
    messageKey: BotDetailStringKey;
    tone: PresentationTone;
  }
> = {
  provisioning: { messageKey: 'runtimeProvisioning', tone: 'neutral' },
  starting: { messageKey: 'runtimeStarting', tone: 'neutral' },
  waiting_for_qr: { messageKey: 'runtimeWaitingForQr', tone: 'attention' },
  running: { messageKey: 'runtimeRunning', tone: 'success' },
  degraded: { messageKey: 'runtimeDegraded', tone: 'attention' },
  stopping: { messageKey: 'runtimeStopping', tone: 'neutral' },
  stopped: { messageKey: 'runtimeStopped', tone: 'neutral' },
  failed: { messageKey: 'runtimeFailed', tone: 'danger' },
};

export function getRuntimeStatusPresentation(status: string | null | undefined, locale: Locale): Presentation {
  const normalized = status?.trim() ?? '';
  const messages = getMessages(locale);
  const config = RUNTIME_STATUS_CONFIG[normalized];

  if (!config) {
    return {
      key: 'unknown',
      label: messages.botDetail.statusUnknown,
      tone: 'neutral',
    };
  }

  return {
    key: normalized,
    label: messages.botDetail[config.messageKey],
    tone: config.tone,
  };
}

export function getDesiredStatePresentation(state: BotDesiredState, locale: Locale): Presentation {
  const messages = getMessages(locale);

  if (state === 'running') {
    return {
      key: state,
      label: messages.botDetail.desiredRunning,
      tone: 'success',
    };
  }

  return {
    key: state,
    label: messages.botDetail.desiredStopped,
    tone: 'neutral',
  };
}
