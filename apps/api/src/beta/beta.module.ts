import { Global, Module } from '@nestjs/common';
import { OperatorGuard } from '../operator/operator.guard';
import { BetaController, BetaOperatorController } from './beta.controller';
import { BetaService } from './beta.service';

/** Global so AuthService can gate sign-up on an invite in waitlist mode. */
@Global()
@Module({
  controllers: [BetaController, BetaOperatorController],
  providers: [BetaService, OperatorGuard],
  exports: [BetaService],
})
export class BetaModule {}
