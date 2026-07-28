import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './crypto/crypto.module';
import { DbModule } from './db/db.module';
import { LeadsModule } from './leads/leads.module';
import { OrgsModule } from './orgs/orgs.module';
import { QueueModule } from './queue/queue.module';
import { SendersModule } from './senders/senders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Root .env is the single source; apps/api/.env can override locally.
      envFilePath: ['.env', '../../.env'],
    }),
    DbModule,
    CryptoModule,
    QueueModule,
    AuthModule,
    OrgsModule,
    LeadsModule,
    SendersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
