import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Business Knowledge Base (T6.2) — every field optional; whatever is set is
// injected into generative prompts.
export class UpsertKnowledgeDto {
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(4000) audience?: string;
  @IsOptional() @IsString() @MaxLength(4000) offer?: string;
  @IsOptional() @IsString() @MaxLength(4000) painPoints?: string;
  @IsOptional() @IsString() @MaxLength(4000) usps?: string;
  @IsOptional() @IsString() @MaxLength(4000) competitors?: string;
  @IsOptional() @IsString() @MaxLength(4000) testimonials?: string;
}

// AI campaign generation (T6.3) — the brief.
export class GenerateSequenceDto {
  @IsString() @MaxLength(500) goal!: string;
  @IsOptional() @IsString() @MaxLength(500) audience?: string;
  @IsOptional() @IsString() @MaxLength(500) offer?: string;
  @IsOptional() @IsString() @MaxLength(120) tone?: string;
  @IsOptional() @IsInt() @Min(1) @Max(8) steps?: number;
}

// One generated (and possibly user-edited) email step, for approve-to-draft.
export class SequenceStepDto {
  @IsString() @MaxLength(300) subject!: string;
  @IsString() @MaxLength(20000) body!: string;
  @IsInt() @Min(0) @Max(8760) delayHours!: number;
}

// Approve → persist as a draft campaign (T6.3).
export class CampaignFromSequenceDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsUUID() segmentId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => SequenceStepDto)
  steps!: SequenceStepDto[];
}

// Draft a reply for an inbox conversation (T6.6).
export class ReplyDraftDto {
  @IsUUID() conversationId!: string;
  @IsOptional() @IsString() @MaxLength(500) instruction?: string;
}

// Revise one email by instruction (T6.3 chat editing).
export class RefineEmailDto {
  @IsString() @MaxLength(300) subject!: string;
  @IsString() @MaxLength(20000) body!: string;
  @IsString() @MaxLength(500) instruction!: string;
}
