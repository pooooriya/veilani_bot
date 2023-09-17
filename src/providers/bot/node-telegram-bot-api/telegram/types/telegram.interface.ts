import TelegramBot from 'node-telegram-bot-api';

export interface ITelegramService {
  SendVote: () => Promise<TelegramBot.Message>;
  PinVote: (voteId: number) => Promise<boolean>;
}
