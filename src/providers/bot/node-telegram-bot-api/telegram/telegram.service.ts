import { Injectable, Logger } from '@nestjs/common';
import { ITelegramService } from './types/telegram.interface';
import * as TelegramBot from 'node-telegram-bot-api';
import { ConfigService } from '@nestjs/config';
import { VoteConfig } from '../config/vote.config';
import { VoteMessages } from '../config/messages.config';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class TelegramService implements ITelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private votedUsers: Set<number> = new Set();
  private retractedUsers: Set<number> = new Set();
  private needsFollowUpUsers: Set<number> = new Set();
  private threshold: number = 10;
  private messagesSinceLastPoll: number = 0;
  private currentPollId: number = null;
  private currentGameSession: number = null;
  public bot: TelegramBot;
  private userVotes: Map<number, number> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {
    this.bot = new TelegramBot(this.configService.get<string>('BOT_TOKEN'), {
      polling: true,
    });
    this.setupHandlers();
  }

  private setupHandlers() {
    this.bot.onText(/\/server/, this.handleServerCommand);
    this.bot.onText(/\/stats/, this.handleStatsCommand);
    this.bot.onText(/\/top/, this.handleTopPlayersCommand);
    this.bot.onText(/\/game_stats/, this.handleGameStatsCommand);
    this.bot.on('poll_answer', this.handlePollAnswer);
    this.bot.on('message', this.handleMessage);
  }

  private handleMessage = async (msg: TelegramBot.Message) => {
    if (
      msg.chat.id.toString() === this.configService.get<string>('GROUP_CHAT_ID')
    ) {
      this.messagesSinceLastPoll++;

      // هر 20 پیام، نظرسنجی رو دوباره ارسال می‌کنیم
      if (this.messagesSinceLastPoll >= 20 && this.currentPollId) {
        this.messagesSinceLastPoll = 0;
        await this.resendPoll();
      }
    }
  };

  private async resendPoll() {
    try {
      const chatId = this.configService.get<string>('GROUP_CHAT_ID');
      await this.bot.sendMessage(
        chatId,
        '📊 یادآوری نظرسنجی امشب:\n' +
          `تعداد رای فعلی: ${this.votedUsers.size} نفر\n` +
          `حد نصاب مورد نیاز: ${this.threshold} نفر`,
      );

      // فوروارد کردن نظرسنجی اصلی
      await this.bot.forwardMessage(chatId, chatId, this.currentPollId);
    } catch (error) {
      this.logger.error('Failed to resend poll', error);
    }
  }

  private handleStatsCommand = async (msg: TelegramBot.Message) => {
    try {
      const stats = await this.databaseService.getUserStats(msg.from.id);
      if (stats) {
        await this.bot.sendMessage(
          msg.chat.id,
          `📊 آمار شما در بازی‌های ویلانی:

🎮 تعداد کل شرکت در نظرسنجی: ${stats.total_votes}
✅ تعداد حضور در بازی: ${stats.positive_votes}
📈 درصد مشارکت: ${stats.participation_rate.toFixed(1)}%

آخرین حضور: ${new Date(stats.last_vote_date).toLocaleDateString('fa-IR')}`,
          { parse_mode: 'Markdown' },
        );
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          'شما هنوز در هیچ نظرسنجی شرکت نکرده‌اید!',
        );
      }
    } catch (error) {
      this.logger.error('Failed to get user stats', error);
    }
  };

  private handleTopPlayersCommand = async (msg: TelegramBot.Message) => {
    try {
      const topPlayers = await this.databaseService.getTopPlayers();
      let message = '🏆 برترین بازیکنان ویلانی:\n\n';

      topPlayers.forEach((player, index) => {
        message +=
          `${index + 1}. ${player.first_name}\n` +
          `└ مشارکت: ${player.participation_rate.toFixed(1)}% | ` +
          `حضور: ${player.positive_votes} از ${player.total_votes}\n\n`;
      });

      await this.bot.sendMessage(msg.chat.id, message);
    } catch (error) {
      this.logger.error('Failed to get top players', error);
    }
  };

  private handleGameStatsCommand = async (msg: TelegramBot.Message) => {
    try {
      const stats = await this.databaseService.getGameStats();
      await this.bot.sendMessage(
        msg.chat.id,
        `📈 آمار کلی بازی‌های ویلانی:

🎮 تعداد کل بازی‌های برنامه‌ریزی شده: ${stats.totalGames}
✅ تعداد بازی‌های برگزار شده: ${stats.confirmedGames}
📊 نرخ موفقیت: ${stats.successRate.toFixed(1)}%`,
      );
    } catch (error) {
      this.logger.error('Failed to get game stats', error);
    }
  };

  private handlePollAnswer = async (pollAnswer: TelegramBot.PollAnswer) => {
    if (
      !this.validatePollAnswer(pollAnswer) ||
      !this.validateUserData(pollAnswer.user)
    ) {
      return;
    }
    try {
      const userId = pollAnswer.user.id;
      const needsFollowUp = pollAnswer.option_ids[0] === 3;
      const chatId = this.configService.get<string>('GROUP_CHAT_ID');

      if (pollAnswer.option_ids.length === 0) {
        if (this.votedUsers.has(userId)) {
          this.votedUsers.delete(userId);
          this.needsFollowUpUsers.delete(userId);
          this.retractedUsers.add(userId);
          this.userVotes.delete(userId);

          // آپدیت دیتابیس
          await this.databaseService.updateUserStats(
            {
              id: userId,
              username: pollAnswer.user.username,
              first_name: pollAnswer.user.first_name,
            },
            false,
          );

          const message = this.getRandomMessage(VoteMessages.voteRetracted);
          await this.bot.sendMessage(
            chatId,
            this.formatMessage(message, this.getMention(pollAnswer.user)),
            { parse_mode: 'Markdown' },
          );

          // آپدیت وضعیت بازی در صورت کاهش تعداد به زیر حد نصاب
          if (
            this.currentGameSession &&
            this.votedUsers.size - this.needsFollowUpUsers.size < this.threshold
          ) {
            await this.databaseService.updateGameSession(
              this.currentGameSession,
              {
                status: 'pending',
              },
            );
          }
        }
      } else {
        if (!this.votedUsers.has(userId)) {
          this.votedUsers.add(userId);
          this.userVotes.set(userId, pollAnswer.option_ids[0]);

          if (needsFollowUp) {
            this.needsFollowUpUsers.add(userId);
          }

          // آپدیت دیتابیس با retry
          let retries = 3;
          while (retries > 0) {
            try {
              await this.databaseService.updateUserStats(
                {
                  id: userId,
                  username: pollAnswer.user.username,
                  first_name: pollAnswer.user.first_name,
                },
                pollAnswer.option_ids[0] < 3,
              );
              break;
            } catch (error) {
              retries--;
              if (retries === 0) throw error;
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }

          const message = this.getRandomMessage(VoteMessages.voteSubmitted);
          await this.bot.sendMessage(
            chatId,
            this.formatMessage(message, this.getMention(pollAnswer.user)),
            { parse_mode: 'Markdown' },
          );

          await this.sendProgressUpdate(chatId);

          // اگر به حد نصاب رسیدیم
          if (
            this.votedUsers.size - this.needsFollowUpUsers.size >=
            this.threshold
          ) {
            const gameTime = this.determineGameTime();
            await this.bot.sendMessage(
              chatId,
              this.formatMessage(VoteMessages.gameConfirmed, gameTime),
              { parse_mode: 'Markdown' },
            );

            // آپدیت وضعیت بازی در دیتابیس
            if (this.currentGameSession) {
              await this.databaseService.updateGameSession(
                this.currentGameSession,
                {
                  start_time: gameTime,
                  player_count:
                    this.votedUsers.size - this.needsFollowUpUsers.size,
                  status: 'confirmed',
                },
              );
            }
          }
        }
      }
    } catch (error) {
      await this.handleError(error, 'handlePollAnswer');
    }
  };

  private getMention(user: TelegramBot.User): string {
    return `[${user.first_name}](tg://user?id=${user.id})`;
  }

  private getRandomMessage(messages: string[]): string {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  private formatMessage(template: string, ...args: any[]): string {
    return template.replace(/%s/g, () => args.shift());
  }

  private async sendProgressUpdate(chatId: string) {
    const activeVoters = Array.from(this.votedUsers)
      .filter((uid) => !this.needsFollowUpUsers.has(uid))
      .map((uid) => `[@${uid}](tg://user?id=${uid})`)
      .join('\n');

    const message = this.formatMessage(
      VoteMessages.progressUpdate,
      this.votedUsers.size - this.needsFollowUpUsers.size,
      this.threshold,
      activeVoters,
    );

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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
        'متأسفانه مشکلی پیش آمده اس!',
      );
    }
  };

  sendVote = async (): Promise<TelegramBot.Message> => {
    try {
      this.votedUsers.clear();
      this.retractedUsers.clear();
      this.needsFollowUpUsers = new Set<number>();

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

      this.currentPollId = message.message_id;
      return message;
    } catch (error) {
      this.logger.error('Telegram Sending Vote Failed ====>', error);
    }
  };

  async stopPoll() {
    if (!this.currentPollId) {
      this.logger.warn('No active poll to stop');
      return;
    }

    try {
      const chatId = this.configService.get<string>('GROUP_CHAT_ID');
      await this.bot.stopPoll(chatId, this.currentPollId);

      // اعلام نتیجه نهایی
      if (this.votedUsers.size >= this.threshold) {
        const gameTime = this.determineGameTime();
        await this.bot.sendMessage(
          chatId,
          `🎮 بازی امشب راس سعت ${gameTime} برگزار میشه!\n\n` +
            `🎯 تعداد بازیکنان: ${this.votedUsers.size} نفر\n` +
            `👥 بازیکنان حاضر:\n${this.getPlayersList()}`,
          { parse_mode: 'Markdown' },
        );
      } else {
        await this.bot.sendMessage(
          chatId,
          `😔 متاسفانه امشب به حد نصاب ${this.threshold} نفر نرسیدیم. فردا دوباره تلاش می‌کنیم!`,
        );
      }

      this.currentPollId = null;
    } catch (error) {
      this.logger.error('Failed to stop poll', error);
    }
  }

  private determineGameTime(): string {
    const now = new Date();
    const tehranTime = new Date(
      now.toLocaleString('en-US', { timeZone: 'Asia/Tehran' }),
    );
    const currentHour = tehranTime.getHours();
    const currentMinute = tehranTime.getMinutes();

    // Remove past times
    const voteCount = {
      '22:00': currentHour < 22 ? 0 : null,
      '22:30':
        currentHour < 22 || (currentHour === 22 && currentMinute < 30)
          ? 0
          : null,
      '23:00': currentHour < 23 ? 0 : null,
    };

    // Count votes only for valid times
    const votes = Array.from(this.votedUsers).filter(
      (uid) => !this.needsFollowUpUsers.has(uid),
    );
    votes.forEach((uid) => {
      const userVote = this.userVotes.get(uid);
      if (userVote === 0 && voteCount['22:00'] !== null) voteCount['22:00']++;
      else if (userVote === 1 && voteCount['22:30'] !== null)
        voteCount['22:30']++;
      else if (userVote === 2 && voteCount['23:00'] !== null)
        voteCount['23:00']++;
    });

    // Remove null times
    Object.keys(voteCount).forEach((key) => {
      if (voteCount[key] === null) delete voteCount[key];
    });

    // If no valid times remain, return the nearest possible time
    if (Object.keys(voteCount).length === 0) {
      if (currentHour < 22) return '22:00';
      if (currentHour === 22 && currentMinute < 30) return '22:30';
      return '23:00';
    }

    return Object.entries(voteCount).reduce((a, b) => (a[1] > b[1] ? a : b))[0];
  }

  private getPlayersList(): string {
    return Array.from(this.votedUsers)
      .filter((uid) => !this.needsFollowUpUsers.has(uid))
      .map((uid) => `[@${uid}](tg://user?id=${uid})`)
      .join('\n');
  }

  async pinVote(messageId: number): Promise<boolean> {
    try {
      await this.bot.pinChatMessage(
        this.configService.get<string>('GROUP_CHAT_ID'),
        messageId,
      );
      return true;
    } catch (error) {
      this.logger.error('Failed to pin vote message', error);
      return false;
    }
  }

  async resetVoteData() {
    this.votedUsers.clear();
    this.retractedUsers.clear();
    this.needsFollowUpUsers.clear();
    this.userVotes.clear();
    this.messagesSinceLastPoll = 0;
    this.currentPollId = null;
    this.currentGameSession = null;
    this.logger.log('Vote data has been reset for the new day');
  }

  async checkFollowUps() {
    const chatId = this.configService.get<string>('GROUP_CHAT_ID');

    if (this.needsFollowUpUsers.size > 0) {
      const followUpMentions = Array.from(this.needsFollowUpUsers)
        .map((uid) => `[@${uid}](tg://user?id=${uid})`)
        .join(' ');
      await this.bot.sendMessage(
        chatId,
        `${followUpMentions} لطفاً اعلام نید که آیا امشب در بازی شرکت می‌کنید یا خیر؟`,
        { parse_mode: 'Markdown' },
      );
    }

    if (this.votedUsers.size > 0) {
      await this.sendProgressUpdate(chatId);
    } else {
      await this.bot.sendMessage(
        chatId,
        'هنوز کسی رای نداده! دوستان، لطفاً در نظرسنجی شرکت کنید تا بدونیم بازی برگزار میشه ی نه.',
      );
    }
  }

  async reminderCheck() {
    if (this.votedUsers.size < this.threshold) {
      await this.bot.sendMessage(
        this.configService.get<string>('GROUP_CHAT_ID'),
        `هنوز به حد نصاب (${this.threshold} نفر) نرسیدیم! دوستان بجنبید تا بازی برگزار بشه.`,
      );
    }
  }

  async finalCheck() {
    if (this.votedUsers.size < this.threshold) {
      await this.bot.sendMessage(
        this.configService.get<string>('GROUP_CHAT_ID'),
        `تا ساعت 11 شب به حد نصاب ${this.threshold} نفر نرسیدیم، امشب بازی برگزار نمیشه.`,
      );
    }
  }

  async createNewGameSession() {
    try {
      const tehranDate = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }),
      );
      const session = await this.databaseService.createGameSession(tehranDate);
      this.currentGameSession = session.id;
      this.logger.log('Created new game session:', session.id);
    } catch (error) {
      this.logger.error('Failed to create game session', error);
    }
  }

  private async handleError(error: any, context: string) {
    this.logger.error(`Error in ${context}:`, error);
    try {
      await this.bot.sendMessage(
        this.configService.get<string>('GROUP_CHAT_ID'),
        'متأسفانه مشکلی پیش آمده است. لطفاً دوباره تلاش کنید.',
      );
    } catch (e) {
      this.logger.error('Failed to send error message:', e);
    }
  }

  private validatePollAnswer(pollAnswer: TelegramBot.PollAnswer): boolean {
    if (!pollAnswer.user || !pollAnswer.user.id) {
      this.logger.warn('Invalid poll answer: missing user data');
      return false;
    }

    if (pollAnswer.option_ids && pollAnswer.option_ids.length > 1) {
      this.logger.warn('Invalid poll answer: multiple options selected');
      return false;
    }

    return true;
  }

  private validateUserData(user: TelegramBot.User): boolean {
    if (!user.id) {
      this.logger.warn('Invalid user: missing ID');
      return false;
    }

    if (!user.first_name && !user.username) {
      this.logger.warn('Invalid user: missing both first_name and username');
      return false;
    }

    return true;
  }

  async onModuleDestroy() {
    try {
      if (this.bot) {
        this.bot.removeAllListeners();
        await this.bot.stopPolling();
      }
      this.resetVoteData();
    } catch (error) {
      this.logger.error('Failed to cleanup TelegramService', error);
    }
  }

  private async checkDatabaseConnection(): Promise<boolean> {
    try {
      await this.databaseService.getUserStats(1);
      return true;
    } catch (error) {
      this.logger.error('Database connection check failed', error);
      return false;
    }
  }

  async onModuleInit() {
    if (!(await this.checkDatabaseConnection())) {
      this.logger.error('Failed to connect to database on startup');
    }
  }
}
