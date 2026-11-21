import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PROSPECT_QUEUE, WORKER_OPTIONS } from '../queue/queue.module';
import { ProspectsService } from './prospects.service';

/** Runs one Expelly search (goal → candidates → website checks) in the background. */
@Processor(PROSPECT_QUEUE, { ...WORKER_OPTIONS, concurrency: 2 })
export class ProspectsProcessor extends WorkerHost {
  constructor(private readonly prospects: ProspectsService) {
    super();
  }

  async process(job: Job<{ orgId: string; runId: string }>): Promise<void> {
    await this.prospects.process(job.data.orgId, job.data.runId);
  }
}
