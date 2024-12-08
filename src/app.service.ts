import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelegramService } from './providers/bot/node-telegram-bot-api/telegram/telegram.service';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly telegramService: TelegramService) {}

  // ارسال نظرسنجی روزانه ساعت 6 عصر
  @Cron('0 0 18 * * *', {
    timeZone: 'Asia/Tehran',
  })
  async sendDailyVote() {
    try {
      this.logger.log('Sending daily vote...');
      const vote = await this.telegramService.sendVote();
      await this.telegramService.pinVote(vote.message_id);

      // ایجاد سشن جدید بازی
      await this.telegramService.createNewGameSession();

      this.logger.log('Daily vote sent and pinned successfully');
    } catch (error) {
      this.logger.error('Failed to send daily vote', error);
    }
  }

  // یادآوری هر 30 دقیقه از ساعت 9 تا 11
  @Cron('0 */30 21-22 * * *', {
    timeZone: 'Asia/Tehran',
  })
  async sendReminders() {
    try {
      await this.telegramService.reminderCheck();
      this.logger.log('Sent reminder check');
    } catch (error) {
      this.logger.error('Failed to send reminder', error);
    }
  }

  // بستن نظرسنجی و اعلام نتیجه نهایی ساعت 11
  @Cron('0 0 23 * * *', {
    timeZone: 'Asia/Tehran',
  })
  async finalizeVote() {
    try {
      await this.telegramService.stopPoll();
      this.logger.log('Vote finalized at 11 PM');
    } catch (error) {
      this.logger.error('Failed to finalize vote', error);
    }
  }

  // ریست کردن دیتا ساعت 12 ظهر
  @Cron('0 0 12 * * *', {
    timeZone: 'Asia/Tehran',
  })
  async resetData() {
    try {
      await this.telegramService.resetVoteData();
      this.logger.log('Reset vote data at noon');
    } catch (error) {
      this.logger.error('Failed to reset vote data', error);
    }
  }
}
