import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SmtpConfigDto {
  @IsString() @MaxLength(255) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsBoolean() secure!: boolean;
  @IsString() @MaxLength(255) user!: string;
  @IsString() @MaxLength(1024) pass!: string;
}

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
  /** Ramp daily volume over the first 30 days (default on). */
  @IsOptional() @IsBoolean() warmupEnabled?: boolean;

  // Only read when provider === 'smtp'. The password is AES-256 encrypted
  // before it touches the database.
  @IsOptional()
  @ValidateNested()
  @Type(() => SmtpConfigDto)
  smtp?: SmtpConfigDto;
}

export class UpdateSenderDto {
  /** Start the 30-day ramp over (e.g. after a deliverability problem). */
  @IsOptional() @IsBoolean() restartWarmup?: boolean;
  @IsOptional() @IsString() @MaxLength(120) fromName?: string;
  @IsOptional() @IsEmail() @MaxLength(320) replyTo?: string;
  @IsOptional() @IsString() @MaxLength(2000) signature?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2000) dailyLimit?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) sendWindowStart?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) sendWindowEnd?: number;
  /** Ramp daily volume over the first 30 days (default on). */
  @IsOptional() @IsBoolean() warmupEnabled?: boolean;
}

export class TestSendDto {
  @IsEmail() @MaxLength(320) to!: string;
}
