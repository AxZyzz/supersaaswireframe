import { Module } from '@nestjs/common';
import { SendersModule } from '../senders/senders.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [SendersModule], // for SendersService (template test-send)
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
