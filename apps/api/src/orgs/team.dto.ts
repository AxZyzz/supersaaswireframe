import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ROLES = ['admin', 'manager', 'agent'] as const;

export class CreateInviteDto {
  @IsEmail() @MaxLength(320) email!: string;
  @IsIn(ROLES) role!: (typeof ROLES)[number];
}

export class ChangeRoleDto {
  @IsIn(ROLES) role!: (typeof ROLES)[number];
}

/** Accepting an invite as a brand-new user (email comes from the invite). */
export class RegisterInviteDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
