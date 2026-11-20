import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class StartProspectRunDto {
  /** e.g. "We sell AI automation to mid-size US logistics companies" */
  @IsString() @MinLength(10) @MaxLength(1000) goal!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(20) count?: number;

  @IsOptional() @IsUUID() offerId?: string;
}

export class AddProspectsToLeadsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  prospectIds!: string[];

  @IsOptional() @IsString() @MaxLength(80) segmentName?: string;
}
