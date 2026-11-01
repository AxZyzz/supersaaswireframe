import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { REPLY_CLASSES } from '../ai/prompts';

export class UpdateConversationDto {
  @IsOptional() @IsBoolean() unread?: boolean;
  @IsOptional() @IsIn(['open', 'closed']) status?: 'open' | 'closed';
  @IsOptional() @IsIn([...REPLY_CLASSES]) classification?: string;
  // null unassigns
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assignedUserId?: string | null;
  @IsOptional() @IsBoolean() converted?: boolean;
}

export class AddNoteDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
}

// Dev/test seam: inject an inbound reply as if it had been received. The real
// SES-inbound / Gmail ingestion (creds-gated) calls the same service method.
export class SimulateReplyDto {
  @IsEmail() fromEmail!: string;
  @IsString() @MaxLength(20000) body!: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(500) inReplyTo?: string;
  @IsOptional()
  @IsIn([...REPLY_CLASSES])
  classification?: (typeof REPLY_CLASSES)[number];
}
