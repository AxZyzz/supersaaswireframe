import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthUser } from '../auth/types';
import { OperatorGuard, OperatorOnly } from '../operator/operator.guard';
import { BetaService } from './beta.service';

class JoinWaitlistDto {
  @IsEmail() @MaxLength(320) email!: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsString() @MaxLength(1000) useCase?: string;
}

class FeedbackDto {
  @IsIn(['bug', 'idea', 'other']) kind!: 'bug' | 'idea' | 'other';
  @IsString() @IsNotEmpty() @MaxLength(4000) message!: string;
  @IsOptional() @IsString() @MaxLength(300) page?: string;
}

/** Public beta endpoints + in-app feedback. */
@Controller()
export class BetaController {
  constructor(private readonly beta: BetaService) {}

  /** Lets the sign-up page know whether to ask for an invite. */
  @Public()
  @Get('beta/mode')
  mode() {
    return { mode: this.beta.mode() };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('waitlist')
  @HttpCode(200)
  join(@Body() dto: JoinWaitlistDto) {
    return this.beta.join(dto);
  }

  @Post('feedback')
  @HttpCode(201)
  feedback(@CurrentUser() user: AuthUser, @Body() dto: FeedbackDto) {
    return this.beta.submitFeedback(user.orgId, user.userId, dto);
  }
}

/** Operator side: approve waitlist entries, read feedback. */
@OperatorOnly()
@UseGuards(OperatorGuard)
@Controller('operator')
export class BetaOperatorController {
  constructor(private readonly beta: BetaService) {}

  @Get('waitlist')
  waitlist() {
    return this.beta.list();
  }

  @Post('waitlist/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.beta.approve(id);
  }

  @Get('feedback')
  feedback() {
    return this.beta.allFeedback();
  }
}
