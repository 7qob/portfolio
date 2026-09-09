/**
 * Where a generated page is allowed to land, and how it gets there.
 *
 * Extracted from ProjectsService when the home page gained a second writer:
 * the sections CMS writes index.html too, and a second copy of the filename
 * allowlist is a second place for it to drift. There is exactly one gate.
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

import { config } from '../config';

const logger = new Logger('Pages');

/**
 * The only filenames the writer will ever emit. Belt on top of the slug
 * CHECK's braces: even a row that somehow held a bad slug cannot make this
 * regex produce a path. index.html joined the list when the home page's
 * project cards started coming out of the database.
 */
export const PAGE_NAME = /^(project-[a-z0-9-]{1,48}\.html|projects\.html|index\.html)$/;

/** Same last-line-of-defence shape as VaultService.resolvePath. */
export function resolvePagePath(name: string): string {
  const safeName = basename(name);
  if (!PAGE_NAME.test(safeName)) {
    throw new BadRequestException('Refusing to write that filename.');
  }

  const root = resolve(config.site.pagesDir);
  const path = resolve(join(root, safeName));

  if (!path.startsWith(root + sep)) {
    logger.warn(`Refused a path outside the pages directory: ${name}`);
    throw new BadRequestException('Refusing to write that filename.');
  }

  return path;
}

/** Write-then-rename, so a reader never sees a half-written page. */
export function writePage(name: string, html: string): void {
  const path = resolvePagePath(name);
  const tmp = path + '.tmp';
  writeFileSync(tmp, html, 'utf8');
  renameSync(tmp, path);
}

/**
 * The base the home page is spliced into: the generated one if it exists, so
 * a hand edit made on the Pi survives, otherwise the hand-written index.html
 * that shipped with the site.
 *
 * Both writers of index.html read through here, which is what lets them
 * compose: each one's output is the other's next template, and since a splice
 * leaves every marker in place, neither can erase the other's region.
 */
export function homeTemplate(): string {
  const generated = resolvePagePath('index.html');
  const source = existsSync(generated) ? generated : resolve(config.site.homeTemplate);
  return readFileSync(source, 'utf8');
}

/**
 * Dev convenience; in production this is the mounted /site/pages and already
 * exists. Failing here (read-only fs, missing mount) is fatal on first
 * publish, not on boot — publishing is the operation that needs it.
 */
export function ensurePagesDir(): void {
  try {
    mkdirSync(resolve(config.site.pagesDir), { recursive: true });
  } catch {
    logger.warn(`Could not create pages directory ${config.site.pagesDir}`);
  }
}
