import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CAMPAIGN_SEND_QUEUE, WORKER_OPTIONS } from '../queue/queue.module';
import { SendService } from './send.service';

// Repeatable BullMQ job that drives the send loop. Each tick processes all due
// campaign sends across every org (via the SECURITY DEFINER scan). The
// repeatable schedule is skipped under tests (jest sets NODE_ENV=test) and can
// be disabled with SEND_SCHEDULER=off — tests/dev drive tick() manually via
// POST /sending/tick.
@Processor(CAMPAIGN_SEND_QUEUE, WORKER_OPTIONS)
export class SendProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(SendProcessor.name);

  constructor(
    @InjectQueue(CAMPAIGN_SEND_QUEUE) private readonly queue: Queue,
    private readonly send: SendService,
  ) {
    super();
  }

  private get enabled() {
    return (
      process.env.NODE_ENV !== 'test' && process.env.SEND_SCHEDULER !== 'off'
    );
  }

  async onApplicationBootstrap() {
    // The 30 s send loop now runs from TickSchedulerService (one Redis
    // command per tick). Repeatable jobs outlive the process in Redis: clear
    // any an older build left behind so the queue holds no delayed job (which
    // would keep the worker waking every 10 s) and no surprise ticks run.
    for (const job of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }

  async process(): Promise<void> {
    if (!this.enabled) return; // a stale tick queued before the cleanup ran
    const counts = await this.send.tick();
    if (counts.sent || counts.failed) {
      this.logger.log(
        `send tick: ${counts.sent} sent, ${counts.failed} failed, ${counts.completed} completed`,
      );
    }
  }
}
