import { Injectable, Logger } from '@nestjs/common';
import { ITelegramService } from './types/telegram.interface';
import * as TelegramBot from 'node-telegram-bot-api';
import { ConfigService } from '@nestjs/config';
import { VoteConfig } from '../config/vote.config';

@Injectable()
export class TelegramService implements ITelegramService {
  public bot: TelegramBot;
  private readonly logger = new Logger(TelegramService.name);
  private votedUsers: Set<number> = new Set();
  private retractedUsers: Set<number> = new Set();
  private voteDate: Date;
  private matchTime: Date;
  private threshold: number = 10;
  private needsFollowUpUsers: Set<number> = new Set();

  constructor(private readonly configService: ConfigService) {
    this.bot = new TelegramBot(this.configService.get<string>('BOT_TOKEN'), {
      polling: true,
    });
    this.bot.onText(/\/server/, this.handleServerCommand);
    this.bot.on('poll_answer', this.handlePollAnswer);
  }

  private handleServerCommand = async (message: TelegramBot.Message) => {
    try {
      const serverDetails = 'connect 5.57.32.32:28441;password veilani';
      await this.bot.sendMessage(message.chat.id, `\`${serverDetails}\``, {
        parse_mode: 'MarkdownV2',
      });
    } catch (error) {
      this.logger.error('Server command failed ====>', error);
      await this.bot.sendMessage(
        message.chat.id,
        'متأسفانه مشکلی پیش آمده است!',
      );
    }
  };

  private handlePollAnswer = async (pollAnswer: TelegramBot.PollAnswer) => {
    const userId = pollAnswer.user.id;
    const currentDay = new Date().toDateString();
    const needsFollowUp = pollAnswer.option_ids[0] === 3; // Index 3 is "تا ساعت 9 اطلاع میدم"

    // اگر روز عوض شده ریست میکنیم
    if (!this.voteDate || this.voteDate.toDateString() !== currentDay) {
      this.votedUsers.clear();
      this.retractedUsers.clear();
      this.needsFollowUpUsers = new Set<number>();
      this.voteDate = new Date();
      this.matchTime = null;
    }

    // اگر کاربر رای خود را بردارد
    if (pollAnswer.option_ids.length === 0) {
      if (this.votedUsers.has(userId)) {
        this.votedUsers.delete(userId);
        this.needsFollowUpUsers.delete(userId);
        this.retractedUsers.add(userId);
        await this.bot.sendMessage(
          this.configService.get<string>('GROUP_CHAT_ID'),
          `کاربر ${pollAnswer.user.first_name} رأی خود را برداشت.`,
        );
      }
    } else {
      // اگر کاربر برای اولین بار رای می‌دهد
      if (!this.votedUsers.has(userId)) {
        this.votedUsers.add(userId);
        if (needsFollowUp) {
          this.needsFollowUpUsers.add(userId);
        }
      }
    }

    // اگر به حد نصاب برسیم و زمان بازی تنظیم نشده باشد
    if (
      this.votedUsers.size - this.needsFollowUpUsers.size === this.threshold &&
      !this.matchTime
    ) {
      const now = new Date();
      this.matchTime = new Date(now.getTime() + 60 * 60 * 1000);
      await this.bot.sendMessage(
        this.configService.get<string>('GROUP_CHAT_ID'),
        `بازی به زودی در ساعت ${this.matchTime.toLocaleTimeString('fa-IR')} آغاز می‌شود!`,
      );
      // اگر زمان تعیین شد، در آن زمان اعلام شروع بازی می‌کنیم
      this.scheduleMatchStartAnnounce();
    }
  };

  SendVote = async (): Promise<TelegramBot.Message> => {
    try {
      // ریست برای روز جدید
      this.votedUsers.clear();
      this.retractedUsers.clear();
      this.voteDate = new Date();
      this.matchTime = null;

      const message = await this.bot.sendPoll(
        this.configService.get<string>('GROUP_CHAT_ID'),
        VoteConfig.question,
        VoteConfig.options.map((item) => item.title),
        {
          allows_multiple_answers: false,
          disable_notification: false,
          is_anonymous: false,
        },
      );

      // تایمر ساعت 9 شب: به رای‌دهنده‌ها یادآوری کن
      this.schedule9pmReminder();

      // تایمرهای بینابینی برا�� یادآوری بیشتر (مثلا 9:30 و 10:30)
      this.scheduleReminderIfNotReached(21, 30); // 9:30 شب
      this.scheduleReminderIfNotReached(22, 30); // 10:30 شب

      // تایمر ساعت 11 شب: اگر به حد نصاب نرسید اعلام کن نمیشه بازی کرد
      this.schedule11pmCheck();

      return message;
    } catch (error) {
      this.logger.error('Telegram Sending Vote Failed ====>', error);
    }
  };

