import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Cache } from 'cache-manager';
import * as TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class AppService {
  private bot: TelegramBot;
  private logger: Logger;
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {
    this.bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    this.bot.on('poll_answer', async (msg) => {
      const vote = (await this.cacheManager.get('vote')) as any;
      if (vote?.poll?.id === msg?.poll_id) {
        if (!vote?.poll['participants']) {
          vote.poll['participants'] = [];
        }
        vote?.poll['participants'].push(msg);
        await this.cacheManager.set('vote', vote);
      }
    });
    this.logger = new Logger(AppService.name);
  }
  @Cron(CronExpression.EVERY_SECOND)
  async sendVeilaniPool(): Promise<void> {
    const voteExisted = await this.cacheManager.get('vote');
    if (!voteExisted) {
      Logger.log('Telegram Vote Sending ...');
      this.bot
        .sendPoll(
          process.env.CHAT_ID,
          'امشب ساعت چند کانتر ویلانی رو راه بندازیم؟',
          ['10', '10/30', '11', 'تا ساعت 9 اطلاع میدم', 'نمیام'],
          {
            is_anonymous: false,
            allows_multiple_answers: false,
            disable_notification: false,
          },
        )
        .then((res) => {
          this.cacheManager.set('vote', res);
          Logger.log('Telegram Vote Sent Successfully');
          Logger.log('Telegram Vote Stored in MemoryCache');
        })
        .catch((err) => {
          Logger.log(`Telegram Vote Error: ${err.message}`);
        });
    }
  }
  @Cron(CronExpression.EVERY_SECOND)
  async sendPollResult(): Promise<void> {
    const vote = (await this.cacheManager.get('vote')) as any;
    if (!vote) return;
    this.bot.sendMessage(process.env.CHAT_ID, JSON.stringify(vote));
    //await this.cacheManager.del('vote');
  }
}
