import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailerService, MailPayload } from '../services/mailer.service';
import { EMAIL_QUEUE } from '../services/notification.service';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly mailer: MailerService) {
    super();
  }

  async process(job: Job<MailPayload>): Promise<void> {
    try {
      await this.mailer.send(job.data);
    } catch (error) {
      // Rethrow so BullMQ applies the configured exponential backoff.
      this.logger.warn(`Email job ${job.id} failed (attempt ${job.attemptsMade + 1}): ${(error as Error).message}`);
      throw error;
    }
  }
}
