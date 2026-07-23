import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { RuleSet } from './segment-rules';

export class CreateSegmentDto {
  @IsString() @MaxLength(80) name!: string;

  @IsIn(['manual', 'smart'])
  type!: 'manual' | 'smart';

  // Required for smart segments; ignored for manual.
  @IsOptional() @IsObject() rules?: RuleSet;
}

export class UpdateSegmentDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsObject() rules?: RuleSet;
}

export interface SegmentRefreshJobData {
  segmentId: string;
  orgId: string;
}
