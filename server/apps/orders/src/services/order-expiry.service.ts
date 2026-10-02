import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderService } from './order.service';

/**
 * The clock that cancels online orders nobody paid for.
 *
 * A separate class from `OrderService` for the same reason `TokenCleanupService`
 * is separate from the auth service: the *rule* about what an abandoned order
 * means belongs with the domain, and the decision to run it every ten minutes
 * is an operational one. Keeping them apart is also what makes the rule
 * testable without a scheduler.
 *
 * Ten minutes rather than hourly because the interval is the resolution: on an
 * hourly tick an order abandoned at 20:01 keeps its points and its promocode
 * use until 21:00 for no reason anyone could explain to the customer.
 */
@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);

  constructor(private readonly orders: OrderService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<{ cancelled: number }> {
    try {
      return await this.orders.expireUnpaidOnlineOrders();
    } catch (error) {
      // A scheduled job that throws takes the whole timer down with it in some
      // runtimes, and an unhandled rejection here would be invisible.
      this.logger.error('Unpaid-order sweep failed', error instanceof Error ? error.stack : String(error));
      return { cancelled: 0 };
    }
  }
}
