import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SEGMENT_REFRESH_QUEUE } from '../../queue/queue.module';
import type { SegmentRefreshJobData } from './segment.dto';
import { SegmentsService } from './segments.service';

@Processor(SEGMENT_REFRESH_QUEUE)
export class SegmentRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(SegmentRefreshProcessor.name);

  constructor(private readonly segments: SegmentsService) {
    super();
  }

  async process(job: Job<SegmentRefreshJobData>): Promise<void> {
    const { orgId, segmentId } = job.data;
    try {
      const { memberCount } = await this.segments.refreshNow(orgId, segmentId);
      this.logger.log(`Segment ${segmentId} refreshed: ${memberCount} members`);
    } catch (err) {
      this.logger.error(`Segment ${segmentId} refresh failed`, err as Error);
      throw err;
    }
  }
}
