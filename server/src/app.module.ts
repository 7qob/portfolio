import { Module } from '@nestjs/common';

import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { ProjectsModule } from './projects/projects.module';
import { SectionsModule } from './sections/sections.module';
import { UsersModule } from './users/users.module';
import { VaultModule } from './vault/vault.module';

@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    AuthModule,
    VaultModule,
    AdminModule,
    ProjectsModule,
    SectionsModule,
    MediaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
