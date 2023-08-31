import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Cache } from 'cache-manager';
import * as TelegramBot from 'node-telegram-bot-api';
import { VoteOptions } from './constants/options.vote';
import { GroupInformation } from './constants/group.info';
import * as Gamedig from 'gamedig';
import { createReadStream } from 'fs';

@Injectable()
export class AppService {
  private bot: TelegramBot;
  private logger: Logger;
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {
    this.bot = new TelegramBot(GroupInformation.BotToken, { polling: true });
    this.bot.onText(/جکس/, (msg) => {
      const { message_id } = msg;
      this.bot.sendVoice(
        GroupInformation.ChatId,
        createReadStream('./src/assets/jaxprompt.ogg'),
        {
          reply_to_message_id: message_id,
        },
      );
    });

    this.bot.onText(/\/state/, async () => {
      try {
        const serverData = await Gamedig.query({
          type: 'csgo',
          host: '185.141.104.39',
          port: '30364',
        });
        this.bot.sendMessage(
          GroupInformation.ChatId,
          `وضعیت سرور ویلانی در حال حاضر \n نام سرور :${
            serverData.name
          }\n  مپ در حال بازی : ${
            serverData.map
          } \n تعداد کاربران حاضر در سرور:${
            serverData.raw.numplayers
          } \n افرادی که داخل سرور هستند : \n${serverData.players
            .map((item) => `${item.name}`)
            .filter((x) => x !== 'MaxGaming.ir-GOTV') // remove gotv
            .join('\n')}
         `,
        );
      } catch (error) {
        this.bot.sendMessage(
          GroupInformation.ChatId,
          'متاسفانه نتونستم به سرور های استیم وصل شم ! ',
        );
      }
    });

    // TODO: this part
    // this.bot.on('poll_answer', async (msg) => {
    //   const vote = (await this.cacheManager.get('vote')) as any;
    //   // first check if this message belongs to specific vote !!!
    //   if (vote?.poll?.id === msg?.poll_id) {
    //     // add participants to object and initialize it at first
    //     if (!vote?.poll['participants']) {
    //       vote.poll['participants'] = [];
    //     }
    //     // check if user retrack her/his vote
    //     if (msg.option_ids.length === 0) {
    //       // vala bekhoda in che vazeshe sendmessage
    //       this.bot.sendMessage(
    //         process.env.CHAT_ID,
    //         `${
    //           '@' + msg.user.username
    //         } عزیزم مگ ما مسخره باباتیم که رای اتو برمیداری؟`,
    //       );
    //       // remove vote from participants
    //       vote.poll.participants = vote?.poll?.participants.filter(
    //         (x) => x.id !== msg.user.id,
    //       );
    //     } else {
    //       // add vote to participants in csgo
    //       vote?.poll?.participants.push({
    //         ...msg.user,
    //         answer: Number(msg.option_ids.join('')),
    //       });
    //     }
    //     // vote or retrack vote ,everything must be updated !!
    //     // add 12 hours TTL message to local cache manager
    //     await this.cacheManager.set('vote', vote, 43200000);
    //   }
    // });
    this.logger = new Logger(AppService.name);
  }

  // @Cron(CronExpression.EVERY_5_SECONDS)
  // async getPlayersCsgo() {
  //   const serverData = await Gamedig.query({
  //     type: 'csgo',
  //     host: '185.141.104.39',
  //     port: '30364',
  //   });

  //   console.log(serverData.players.map((item) => item));
  // }

