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

    // this.bot.onText(/\/server/, this.handleServerCommand);
  }

  // private handleServerCommand = async (message: TelegramBot.Message) => {
  //   try {
  //     const server = await Server({
  //       ip: '185.141.133.16',
  //       port: 30378,
  //       timeout: 20000,
  //     });
  //     const info = await server.getInfo();
  //     console.log(info);

  //     const players = await server.getPlayers();
  //     console.log(players);

  //     const rules = await server.getRules();
  //     console.log(rules);

  //     const ping = server.lastPing;
  //     console.log(ping);

  //     // Gamedig.query({
  //     //   type: 'csgo',
  //     //   host: '185.141.133.16',
  //     //   maxAttempts: 3,
  //     //   socketTimeout: 20000,
  //     //   givenPortOnly: true,
  //     //   debug: true,
  //     // })
  //     //   .then((state) => {
  //     //     console.log(state);
  //     //   })
  //     //   .catch((error) => {
  //     //     console.log('Server is offline');
  //     //     console.log(error);
  //     //   });
  //     // const serverData = await Gamedig.query({
  //     //   type: 'csgo',
  //     //   host: '185.141.133.16',
  //     //   port: '30378',
  //     // });
  //     // this.bot.sendMessage(
  //     //   message.chat.id,
  //     //   `وضعیت سرور ویلانی در حال حاضر \n نام سرور :${
  //     //     serverData.name
  //     //   }\n  مپ در حال بازی : ${serverData.map} \n تعداد کاربران حاضر در سرور:${
  //     //     serverData.raw.numplayers
  //     //   } \n افرادی که داخل سرور هستند : \n${serverData.players
  //     //     .map((item) => `${item.name}`)
  //     //     .filter((x) => x !== 'MaxGaming.ir-GOTV') // remove gotv
  //     //     .join('\n')}
  //     //    `,
  //     // );
  //   } catch (error) {
  //     console.log(error);

  //     this.bot.sendMessage(
  //       message.chat.id,
  //       'متاسفانه نتونستم به سرور های استیم وصل شم ! ',
  //     );
  //   }
  // };

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
