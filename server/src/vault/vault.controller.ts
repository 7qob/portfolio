import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthGuard } from '../auth/auth.guard';
import { clientIp, userAgent } from '../common/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { VaultService, type VaultItemView } from './vault.service';

@Controller('vault')
@UseGuards(AuthGuard)
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  /**
   * The document list. This used to be hardcoded in vault/index.html, which
   * meant anyone who viewed source learned what documents exist and what they
   * are called without ever getting past the password. Now the page ships
   * empty and this is the only thing that knows.
   */
  @Get('items')
  list(): { items: VaultItemView[] } {
    return { items: this.vault.listVisible() };
  }

  /**
   * Every document as one file. It sits above the :id route on purpose: a
   * literal path and a parameterised one at the same depth are matched in
   * declaration order, and "archive" would otherwise be handed to ParseIntPipe.
   */
  @Get('archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const { buffer } = this.vault.archiveVisible({
      userId: user.id,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment; filename="vault-documents.zip"');

    res.end(buffer);
  }

  @Get('items/:id/file')
  download(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const item = this.vault.findById(id);

    // Hidden items 404 rather than 403: whether a hidden document exists is
    // itself something a visitor has no business learning.
    if (!item || item.visible !== 1) throw new NotFoundException('Document not found.');

    const { stream, size } = this.vault.openStream(item);

    this.vault.logDownload({
      userId: user.id,
      item,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });

    res.setHeader('Content-Type', item.mime);
    res.setHeader('Content-Length', size);

    // no-store, not merely no-cache: these are somebody's school reports, and
    // Cloudflare caches by extension at the edge by default. private keeps
    // any shared cache out of it entirely.
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // The filename is quoted and stripped of anything that could break out of
    // the header. It comes from the database rather than the request, but a
    // header built by concatenation is worth making unbreakable regardless.
    const safeTitle = `${item.slug.replace(/[^a-z0-9._-]/gi, '')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}"`);

    stream.pipe(res);
  }
}
