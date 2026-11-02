import { getQueueToken } from '@nestjs/bullmq';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PG_POOL } from './db/db.module';
import { CAMPAIGN_SEND_QUEUE } from './queue/queue.module';

describe('AppController', () => {
  let appController: AppController;
  const pool = { query: jest.fn() };
  const getJobCounts = jest.fn();

  beforeEach(async () => {
    pool.query.mockReset().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    getJobCounts.mockReset().mockResolvedValue({ waiting: 0 });
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PG_POOL, useValue: pool },
        {
          provide: getQueueToken(CAMPAIGN_SEND_QUEUE),
          useValue: { getJobCounts },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('liveness returns ok', () => {
    expect(appController.health()).toEqual({ status: 'ok' });
  });

  it('readiness ok when db + redis respond', async () => {
    await expect(appController.ready()).resolves.toEqual({
      status: 'ok',
      checks: { db: true, redis: true },
    });
  });

  it('readiness 503 when the db is down', async () => {
    pool.query.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(appController.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
