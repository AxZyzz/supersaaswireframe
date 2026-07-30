import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
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
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  senderIds?: string[];
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
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  senderIds?: string[];
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  scheduledAt?: string | null;
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
