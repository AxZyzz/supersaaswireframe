import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { OrgsModule } from './orgs/orgs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Root .env is the single source; apps/api/.env can override locally.
      envFilePath: ['.env', '../../.env'],
    }),
    DbModule,
    AuthModule,
    OrgsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
