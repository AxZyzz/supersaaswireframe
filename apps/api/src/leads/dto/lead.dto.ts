import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  ValidateNested,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SCORES = ['hot', 'warm', 'cold'] as const;

export class CreateLeadDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional() @IsString() @MaxLength(120) firstName?: string;
  @IsOptional() @IsString() @MaxLength(120) lastName?: string;
  @IsOptional() @IsString() @MaxLength(200) company?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) status?: string;

  @IsOptional() @IsEnum(SCORES) score?: (typeof SCORES)[number];

  @IsOptional() @IsString() @MaxLength(120) source?: string;

  @IsOptional() @IsObject() custom?: Record<string, unknown>;
}

export class UpdateLeadDto extends CreateLeadDto {}

const SORTABLE = [
  'created_at',
  'updated_at',
  'email',
  'company',
  'last_name',
] as const;

/** The list filters on their own (bulk delete "all matching"). */
export class LeadFilter {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(80) status?: string;
  @IsOptional() @IsEnum(SCORES) score?: (typeof SCORES)[number];
  @IsOptional() @IsString() @MaxLength(120) source?: string;
  @IsOptional() @IsUUID() tagId?: string;
}

export class BulkDeleteLeadsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  leadIds?: string[];

  /** Must be true to delete by filters (protects against an empty body). */
  @IsOptional() @IsBoolean() allMatching?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => LeadFilter)
  filters?: LeadFilter;
}

export class ListLeadsQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(80) status?: string;
  @IsOptional() @IsEnum(SCORES) score?: (typeof SCORES)[number];
  @IsOptional() @IsString() @MaxLength(120) source?: string;
  @IsOptional() @IsUUID() tagId?: string;

  @IsOptional() @IsIn(SORTABLE) sort?: (typeof SORTABLE)[number];
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class CreateNoteDto {
  @IsString() @MaxLength(5000) body!: string;
}

export class CreateTagDto {
  @IsString() @MaxLength(60) name!: string;
  @IsOptional() @IsString() @MaxLength(9) color?: string;
}

export class AttachTagDto {
  @IsUUID() tagId!: string;
}

export class BulkTagDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  leadIds!: string[];

  @IsUUID() tagId!: string;

  @IsIn(['attach', 'detach']) action!: 'attach' | 'detach';
}

export class MergeLeadsDto {
  @IsUUID() primaryId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  mergeIds!: string[];
}
