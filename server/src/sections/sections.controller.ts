import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { AdminGuard, AuthGuard } from '../auth/auth.guard';
import { AuditService } from '../common/audit.service';
import { clientIp } from '../common/client';
import { CsrfGuard } from '../common/csrf.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/types';
import { isSectionKey, SectionKey } from './blocks';
import { SaveSectionDto } from './dto';
import { SectionsService } from './sections.service';

/**
 * Authoring only, for the pen icons on index.html.
 *
 * Nothing a visitor's browser loads calls these routes. edit.js is not in the
 * page's markup at all — script.js injects it only for someone who has already
 * signed in as an admin — and Publish writes a plain static file that is the
 * whole public surface.
 */
@Controller('admin/sections')
@UseGuards(AuthGuard, AdminGuard, CsrfGuard)
export class SectionsController {
  constructor(
    private readonly sections: SectionsService,
    private readonly audit: AuditService,
  ) {}

  /** Path params are strings; this is the only thing that makes one a key. */
  private key(raw: string): SectionKey {
    if (!isSectionKey(raw)) throw new BadRequestException('No such section.');
    return raw;
  }

  @Get()
  list() {
    return this.sections.list();
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.sections.get(this.key(key));
  }

  @Put(':key')
  save(
    @Param('key') key: string,
    @Body() dto: SaveSectionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const settled = this.key(key);
    this.sections.save(settled, dto.blocks ?? []);

    this.audit.record({
      actorId: actor.id,
      actorName: actor.username,
      action: 'section.save',
      target: `section:${settled}`,
      ip: clientIp(req),
    });

    return { ok: true };
  }

  @Post(':key/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('key') key: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const settled = this.key(key);
    this.sections.publish(settled);

    this.audit.record({
      actorId: actor.id,
      actorName: actor.username,
      action: 'section.publish',
      target: `section:${settled}`,
      ip: clientIp(req),
    });

    return { ok: true };
  }

  @Post(':key/revert')
  @HttpCode(HttpStatus.OK)
  revert(@Param('key') key: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    const settled = this.key(key);
    this.sections.revert(settled);

    this.audit.record({
      actorId: actor.id,
      actorName: actor.username,
      action: 'section.revert',
      target: `section:${settled}`,
      ip: clientIp(req),
    });

    return { ok: true };
  }
}
