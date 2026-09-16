import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import { MailerService, MailPayload } from '../services/mailer.service';

const jobOf = (data: MailPayload, attemptsMade = 0): Job<MailPayload> =>
  ({ id: 'job-1', data, attemptsMade }) as Job<MailPayload>;

const PAYLOAD: MailPayload = { to: 'guest@chicago.ru', subject: 'Тема', html: '<p>Привет</p>' };

describe('EmailProcessor', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('hands the job payload to the mailer', async () => {
    const mailer = { send: jest.fn(async () => undefined) } as unknown as MailerService;

    await new EmailProcessor(mailer).process(jobOf(PAYLOAD));

    expect(mailer.send).toHaveBeenCalledWith(PAYLOAD);
  });

  it('rethrows so BullMQ applies its backoff instead of dropping the mail', async () => {
    const mailer = {
      send: jest.fn(async () => Promise.reject(new Error('SMTP timeout'))),
    } as unknown as MailerService;

    await expect(new EmailProcessor(mailer).process(jobOf(PAYLOAD))).rejects.toThrow('SMTP timeout');
  });

  it('logs the attempt number as a warning, not an error', async () => {
    const mailer = {
      send: jest.fn(async () => Promise.reject(new Error('SMTP timeout'))),
    } as unknown as MailerService;

    await expect(new EmailProcessor(mailer).process(jobOf(PAYLOAD, 2))).rejects.toThrow();

    // A retriable failure is not an incident; only the final BullMQ failure is.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('attempt 3'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SMTP timeout'));
  });

  it('is registered against the email queue', () => {
    expect(Reflect.getMetadata('bullmq:processor_metadata', EmailProcessor)).toMatchObject({ name: 'email' });
  });
});
