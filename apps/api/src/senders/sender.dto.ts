import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSenderDto {
  @IsIn(['ses', 'gmail', 'smtp'])
  provider!: 'ses' | 'gmail' | 'smtp';

  @IsString() @MaxLength(120) fromName!: string;

  @IsEmail() @MaxLength(320) fromEmail!: string;

  @IsOptional() @IsEmail() @MaxLength(320) replyTo?: string;
  @IsOptional() @IsString() @MaxLength(2000) signature?: string;

  @IsOptional() @IsInt() @Min(1) @Max(2000) dailyLimit?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) sendWindowStart?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) sendWindowEnd?: number;
}

export class UpdateSenderDto {
  @IsOptional() @IsString() @MaxLength(120) fromName?: string;
  @IsOptional() @IsEmail() @MaxLength(320) replyTo?: string;
  @IsOptional() @IsString() @MaxLength(2000) signature?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2000) dailyLimit?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) sendWindowStart?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) sendWindowEnd?: number;
}
