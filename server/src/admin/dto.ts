import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Shared paging. The cap is the point — no caller gets to ask for everything. */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export class CreateUserDto {
  @IsString()
  @Length(3, 32)
  username!: string;

  @IsIn(['user', 'admin'])
  role!: 'user' | 'admin';

  @IsOptional()
  @IsString()
  @Length(0, 100)
  displayName?: string;

  /** Who this login was issued to, e.g. the company it went to. */
  @IsOptional()
  @IsString()
  @Length(0, 200)
  note?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';

  @IsOptional()
  @IsString()
  @Length(0, 200)
  note?: string;
}

/**
 * The slug becomes the stored filename (<slug>.pdf), so its alphabet is
 * deliberately the same as a project slug's: lowercase, digits, inner
 * hyphens. Nothing a path could be built from.
 */
export class CreateVaultItemDto {
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/, {
    message: 'slug must be lowercase letters, digits and hyphens',
  })
  slug!: string;

  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;
}

export class UpdateVaultItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  /** Whether "Download all" bundles it. Ignored while `visible` is false. */
  @IsOptional()
  @IsBoolean()
  inArchive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  /**
   * Still editable for the by-hand escape hatch (a file placed on the Pi over
   * SSH), but the normal path is the panel's upload, which derives the name
   * from the slug server-side and never consults this field.
   */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  filename?: string;
}
