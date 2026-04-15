import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

/**
 * Validate that all required environment variables are present before the
 * application boots.  Failing fast here prevents cryptic runtime errors later.
 */
function validateEnv(): void {
  const required = [
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_NAME',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `[Bootstrap] Missing required environment variables: ${missing.join(', ')}`,
    );
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  validateEnv();

  const app = await NestFactory.create(AppModule);

  // ── Security headers (OWASP best-practice defaults) ───────────────────────
  app.use(helmet());

  // ── Cookie parsing (required for voter_token deduplication) ───────────────
  app.use(cookieParser());

  // ── CORS ──────────────────────────────────────────────────────────────────
  // ALLOWED_ORIGINS is a comma-separated list of allowed origins.
  // Defaults to localhost:3001 for local frontend dev.
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ?? 'http://localhost:3001'
  )
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: allowedOrigins,
    credentials: true, // Required so the browser sends the voter_token cookie
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  // ── Global validation pipe ────────────────────────────────────────────────
  // whitelist: strips unknown properties silently
  // forbidNonWhitelisted: rejects requests with properties not in the DTO
  // transform: auto-converts plain objects to DTO class instances
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ── Global exception filter ────────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Global route prefix ───────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('Feud API')
    .setDescription('The Feud API description')
    .setVersion('1.0')
    .addTag('feud')
    .addSecurity('X-Admin-Code', {
      type: 'apiKey',
      in: 'header',
    })
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`[Bootstrap] Feud API running on port ${port}`);
}

bootstrap().catch((e) => {
  console.error('[Bootstrap] Error starting the application:', e);
  process.exit(1);
});
