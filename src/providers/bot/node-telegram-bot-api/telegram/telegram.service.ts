import { Injectable, Logger } from '@nestjs/common';
import { ITelegramService } from './types/telegram.interface';
import * as TelegramBot from 'node-telegram-bot-api';
import { ConfigService } from '@nestjs/config';
import { VoteConfig } from '../config/vote.config';
// import * as Gamedig from 'gamedig';
// import { Server, RCON, MasterServer } from '@fabricio-191/valve-server-query';

@Injectable()
export class TelegramService implements ITelegramService {
  public bot: TelegramBot;
  private readonly logger = new Logger(TelegramService.name);
  constructor(private readonly configService: ConfigService) {
    this.bot = new TelegramBot(this.configService.get<string>('BOT_TOKEN'), {
      polling: true,
    });

    this.bot.onText(/\/server/, this.handleServerCommand);
  }

  private handleServerCommand = async (message: TelegramBot.Message) => {
    try {
      const serverDetails = 'connect 5.57.32.32:28441;password veilani';
      
      this.bot.sendMessage(
        message.chat.id,
        serverDetails,
      );
    } catch (error) {
      this.logger.error('Server command failed ====>', error);
      this.bot.sendMessage(
        message.chat.id,
        'Sorry, something went wrong!',
      );
    }
  };

  SendVote = (): Promise<TelegramBot.Message> => {
    try {
      return this.bot.sendPoll(
        this.configService.get<string>('GROUP_CHAT_ID'),
        VoteConfig.question,
        VoteConfig.options.map((item) => item.title),
        {
          allows_multiple_answers: false,
          disable_notification: false,
          is_anonymous: false,
        },
      );
    } catch (error) {
      this.logger.error('Telegram Sending Vote Failed ====>', error);
    }
  };
  PinVote = (voteId: number): Promise<boolean> => {
    try {
      return this.bot.pinChatMessage(
        this.configService.get<string>('GROUP_CHAT_ID'),
        voteId,
        {
          disable_notification: false,
        },
      );
    } catch (error) {
      this.logger.error('Telegram Pin Message Failed ====> ', error);
    }
  };
}
