import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { maskEmail } from '@chicago-pizza/common';

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private transporter!: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT'),
      secure: this.config.get<boolean>('SMTP_SECURE'),
      // Local development uses MailHog, which accepts unauthenticated mail.
      auth: user && pass ? { user, pass } : undefined,
      // Connections are reused instead of opened per message. Every order
      // confirmation was paying for a fresh TCP connect, a TLS handshake and an
      // AUTH exchange before it could send a single byte of mail — and the queue
      // drains a batch at a time, so it paid that repeatedly in a row.
      //
      // `maxMessages` recycles a connection periodically, which is what keeps a
      // provider that silently caps messages-per-connection from starting to
      // refuse mid-batch.
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });
  }

  /**
   * A pooled transport holds its connections open, which would keep the process
   * alive past SIGTERM and have the container killed mid-batch instead of
   * finishing what it was sending.
   */
  onModuleDestroy(): void {
    this.transporter?.close();
  }

  async send(payload: MailPayload): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
    // Masked: `docker compose logs` was accumulating a list of every
    // customer address the shop has ever mailed.
    this.logger.log(`Sent "${payload.subject}" to ${maskEmail(payload.to)}`);
  }
}
