import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const TEAM_SIZES = ['1', '2-10', '11-50', '50+'] as const;

// Logo is a small data: URL (client downscales). Raster or SVG only — it's
// rendered through <img>, which never executes SVG scripts.
const LOGO_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
export const LOGO_MAX = 90_000;

export class UpdateOrgDto {
  // CAN-SPAM physical postal address for email footers.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  postalAddress?: string | null;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  @Matches(/^https?:\/\/\S+$/, { message: 'website must be an http(s) URL' })
  website?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  industry?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(TEAM_SIZES)
  teamSize?: string | null;

  // IANA name; checked against the runtime's zone list in the service.
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'brandColor must be #rrggbb' })
  brandColor?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(LOGO_MAX)
  @Matches(LOGO_RE, { message: 'logo must be a base64 image data URL' })
  logoData?: string | null;
}

export class DeleteWorkspaceDto {
  /** Must equal the workspace name exactly — a typed confirmation. */
  @IsString() @MaxLength(80) confirmName!: string;
}
