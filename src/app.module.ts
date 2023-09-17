import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { configuration } from './config/configuration';
import { TelegramModule } from './providers/bot/node-telegram-bot-api/telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: `${process.cwd()}/src/config/env/${process.env.NODE_ENV.trim()}.env`,
      load: [configuration],
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    CacheModule.register(),
    TelegramModule,
  ],
  providers: [AppService],
})
export class AppModule {}
