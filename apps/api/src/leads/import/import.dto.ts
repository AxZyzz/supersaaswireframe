import { IsIn, IsObject, IsOptional } from 'class-validator';

// CSV-column-name → lead-field mapping. Only these target fields are importable.
export const IMPORTABLE_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'company',
  'title',
  'phone',
  'status',
  'score',
  'source',
] as const;

export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

export class ImportMappingDto {
  // { "Email Address": "email", "First Name": "firstName", ... }
  @IsObject()
  mapping!: Record<string, ImportableField>;

  @IsOptional()
  @IsIn(['skip', 'update'])
  onDuplicate?: 'skip' | 'update';
}

export interface ImportJobData {
  jobId: string;
  orgId: string;
  csv: string;
  mapping: Record<string, string>;
  onDuplicate: 'skip' | 'update';
  /** leads.source for new rows when the mapping has no source column. */
  source?: string;
}
