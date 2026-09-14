import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { EmailDeliveryRecord, GlobalEmailConfigRecord } from '@weiling-ai/db';
import { GlobalEmailSecretReader } from './global-email-secret';

export interface GlobalEmailSenderOptions {
  createTransport?: (options: SMTPTransport.Options) => Transporter;
  secretReader?: Pick<GlobalEmailSecretReader, 'read'>;
}

export class GlobalEmailSender {
  private readonly createTransport: (options: SMTPTransport.Options) => Transporter;
  private readonly secretReader: Pick<GlobalEmailSecretReader, 'read'>;

  constructor(options: GlobalEmailSenderOptions = {}) {
    this.createTransport = options.createTransport ?? ((transportOptions) => nodemailer.createTransport(transportOptions));
    this.secretReader = options.secretReader ?? new GlobalEmailSecretReader();
  }

  async send(config: GlobalEmailConfigRecord, delivery: Pick<EmailDeliveryRecord, 'message' | 'recipientEmail' | 'subject'>): Promise<void> {
    if (!config.senderEmail) throw new Error('Global sender email is not configured.');
    const password = await this.secretReader.read();
    if (!password) throw new Error('Global email password is not configured.');
    const transportOptions: SMTPTransport.Options = {
      auth: { pass: password, user: config.senderEmail },
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecurity === 'ssl',
    };
    if (config.smtpSecurity === 'starttls') transportOptions.requireTLS = true;
    const transporter = this.createTransport(transportOptions);
    try {
      await transporter.sendMail({
        from: `${config.senderName.replace(/[\r\n"]/g, '')} <${config.senderEmail}>`,
        subject: delivery.subject,
        text: delivery.message,
        to: delivery.recipientEmail,
      });
    } finally {
      transporter.close();
    }
  }
}

export class NodemailerGlobalEmailSender extends GlobalEmailSender {}
