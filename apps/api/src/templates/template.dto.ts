import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateTemplateDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(50000) bodyHtml?: string;
  @IsOptional() @IsString() @MaxLength(50000) bodyText?: string;
  @IsOptional() @IsUUID() folderId?: string;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(50000) bodyHtml?: string;
  @IsOptional() @IsString() @MaxLength(50000) bodyText?: string;
  // null clears the folder assignment.
  @IsOptional() @IsUUID() folderId?: string | null;
}

export class CreateFolderDto {
  @IsString() @MaxLength(80) name!: string;
}

export class PreviewDto {
  // Render against a real lead's data; omit for sample data.
  @IsOptional() @IsUUID() leadId?: string;
}

export class TemplateTestSendDto {
  @IsUUID() senderId!: string;
  @IsEmail() @MaxLength(320) to!: string;
}
