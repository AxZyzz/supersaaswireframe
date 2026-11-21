import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { ExperimentsController } from './experiments.controller';
import { ExperimentsService } from './experiments.service';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  controllers: [CampaignsController, OffersController, ExperimentsController],
  providers: [CampaignsService, OffersService, ExperimentsService],
  exports: [OffersService, ExperimentsService],
})
export class CampaignsModule {}
