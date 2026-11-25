import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const STATUS = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'completed',
  'archived',
] as const;
const CONDITION = ['always', 'opened_no_reply', 'not_opened'] as const;

export class CreateCampaignDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsUUID() segmentId?: string;
  @IsOptional() @IsUUID() offerId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  senderIds?: string[];
  // T17: {days:[1..7], startHour, endHour, tzBasis}. Checked in the service
  // (sendWindowError) so the message says what is wrong in plain words.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  sendWindow?: Record<string, unknown> | null;
}

export class UpdateCampaignDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(STATUS) status?: (typeof STATUS)[number];
  // null clears the audience segment.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  segmentId?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  offerId?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  senderIds?: string[];
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  scheduledAt?: string | null;
  // T17: null clears the window (the campaign sends whenever it is due again).
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  sendWindow?: Record<string, unknown> | null;
}

export class ScheduleDto {
  @IsDateString() scheduledAt!: string;
}

export class CreateStepDto {
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(8760) delayHours?: number;
  @IsOptional() @IsIn(CONDITION) condition?: (typeof CONDITION)[number];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  subjectVariants?: string[];
}

export class UpdateStepDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  templateId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(8760) delayHours?: number;
  @IsOptional() @IsIn(CONDITION) condition?: (typeof CONDITION)[number];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  subjectVariants?: string[];
}

export class ApplyWinnerDto {
  @IsUUID() stepId!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(9) variantIndex!: number;
}
