import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { TelegramModule } from './providers/bot/node-telegram-bot-api/telegram/telegram.module';
import { AppService } from './app.service';
import { configuration } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
     ScheduleModule.forRoot(),
     DatabaseModule,
     TelegramModule,
  ],
   providers: [AppService],
})
export class AppModule {}
