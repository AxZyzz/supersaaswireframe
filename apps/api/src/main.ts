import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // API_PORT matches .env.example; real env loading (@nestjs/config) lands in E1
  await app.listen(process.env.API_PORT ?? 4000);
}
bootstrap();
