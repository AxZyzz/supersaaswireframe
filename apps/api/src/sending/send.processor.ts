import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CAMPAIGN_SEND_QUEUE } from '../queue/queue.module';
import { SendService } from './send.service';

// Repeatable BullMQ job that drives the send loop. Each tick processes all due
// campaign sends across every org (via the SECURITY DEFINER scan). The
// repeatable schedule is skipped under tests (jest sets NODE_ENV=test) and can
// be disabled with SEND_SCHEDULER=off — tests/dev drive tick() manually via
// POST /sending/tick.
@Processor(CAMPAIGN_SEND_QUEUE)
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

  async onApplicationBootstrap() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.SEND_SCHEDULER === 'off'
    ) {
      return;
    }
    // Fire every 30s. jobId keeps a single repeatable instance.
    await this.queue.add(
      'tick',
      {},
      {
        repeat: { every: 30_000 },
        jobId: 'send-tick',
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async process(): Promise<void> {
    const counts = await this.send.tick();
    if (counts.sent || counts.failed) {
      this.logger.log(
        `send tick: ${counts.sent} sent, ${counts.failed} failed, ${counts.completed} completed`,
      );
    }
  }
}
