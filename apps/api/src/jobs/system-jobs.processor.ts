import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { WeeklySummaryService } from '../analytics/weekly-summary.service';
import { SheetsService } from '../integrations/sheets.service';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { SYSTEM_JOBS_QUEUE } from '../queue/queue.module';

/**
 * Repeatable housekeeping jobs, one Redis-backed schedule shared by every API
 * instance (each runs once per tick, not once per instance):
 *  - notification-emails: every minute (T7.5)
 *  - weekly-summary: Mondays 08:00 UTC (T7.5)
 *  - sheet-sync: every 15 min, runs Sheets syncs due hourly (T2.8)
 * Off under tests (NODE_ENV=test) and with JOBS_SCHEDULER=off: such an
 * instance neither registers nor removes schedules, and skips any tick it
 * receives. Tests call the services directly.
 */
@Processor(SYSTEM_JOBS_QUEUE)
export class SystemJobsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(SystemJobsProcessor.name);

  constructor(
    @InjectQueue(SYSTEM_JOBS_QUEUE) private readonly queue: Queue,
    private readonly notificationEmails: NotificationEmailService,
    private readonly weekly: WeeklySummaryService,
    private readonly sheets: SheetsService,
  ) {
    super();
  }

  private get enabled() {
    return (
      process.env.NODE_ENV !== 'test' && process.env.JOBS_SCHEDULER !== 'off'
    );
  }

  /** The schedules this build runs, by job-scheduler id (= job name). */
  static readonly SCHEDULES = {
    'notification-emails': { every: 60_000 },
    'weekly-summary': { pattern: '0 8 * * 1', tz: 'UTC' },
    'sheet-sync': { every: 15 * 60_000 },
  } as const;

  async onApplicationBootstrap() {
    // Disabled instances (tests, JOBS_SCHEDULER=off) leave the shared Redis
    // schedule alone, so they never switch off other instances' jobs.
    if (!this.enabled) return;
    const wanted = SystemJobsProcessor.SCHEDULES;
    // Retire schedules this build no longer has (renamed/removed jobs)...
    for (const s of await this.queue.getJobSchedulers()) {
      const id = s.id ?? s.key;
      if (!(id in wanted)) await this.queue.removeJobScheduler(id);
    }
    // ...then upsert the current ones (idempotent across instances/restarts).
    for (const [id, repeat] of Object.entries(wanted)) {
      await this.queue.upsertJobScheduler(id, repeat, {
        name: id,
        opts: { removeOnComplete: true, removeOnFail: 50 },
      });
    }
  }

  async process(job: Job): Promise<void> {
    if (!this.enabled) return;
    try {
      if (job.name === 'notification-emails') {
        await this.notificationEmails.flush();
      } else if (job.name === 'weekly-summary') {
        await this.weekly.run();
      } else if (job.name === 'sheet-sync') {
        await this.sheets.runDue(); // syncs not run in the last hour
      }
    } catch (err) {
      this.logger.error(
        `${job.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
