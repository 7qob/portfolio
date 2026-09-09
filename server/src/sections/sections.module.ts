import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuditService } from '../common/audit.service';
import { SectionsController } from './sections.controller';
import { SectionsService } from './sections.service';

@Module({
  imports: [AuthModule],
  controllers: [SectionsController],
  providers: [SectionsService, AuditService],
})
export class SectionsModule {}
