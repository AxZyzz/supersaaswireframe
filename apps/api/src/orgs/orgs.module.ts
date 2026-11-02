import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InvitesController } from './invites.controller';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';
import { TeamService } from './team.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [OrgsController, InvitesController],
  providers: [OrgsService, TeamService],
  exports: [OrgsService],
})
export class OrgsModule {}
