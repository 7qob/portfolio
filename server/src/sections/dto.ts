import { IsArray, IsOptional } from 'class-validator';

/**
 * Same two-layer split the projects DTO uses: the decorator asserts only that
 * an array arrived, and normalizeSectionBlocks does the structural work, so
 * the 400 a bad payload gets names the field rather than the whole body.
 *
 * The key is not here — it is a path parameter, checked against SECTION_KEYS
 * in the controller, because a key that is not in the registry has no marker
 * pair to be written into.
 */
export class SaveSectionDto {
  @IsOptional()
  @IsArray()
  blocks?: unknown;
}
