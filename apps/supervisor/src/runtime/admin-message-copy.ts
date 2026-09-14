import {
  DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
  type GlobalAdminMessageConfigRecord,
  type GlobalAdminMessageConfigRepository,
  type GlobalAdminMessageCopy,
} from '@weiling-ai/db';

export interface AdminMessageCopyProvider {
  getCopy(): Promise<Readonly<GlobalAdminMessageCopy>>;
}

type AdminMessageCopyStore = Pick<
  GlobalAdminMessageConfigRepository,
  'ensure' | 'recordObservedRevision'
>;

export class DynamicAdminMessageCopyProvider implements AdminMessageCopyProvider {
  private cached: Readonly<GlobalAdminMessageCopy> = DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY;

  constructor(private readonly repository: AdminMessageCopyStore) {}

  async getCopy(): Promise<Readonly<GlobalAdminMessageCopy>> {
    try {
      const config = await this.repository.ensure();
      this.cached = selectCopy(config);
      if (config.observedRevision !== config.revision) {
        await this.repository.recordObservedRevision(config.revision);
      }
    } catch (error) {
      console.error('Failed to read the global admin message copy; using the last known copy.');
      console.error(error);
    }
    return this.cached;
  }
}

export function renderAdminMessageCopy(
  template: string,
  variables: Partial<Record<'assistantName' | 'employeeName' | 'date' | 'time' | 'city', string>>,
): string {
  return template.replace(/\{\{(assistantName|employeeName|date|time|city)\}\}/gu, (placeholder, key) => (
    variables[key as keyof typeof variables] ?? placeholder
  ));
}

function selectCopy(config: GlobalAdminMessageConfigRecord): Readonly<GlobalAdminMessageCopy> {
  return {
    assistantName: config.assistantName,
    mealConsentPrompt: config.mealConsentPrompt,
    mealRainReminder: config.mealRainReminder,
    mealStandardReminder: config.mealStandardReminder,
    morningBriefingIntro: config.morningBriefingIntro,
    processingAck: config.processingAck,
    wecomAck: config.wecomAck,
    wecomBindingNameInvalid: config.wecomBindingNameInvalid,
    wecomBindingNamePrompt: config.wecomBindingNamePrompt,
    wecomBindingSuccess: config.wecomBindingSuccess,
    wecomCompleted: config.wecomCompleted,
    wecomDuplicate: config.wecomDuplicate,
    wecomFailure: config.wecomFailure,
    wecomGroupUnsupported: config.wecomGroupUnsupported,
    wecomUnbound: config.wecomUnbound,
    wecomUnsupported: config.wecomUnsupported,
  };
}
