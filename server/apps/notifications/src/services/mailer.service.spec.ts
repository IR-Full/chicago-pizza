import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { MailerService } from './mailer.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const sendMail = jest.fn(async () => ({ messageId: 'id' }));

const SMTP: Record<string, unknown> = {
  SMTP_HOST: 'smtp.example.ru',
  SMTP_PORT: 2525,
  SMTP_SECURE: false,
  SMTP_USER: 'postmaster',
  SMTP_PASSWORD: 'secret',
  MAIL_FROM: 'Chicago Pizza <no-reply@chicago-pizza.ru>',
};

function createService(overrides: Record<string, unknown> = {}) {
  const values = { ...SMTP, ...overrides };
  const config = { get: jest.fn((key: string) => values[key]) };
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

  return { service: new MailerService(config as never), config };
}

describe('MailerService', () => {
  beforeEach(() => {
    (nodemailer.createTransport as jest.Mock).mockClear();
    sendMail.mockClear();
  });

  it('builds the transport from configuration on boot', () => {
    const { service } = createService();

    service.onModuleInit();

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.ru',
      port: 2525,
      secure: false,
      auth: { user: 'postmaster', pass: 'secret' },
    });
  });

  it.each([
    ['no user', { SMTP_USER: undefined }],
    ['no password', { SMTP_PASSWORD: undefined }],
    ['neither', { SMTP_USER: undefined, SMTP_PASSWORD: undefined }],
  ])('sends unauthenticated when there is %s, as MailHog expects', (_label, overrides) => {
    const { service } = createService(overrides);

    service.onModuleInit();

    expect((nodemailer.createTransport as jest.Mock).mock.calls[0][0].auth).toBeUndefined();
  });

  it('sends the payload from the configured address', async () => {
    const { service } = createService();
    service.onModuleInit();

    await service.send({ to: 'guest@chicago.ru', subject: 'Тема', html: '<p>Привет</p>' });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Chicago Pizza <no-reply@chicago-pizza.ru>',
      to: 'guest@chicago.ru',
      subject: 'Тема',
      html: '<p>Привет</p>',
    });
  });

  it('logs a successful delivery', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = createService();
    service.onModuleInit();

    await service.send({ to: 'guest@chicago.ru', subject: 'Тема', html: '' });

    // Masked: `docker compose logs` was accumulating a list of every address
    // the shop has ever mailed.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('g***t@chicago.ru'));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('guest@chicago.ru'));
    log.mockRestore();
  });

  it('propagates an SMTP failure so the queue can retry', async () => {
    const { service } = createService();
    service.onModuleInit();
    sendMail.mockRejectedValueOnce(new Error('550 mailbox unavailable') as never);

    await expect(service.send({ to: 'guest@chicago.ru', subject: 'Тема', html: '' })).rejects.toThrow(
      '550 mailbox unavailable',
    );
  });
});