  @Cron(CronExpression.EVERY_DAY_AT_5PM, {
    timeZone: 'Asia/Tehran',
  })
  async SendVeilaniPool(): Promise<void> {
    Logger.log('Telegram Vote Sending ...');
    this.bot
      .sendPoll(
        GroupInformation.ChatId,
        'امشب ساعت چند کانتر ویلانی رو راه بندازیم؟',
        VoteOptions.map((x) => x.title),
        {
          is_anonymous: false,
          allows_multiple_answers: false,
          disable_notification: false,
        },
      )
      .then((res) => {
        // TODO: do this part
        // this.cacheManager.set('vote', res, 43200000); //12 hour cached !
        Logger.log('Telegram Vote Sent Successfully');
        // Logger.log('Telegram Vote Stored in MemoryCache');
        // this.bot.pinChatMessage(GroupInformation.ChatId);
        setTimeout(() => {
          this.bot
            .pinChatMessage(GroupInformation.ChatId, res.message_id, {
              disable_notification: false,
            })
            .then(() => Logger.log('Pin Vote Successfully'))
            .catch((err) => {
              Logger.log(`Telegram Vote Error: ${err.message}`);
            });
        }, 1000);
      })
      .catch((err) => {
        Logger.log(`Telegram Vote Error: ${err.message}`);
      });
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM, {
    timeZone: 'Asia/Tehran',
  })
  async SendVeilaniPool_Test(): Promise<void> {
    Logger.log('Telegram Vote Sending ...');
    this.bot
      .sendPoll(
        GroupInformation.TestChatId,
        'امشب ساعت چند کانتر ویلانی رو راه بندازیم؟',
        VoteOptions.map((x) => x.title),
        {
          is_anonymous: false,
          allows_multiple_answers: false,
          disable_notification: false,
        },
      )
      .then((res) => {
        // TODO: do this part
        // this.cacheManager.set('vote', res, 43200000); //12 hour cached !
        Logger.log('Telegram Vote Sent Successfully');
        // Logger.log('Telegram Vote Stored in MemoryCache');
        setTimeout(() => {
          this.bot
            .pinChatMessage(GroupInformation.TestChatId, res.message_id, {
              disable_notification: false,
            })
            .then(() => Logger.log('Pin Vote Successfully'))
            .catch((err) => {
              Logger.log(`Telegram Vote Error: ${err.message}`);
            });
        }, 1000);
      })
      .catch((err) => {
        Logger.log(`Telegram Vote Error: ${err.message}`);
      });
  }
  // TODO :
  // @Cron('0 */30 21-23 * * *')
  // async stopPool(): Promise<void> {
  //   const vote = (await this.cacheManager.get('vote')) as any;
  //   if (typeof vote !== 'undefined' && Object.keys(vote).length > 0) {
  //     // this.bot.stopPoll(process.env.CHAT_ID, vote.message_id);
  //     this.bot.sendMessage(
  //       process.env.CHAT_ID,
  //       `دوستان نظرسنجی تموم شد و الان نتیجه برگزاری امشب کانتر سرور رو اعلام میکنم`,
  //     );

  //     // calculate status
  //     const votes = _.groupBy(vote.poll.participants, 'answer');
  //     let winnerVoters = 0;
  //     // check for winner time
  //     VoteOptions.map((item) => {
  //       if (votes[item.id]) {
  //         if (item.isVotingTime) {
  //           if (votes[item.id].length > 10) {
  //             winnerVoters += votes[item.id].length;
  //             this.bot.sendMessage(
  //               process.env.CHAT_ID,
  //               'به به اینجور که مشخصه بازی راس ساعت 10 قراره شروع بشه پس دیر نکنید دوستان',
  //             );
  //             return;
  //           } else if (votes[item.id].length > 1) {
  //             winnerVoters += votes[item.id].length;
  //             if (winnerVoters < 10) {
  //               this.bot.sendMessage(
  //                 process.env.CHAT_ID,
  //                 `وضعیت برای ساعت 10 مشخص نیست  و باید بزارید برم ساعت بعدی رو نگاه کنم با آدمایی که  ساعت بعدی رای دادن جمع بزنم تا ببینم دنیا دست کیه`,
  //               );
  //             } else {
  //               this.bot.sendMessage(
  //                 process.env.CHAT_ID,
  //                 `مشتی هستید و بی ریا ، امشب قراره تو ویلانی بازی کنیم ، همتون رو راس ساعت ${item.title} میبینم`,
  //               );
  //               return;
  //             }
  //           }
  //         } else {
  //           if (item.isValidAnswer) {
  //             if (winnerVoters < 10) {
  //               if (winnerVoters + votes[3].length >= 10) {
  //                 // help us to add winners
  //                 this.bot.sendMessage(
  //                   process.env.CHAT_ID,
  //                   `لطفا اطلاع بدین هم اکنون به یاری سبزتان نیازمنید و ${
  //                     10 - winnerVoters
  //                   } نفر نیاز داریم \n\n\n ${votes[3].map(
  //                     (x) =>
  //                       `@${x.username} \n\n\n لطفا نظر نهاییتون مشخص کنید`,
  //                   )}`,
  //                 );
  //               } else {
  //                 this.bot.sendMessage(
  //                   process.env.CHAT_ID,
  //                   'با این وضعیت بازی ای برگزار نمیشه ، مگر اینکه خودتون کاری کنید ، از دست من دیگ کاری بر نمیاد ، بای',
  //                 );
  //               }
  //             }
  //           }
  //         }
  //       }
  //     });
  //   }
  // }
}
