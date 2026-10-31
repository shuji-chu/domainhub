import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: Number(process.env.TRUSTED_PROXY_HOPS || 0) }),
  );
  const appOrigin = process.env.PUBLIC_APP_URL;\n  if (appOrigin) app.enableCors({ origin: appOrigin, credentials: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "X-CSRF-Token"] });\n  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}
if (require.main === module) void bootstrap();
