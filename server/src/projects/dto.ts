import { Type } from 'class-transformer';
import {
  IsArray,
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

import { HOME_SLOTS } from './blocks';

/**
 * The slug becomes `project-<slug>.html` on disk, so its alphabet is the
 * page-name regex's alphabet and nothing more. Lowercase letters, digits and
 * inner hyphens — no dots, no slashes, nothing a path could be built from.
 */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/**
 * Creating a page asks for a title and nothing else: the slug is derived from
 * it server-side, and stays editable in the form until the page is published.
 * A slug may still be sent, for a caller that wants to choose one.
 */
export class CreateProjectDto {
  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @Matches(SLUG, { message: 'slug must be lowercase letters, digits and hyphens' })
  slug?: string;
}

/**
 * PUT replaces the record — the form saves everything it holds in one call.
 * Fields are optional so the endpoint does not force the client to resend
 * what it did not touch; chips and blocks are validated structurally in
 * normalizeChips/normalizeBlocks, which give field-level error messages a
 * decorator cannot.
 */
export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Matches(SLUG, { message: 'slug must be lowercase letters, digits and hyphens' })
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsIn(['WIP', 'Featured'])
  status?: string | null;

  /**
   * Which cell of the home bento this project holds, or null for none. Only
   * the four names exist: the areas are a fixed map in style.css, so a fifth
   * would render into a grid area nothing defines.
   */
  @IsOptional()
  @IsIn(HOME_SLOTS as readonly string[])
  homeSlot?: string | null;

  /**
   * The one colour a project carries. Checked again in the renderer before it
   * is interpolated into a style attribute — this decorator says the value is
   * well-formed today, not that the row it lands in still is tomorrow.
   */
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'accent must be a #rrggbb colour' })
  accent?: string | null;

  /**
   * The picture on the projects-index row: an upload id, or null for none.
   * That it still exists is checked at publish, not here — an upload can be
   * deleted between the two moments.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  coverMediaId?: number | null;

  /**
   * Rendered as the one link under the article. Narrowed to GitHub rather
   * than to "a URL": this field has exactly one job, and an allowlist of one
   * host is the cheapest way to keep it that way.
   */
  @IsOptional()
  @IsString()
  @Length(0, 200)
  @Matches(/^(|https:\/\/github\.com\/.*)$/, {
    message: 'repoUrl must start with https://github.com/',
  })
  repoUrl?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  lede?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  cardBlurb?: string | null;

  @IsOptional()
  @IsArray()
  chips?: unknown;

  @IsOptional()
  @IsArray()
  blocks?: unknown;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;
}
