import TelegramBot from 'node-telegram-bot-api';

export class SendVoteRequestDto {
  Question: string;
  Options: string[];
  VoteOptions: TelegramBot.SendPollOptions;
}
