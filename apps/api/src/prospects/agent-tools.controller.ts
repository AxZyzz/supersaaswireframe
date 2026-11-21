import {
  CanActivate,
  Controller,
  ExecutionContext,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Post,
  UnauthorizedException,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { SkipThrottle } from '@nestjs/throttler';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import type { CronTokenVerifier } from '../internal/cron-auth.guard';
import { ProspectsService } from './prospects.service';

export const AGENT_TOOL_TOKEN_VERIFIER = Symbol('AGENT_TOOL_TOKEN_VERIFIER');

/**
 * Who may call /internal/agent-tools/* (Learning Loop T10): only the Discover agent's service
 * account, with a Google-signed ID token made for this API. The signature, the audience
 * (AGENT_TOOLS_AUDIENCE) and the verified email (AGENT_TOOLS_SA_EMAIL) are all checked. A signed-in
 * user, a missing token or any other account gets 401.
 */
@Injectable()
export class AgentToolAuthGuard implements CanActivate {
  private readonly logger = new Logger(AgentToolAuthGuard.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(AGENT_TOOL_TOKEN_VERIFIER)
    private readonly verifier: CronTokenVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    // local development only (NODE_ENV=development): a shared secret instead of a Google token
    const dev = this.config.get<string>('AGENT_TOOLS_DEV_SECRET')?.trim();
    const sent = req.headers['x-agent-secret'];
    if (
      process.env.NODE_ENV === 'development' &&
      dev &&
      typeof sent === 'string' &&
      sent.length === dev.length &&
      timingSafeEqual(Buffer.from(sent), Buffer.from(dev))
    ) {
      return true;
    }
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : '';
    const audiences = (this.config.get<string>('AGENT_TOOLS_AUDIENCE') ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const sa = this.config
      .get<string>('AGENT_TOOLS_SA_EMAIL')
      ?.trim()
      .toLowerCase();
    if (!token || audiences.length === 0 || !sa) {
      throw new UnauthorizedException();
    }
    const v = await this.verifier.verify(token, audiences);
    if (!v || !v.emailVerified || v.email?.toLowerCase() !== sa) {
      this.logger.warn(
        'agent tool call refused: not the Discover agent account',
      );
      throw new UnauthorizedException();
    }
    return true;
  }
}

export class FetchPagesDto {
  @IsUUID() orgId!: string;
  @IsUUID() runId!: string;
  @IsString() @MinLength(3) @MaxLength(253) domain!: string;
}

/**
 * The Discover agent's only way to read the web (T10): the API fetches a company's own pages
 * (SSRF guard, robots.txt, page limits, Model Armor) and answers with cleaned text. The agent
 * itself never fetches anything.
 */
@Public()
@SkipThrottle()
@UseGuards(AgentToolAuthGuard)
@Controller('internal/agent-tools')
export class AgentToolsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Post('fetch-pages')
  @HttpCode(200)
  fetchPages(@Body() dto: FetchPagesDto) {
    return this.prospects.fetchPagesForAgent(dto.orgId, dto.runId, dto.domain);
  }
}
