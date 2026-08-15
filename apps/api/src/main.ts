import 'reflect-metadata'
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

for (const path of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../app/.env'),
  resolve(__dirname, '../.env'),
  resolve(__dirname, '../../app/.env'),
]) {
  if (existsSync(path)) config({ path })
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true })
  const origin = process.env.WEB_ORIGIN || 'http://localhost:3000'
  app.enableCors({
    origin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-run-id'],
  })
  const port = Number(process.env.PORT || 3333)
  await app.listen(port)
  console.log(`EvoStack API listening on ${port}`)
}

bootstrap()
