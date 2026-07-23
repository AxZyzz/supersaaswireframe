import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { CreateLeadDto } from '../dto/lead.dto';
import { LeadsService } from '../leads.service';
import { ApiKeyGuard, ApiKeyContext } from './api-key.guard';

// Public REST surface. @Public bypasses the JWT guard; ApiKeyGuard authorizes
// via X-Api-Key instead. Throttled per client (basic IP-based limit for V1;
// true per-key limiting is a later refinement).
@Public()
@UseGuards(ApiKeyGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('v1/leads')
export class PublicLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @HttpCode(200)
  upsert(
    @Req() req: Request & { apiKey: ApiKeyContext },
    @Body() dto: CreateLeadDto,
  ) {
    return this.leads.apiUpsert(req.apiKey.orgId, dto);
  }
}
