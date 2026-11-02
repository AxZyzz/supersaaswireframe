import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MembershipCache } from './membership-cache.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_ACCESS_SECRET',
          'dev-access-secret-change-me',
        ),
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 100, ttl: 60_000 }],
      // Test-only escape hatch (route-sweep suites); env validation forbids
      // it in production.
      skipIf: () => process.env.THROTTLE_DISABLED === 'true',
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MembershipCache,
    // Order matters: throttle → authn → authz.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, MembershipCache],
})
export class AuthModule {}
