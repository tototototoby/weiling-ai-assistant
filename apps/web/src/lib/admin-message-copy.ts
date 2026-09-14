export const ADMIN_MESSAGE_COPY_KEYS = [
  'assistantName',
  'mealConsentPrompt',
  'mealRainReminder',
  'mealStandardReminder',
  'morningBriefingIntro',
  'processingAck',
  'wecomAck',
  'wecomDuplicate',
  'wecomCompleted',
  'wecomFailure',
  'wecomUnbound',
  'wecomUnsupported',
  'wecomGroupUnsupported',
  'wecomBindingNamePrompt',
  'wecomBindingNameInvalid',
  'wecomBindingSuccess',
] as const;

export type AdminMessageCopyKey = typeof ADMIN_MESSAGE_COPY_KEYS[number];
export type AdminMessageCopyConfig = Record<AdminMessageCopyKey, string>;

export const ADMIN_MESSAGE_COPY_MAX_LENGTH = 4_000;
export const ADMIN_MESSAGE_ASSISTANT_NAME_MAX_LENGTH = 80;

export type AdminMessageCopyValidationError =
  | 'controlCharacters'
  | 'invalidTemplate'
  | 'required'
  | 'tooLong';

const allowedTemplateVariables = new Set([
  'assistantName',
  'employeeName',
  'date',
  'time',
  'city',
]);
const controlCharacterPattern = /[\u0000-\u001F\u007F-\u009F]/u;
const templateVariablePattern = /\{\{([a-zA-Z]+)\}\}/gu;

export const ADMIN_MESSAGE_COPY_DEFAULTS: AdminMessageCopyConfig = {
  assistantName: '微Link · 微灵 AI 助手',
  mealConsentPrompt: '我是微Link。工作日需要我提醒你点外卖吗？需要的话请回复“开启外卖提醒”，不需要请回复“关闭外卖提醒”。',
  mealRainReminder: '我是微Link。今天可能下雨，外卖配送可能会比平时慢，记得现在点外卖。',
  mealStandardReminder: '我是微Link。该点外卖了，记得安排今天的午餐。',
  morningBriefingIntro: '早上好，我是微Link。今天是 {{date}}。',
  processingAck: '收到，我是微Link，正在处理，完成后把结果发给你。',
  wecomAck: '微Link已收到，正在处理，完成后把结果发给你。',
  wecomDuplicate: '微Link已收到这条消息，正在处理中，请稍候。',
  wecomCompleted: '微Link已经处理完这条消息，请勿重复发送。',
  wecomFailure: '微Link这次处理没有完成，请稍后重新发送。',
  wecomUnbound: '我是微Link。你的企业微信账号尚未绑定用户 Bot，请联系管理员完成绑定。',
  wecomUnsupported: '我是微Link。当前企业微信通道支持文字和语音转文字，请补充文字说明。',
  wecomGroupUnsupported: '我是微Link。当前仅支持用户与机器人单聊。',
  wecomBindingNamePrompt: '我是微Link。为了绑定你已有的用户 Bot，请回复你的姓名或常用称呼。',
  wecomBindingNameInvalid: '我是微Link。暂时无法确认你的用户身份，请核对姓名或常用称呼后重试，或联系管理员。',
  wecomBindingSuccess: '我是微Link。企业微信已绑定到你的用户 Bot，之后会继续使用同一会话、记忆和工具。',
};

export function validateAdminMessageCopyValue(
  key: AdminMessageCopyKey,
  value: string,
): AdminMessageCopyValidationError | null {
  const normalized = value.trim();
  if (normalized.length === 0) return 'required';
  const maxLength = key === 'assistantName'
    ? ADMIN_MESSAGE_ASSISTANT_NAME_MAX_LENGTH
    : ADMIN_MESSAGE_COPY_MAX_LENGTH;
  if (normalized.length > maxLength) return 'tooLong';
  if (controlCharacterPattern.test(normalized)) return 'controlCharacters';

  const variables = [...normalized.matchAll(templateVariablePattern)];
  if (variables.some((match) => !allowedTemplateVariables.has(match[1]))) {
    return 'invalidTemplate';
  }
  const withoutVariables = normalized.replace(templateVariablePattern, '');
  if (withoutVariables.includes('{{') || withoutVariables.includes('}}')) {
    return 'invalidTemplate';
  }
  if (key === 'assistantName' && variables.length > 0) return 'invalidTemplate';
  return null;
}
