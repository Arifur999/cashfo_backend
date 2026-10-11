import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module.js';
import { BETTER_AUTH, type Auth } from './auth/better-auth.js';
import { betterAuthMiddleware } from './auth/better-auth.middleware.js';
import { parseTrustProxy } from './common/trust-proxy.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Must be set before anything reads req.ip -- the login throttle, Login
  // Monitoring and the audit log all key on it. See common/trust-proxy.ts.
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

  app.use(cookieParser());
  // Uploaded contact photos (see contacts/contact-photo-upload.ts) -- local
  // disk, no cloud storage configured, served back the same way any other
  // static asset would be.
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));
  app.enableCors({
    origin: process.env.ADMIN_FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  // Google sign-in, session checks and the Better Auth dashboard. Must stay
  // ahead of Nest's body parser, which is only added when the app starts.
  app.use(betterAuthMiddleware(app.get<Auth>(BETTER_AUTH)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ?? 5000;
  await app.listen(port);
  console.log(`Backend listening on http://localhost:${port}`);
}
await bootstrap();
