import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const isProd = process.env.NODE_ENV === 'production';

  // Behind a load balancer the client IP is in X-Forwarded-For; without this
  // the throttler buckets every request under the proxy's IP. Hop count, not
  // `true`, so a client can't spoof its way past rate limits.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  }
  // JSON API + tracking pixels/redirects only — no HTML pages to frame.
  // CSP off outside prod so the dev-only Swagger UI (inline scripts) loads.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: isProd ? undefined : false,
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  app.enableShutdownHooks();

  // Live updates fan out through Redis so every API instance sees them.
  const io = new RedisIoAdapter(app);
  io.connect(process.env.REDIS_URL ?? 'redis://localhost:6379');
  app.useWebSocketAdapter(io);

  // API docs are a recon map — dev only unless explicitly switched on.
  if (!isProd || process.env.SWAGGER === 'on') {
    const swagger = new DocumentBuilder()
      .setTitle('SuperSaaS API')
      .setDescription('AI outreach platform — V1 API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swagger),
    );
  }

  // API_PORT matches .env.example; loaded via ConfigModule from root .env
  await app.listen(process.env.API_PORT ?? 4000);
}
void bootstrap();
