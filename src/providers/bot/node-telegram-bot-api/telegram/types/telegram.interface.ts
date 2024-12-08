import TelegramBot from 'node-telegram-bot-api';

export interface ITelegramService {
  sendVote: () => Promise<TelegramBot.Message>;
  pinVote: (voteId: number) => Promise<boolean>;
}
