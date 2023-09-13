import { Injectable } from '@nestjs/common';
import { ITelegramService } from './types/telegram.interface';
import { SendVoteRequestDto } from '../dtos/send-vote.dto';
import TelegramBot from 'node-telegram-bot-api';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService implements ITelegramService {
  public bot: TelegramBot;
  constructor(private configService: ConfigService) {
    this.bot = new TelegramBot(this.configService.get<string>('BOT_TOKEN'), {
      polling: true,
    });
  }
  SendVote = (request: SendVoteRequestDto): void => {
    this.bot.sendPoll(this.configService.get<string>('GROUP_CHAT_ID'),))
  };
  PinMessage = (): void => {};
}