  PinVote = async (voteId: number): Promise<boolean> => {
    try {
      return await this.bot.pinChatMessage(
        this.configService.get<string>('GROUP_CHAT_ID'),
        voteId,
        { disable_notification: false },
      );
    } catch (error) {
      this.logger.error('Telegram Pin Message Failed ====> ', error);
    }
  };

  private schedule9pmReminder() {
    const timeUntil9 = this.getTimeUntilHour(21, 0);
    if (timeUntil9 > 0) {
      setTimeout(async () => {
        if (this.needsFollowUpUsers.size > 0) {
          const followUpMentions = Array.from(this.needsFollowUpUsers)
            .map((uid) => `[@${uid}](tg://user?id=${uid})`)
            .join(' ');
          await this.bot.sendMessage(
            this.configService.get<string>('GROUP_CHAT_ID'),
            `${followUpMentions} لطفاً اعلام کنید که آیا امشب در بازی شرکت می‌کنید یا خیر؟`,
            { parse_mode: 'Markdown' },
          );
        }

        if (this.votedUsers.size > 0 && !this.matchTime) {
          const mentionStr = Array.from(this.votedUsers)
            .filter((uid) => !this.needsFollowUpUsers.has(uid))
            .map((uid) => `[@${uid}](tg://user?id=${uid})`)
            .join(' ');
          await this.bot.sendMessage(
            this.configService.get<string>('GROUP_CHAT_ID'),
            `چی شد نتیجه؟ هنوز به حد نصاب نرسیدیم. دوستانی که رای دادن: ${mentionStr}\nلطفاً تصمیم نهاییتون رو اعلام کنید!`,
            { parse_mode: 'Markdown' },
          );
        } else if (this.votedUsers.size === 0) {
          // هیچکس رای نداده
          await this.bot.sendMessage(
            this.configService.get<string>('GROUP_CHAT_ID'),
            'هنوز کسی رای نداده! دوستان، لطفاً در نظرسنجی شرکت کنید تا بدونیم بازی برگزار میشه یا نه.',
          );
        }
      }, timeUntil9);
    }
  }

  private scheduleReminderIfNotReached(hour: number, minute: number) {
    const timeUntil = this.getTimeUntilHour(hour, minute);
    if (timeUntil > 0) {
      setTimeout(async () => {
        if (this.votedUsers.size < this.threshold && !this.matchTime) {
          await this.bot.sendMessage(
            this.configService.get<string>('GROUP_CHAT_ID'),
            `هنوز به حد نصاب (${this.threshold} نفر) نرسیدیم! دوستان بجنبید تا بازی برگزار بشه.`,
          );
        }
      }, timeUntil);
    }
  }

  private schedule11pmCheck() {
    const timeUntil11 = this.getTimeUntilHour(23, 0);
    if (timeUntil11 > 0) {
      setTimeout(async () => {
        // ساعت 11 شب: اگر بازی تایید نشده، اعلام کن برگزار نمیشه
        if (this.votedUsers.size < this.threshold && !this.matchTime) {
          await this.bot.sendMessage(
            this.configService.get<string>('GROUP_CHAT_ID'),
            `تا ساعت 11 شب به حد نصاب ${this.threshold} نفر نرسیدیم، امشب بازی برگزار نمیشه.`,
          );
        }
      }, timeUntil11);
    }
  }

  private scheduleMatchStartAnnounce() {
    if (this.matchTime) {
      const now = new Date();
      const timeUntilMatch = this.matchTime.getTime() - now.getTime();
      if (timeUntilMatch > 0) {
        setTimeout(async () => {
          const mentionStr = Array.from(this.votedUsers)
            .map((uid) => `[@${uid}](tg://user?id=${uid})`)
            .join(' ');
          await this.bot.sendMessage(
            this.configService.get<string>('GROUP_CHAT_ID'),
            `بازی اکنون آغاز می‌شود! ${mentionStr}`,
            { parse_mode: 'Markdown' },
          );
        }, timeUntilMatch);
      }
    }
  }

  private getTimeUntilHour(hour: number, minute: number): number {
    const now = new Date();
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hour,
      minute,
      0,
      0,
    );
    if (target.getTime() < now.getTime()) {
      // اگر زمان گذشته، برای فردا تنظیم کن
      target.setDate(target.getDate() + 1);
    }
    return target.getTime() - now.getTime();
  }
}
