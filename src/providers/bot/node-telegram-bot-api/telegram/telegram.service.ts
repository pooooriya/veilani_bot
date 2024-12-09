import { Injectable, Logger } from '@nestjs/common';
import { ITelegramService } from './types/telegram.interface';
import * as TelegramBot from 'node-telegram-bot-api';
import { ConfigService } from '@nestjs/config';
import { VoteConfig } from '../config/vote.config';
import { VoteMessages } from '../config/messages.config';
import { DatabaseService } from 'src/database/database.service';
import { AdminConfig } from '../config/admin.config';
import { CommandsConfig } from '../config/commands.config';

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
  private messageIds: number[] = [];
  private botMessages: Set<number> = new Set();

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
    this.bot.onText(
      new RegExp(AdminConfig.COMMANDS.CLEAR_MESSAGES),
      this.handleClearMessages,
    );
    this.bot.onText(
      new RegExp(AdminConfig.COMMANDS.ADMIN_PANEL),
      this.handleAdminPanel,
    );
    this.bot.onText(
      new RegExp(AdminConfig.COMMANDS.NEW_VOTE),
      this.handleNewVote,
    );
    this.bot.on('callback_query', this.handleCallbackQuery);
    this.bot.onText(/\/help/, this.handleHelp);
    this.bot.onText(/\/start/, this.handleStart);

    // تنظیم کامندها برای BotFather
    this.setupBotCommands();
  }

  private async setupBotCommands() {
    try {
      // تنظیم کامندهای عمومی برای همه گروه‌ها
      await this.bot.setMyCommands(CommandsConfig.PUBLIC_COMMANDS);

      // تنظیم کامندهای ادمین فقط برای ادمین
      const adminCommands = [
        ...CommandsConfig.PUBLIC_COMMANDS,
        ...CommandsConfig.ADMIN_COMMANDS,
      ];
      await this.bot.setMyCommands(adminCommands, {
        scope: {
          type: 'chat',
          chat_id: AdminConfig.ADMIN_ID,
        },
      });
    } catch (error) {
      this.logger.error('Failed to setup bot commands', error);
    }
  }

  private handleHelp = async (msg: TelegramBot.Message) => {
    try {
      let helpText = '🤖 راهنمای دستورات بات:\n\n';

      // دستورات عمومی
      helpText += '📌 دستورات عمومی:\n';
      CommandsConfig.PUBLIC_COMMANDS.forEach((cmd) => {
        helpText += `/${cmd.command} - ${cmd.description}\n`;
      });

      // اگر پیام از ادمین است، دستورات ادمین را هم نمایش بده
      if (msg.from.id === AdminConfig.ADMIN_ID) {
        helpText += '\n👑 دستورات ادمین:\n';
        CommandsConfig.ADMIN_COMMANDS.forEach((cmd) => {
          helpText += `/${cmd.command} - ${cmd.description}\n`;
        });
      }

      await this.bot.sendMessage(msg.chat.id, helpText);
    } catch (error) {
      this.logger.error('Failed to send help message', error);
    }
  };

  private handleStart = async (msg: TelegramBot.Message) => {
    try {
      const welcomeText =
        '👋 سلام! من بات ویلانی هستم\n\n' +
        'من به شما کمک می‌کنم تا راحت‌تر برای بازی برنامه‌ریزی کنید.\n\n' +
        'برای دیدن لیست دستورات، از /help استفاده کنید.';

      await this.bot.sendMessage(msg.chat.id, welcomeText);
    } catch (error) {
      this.logger.error('Failed to send welcome message', error);
    }
  };

  private handleMessage = async (msg: TelegramBot.Message) => {
    if (
      msg.chat.id.toString() === this.configService.get<string>('GROUP_CHAT_ID')
    ) {
      if (!msg.from.is_bot) {
        this.messagesSinceLastPoll++;

        // هر 20 پیام، نظرسنجی رو دوباره ارسال می‌کنیم
        if (this.messagesSinceLastPoll >= 20 && this.currentPollId) {
          this.messagesSinceLastPoll = 0;
          await this.resendPoll();
        }
      }
    }
  };

  private async resendPoll() {
    try {
      const chatId = this.configService.get<string>('GROUP_CHAT_ID');
      const reminderMsg = await this.bot.sendMessage(
        chatId,
        '📊 یادآوری نظرسنجی امشب:\n' +
          `ت��د رای فعلی: ${this.votedUsers.size} نفر\n` +
          `حد نصاب مورد نیاز: ${this.threshold} نفر`,
      );
      await this.saveBotMessage(reminderMsg);

      // فوروارد کردن نظرسنجی اصلی
      const forwardedMsg = await this.bot.forwardMessage(
        chatId,
        chatId,
        this.currentPollId,
      );
      await this.saveBotMessage(forwardedMsg);
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
          'شما هنوز در هیچ نظرسنجی شرکت نکرده‌اد!',
        );
      }
    } catch (error) {
      this.logger.error('Failed to get user stats', error);
    }
  };

  private handleTopPlayersCommand = async (msg: TelegramBot.Message) => {
    try {
      const topPlayers = await this.databaseService.getTopPlayers();
      let message = '🏆 بررین بازیکنان ویلانی:\n\n';

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
      const chatId = this.configService.get<string>('GROUP_CHAT_ID');
      const wasVoted = this.votedUsers.has(userId);
      const wasPending = this.needsFollowUpUsers.has(userId);

      if (pollAnswer.option_ids.length === 0) {
        // برداشتن رای
        if (wasVoted) {
          this.votedUsers.delete(userId);
          this.needsFollowUpUsers.delete(userId);
          this.retractedUsers.add(userId);
          this.userVotes.delete(userId);

          // فقط پیام خنثی برای برداشتن رای
          const message = this.getRandomMessage(VoteMessages.voteRetracted);
          const sentMessage = await this.bot.sendMessage(
            chatId,
            this.formatMessage(message, this.getMention(pollAnswer.user)),
            { parse_mode: 'Markdown' },
          );
          this.messageIds.push(sentMessage.message_id);

          await this.databaseService.updateUserStats(
            {
              id: userId,
              username: pollAnswer.user.username,
              first_name: pollAnswer.user.first_name,
            },
            false,
          );
        }
      } else {
        const selectedOption = pollAnswer.option_ids[0];

        if (!wasVoted) {
          this.votedUsers.add(userId);

          if (selectedOption === 3) {
            // حالت "بعداً اطلاع میدم"
            this.needsFollowUpUsers.add(userId);
            const message = this.getRandomMessage(VoteMessages.pendingDecision);
            const sentMessage = await this.bot.sendMessage(
              chatId,
              this.formatMessage(message, this.getMention(pollAnswer.user)),
              { parse_mode: 'Markdown' },
            );
            this.messageIds.push(sentMessage.message_id);
          } else if (selectedOption === 4) {
            // حالت "نمیتونم بیام"
            const message = this.getRandomMessage(VoteMessages.voteRemoved);
            const sentMessage = await this.bot.sendMessage(
              chatId,
              this.formatMessage(message, this.getMention(pollAnswer.user)),
              { parse_mode: 'Markdown' },
            );
            this.messageIds.push(sentMessage.message_id);
          } else {
            // رای به یکی از ساعت‌ها
            this.userVotes.set(userId, selectedOption);
            const message = this.getRandomMessage(VoteMessages.voteSubmitted);
            const sentMessage = await this.bot.sendMessage(
              chatId,
              this.formatMessage(message, this.getMention(pollAnswer.user)),
              { parse_mode: 'Markdown' },
            );
            this.messageIds.push(sentMessage.message_id);

            // آپدیت دیتابیس
            await this.databaseService.updateUserStats(
              {
                id: userId,
                username: pollAnswer.user.username,
                first_name: pollAnswer.user.first_name,
              },
              true,
            );

            // چک کردن حد نصاب
            const activeVoters = this.getActiveVotersCount();
            if (activeVoters >= this.threshold) {
              const gameTime = this.determineGameTime();
              const confirmMessage = await this.bot.sendMessage(
                chatId,
                this.formatMessage(VoteMessages.gameConfirmed, gameTime),
                { parse_mode: 'Markdown' },
              );
              this.messageIds.push(confirmMessage.message_id);

              if (this.currentGameSession) {
                await this.databaseService.updateGameSession(
                  this.currentGameSession,
                  {
                    start_time: gameTime,
                    player_count: activeVoters,
                    status: 'confirmed',
                  },
                );
              }
            }
          }
        } else if (wasPending && selectedOption < 3) {
          // تغییر از حالت انتظار به رای مثبت
          this.needsFollowUpUsers.delete(userId);
          this.userVotes.set(userId, selectedOption);

          const message = this.getRandomMessage(VoteMessages.voteSubmitted);
          const sentMessage = await this.bot.sendMessage(
            chatId,
            this.formatMessage(message, this.getMention(pollAnswer.user)),
            { parse_mode: 'Markdown' },
          );
          this.messageIds.push(sentMessage.message_id);
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

    const messageText = this.formatMessage(
      VoteMessages.progressUpdate,
      this.votedUsers.size - this.needsFollowUpUsers.size,
      this.threshold,
      activeVoters,
    );

    const sentMessage = await this.bot.sendMessage(chatId, messageText, {
      parse_mode: 'Markdown',
    });
    await this.saveBotMessage(sentMessage);
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
      this.messagesSinceLastPoll = 0;

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
      await this.saveBotMessage(message);
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
          `😔 متاسفانه امشب به حد نصاب ${this.threshold} نفر نرسیدیم. فدا دوباره تلاش می‌کنیم!`,
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
      const message = await this.bot.sendMessage(
        chatId,
        `${followUpMentions} لطفاً اعلام کنید که آیا امشب در بازی شرکت می‌کنید یا خیر؟`,
        { parse_mode: 'Markdown' },
      );
      this.messageIds.push(message.message_id);
    }

    const activeVoters = this.getActiveVotersCount();
    if (activeVoters === 0) {
      const message = await this.bot.sendMessage(
        chatId,
        'هنوز کس�� برای بازی امشب اعلام آمادگی نکرده! لطفاً در نظرسنجی شرکت کنید.',
      );
      this.messageIds.push(message.message_id);
    }
  }

  async reminderCheck() {
    const chatId = this.configService.get<string>('GROUP_CHAT_ID');
    if (this.votedUsers.size < this.threshold) {
      const message = await this.bot.sendMessage(
        chatId,
        `هنوز به حد نصاب (${this.threshold} نفر) نرسیدیم! دوستان بجنبید تا بازی برگزار بشه.`,
      );
      await this.saveBotMessage(message);
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

  private getActiveVotersCount(): number {
    return Array.from(this.votedUsers).filter(
      (uid) => !this.needsFollowUpUsers.has(uid) && this.userVotes.get(uid) < 3,
    ).length;
  }

  private handleClearMessages = async (msg: TelegramBot.Message) => {
    try {
      if (msg.from.id !== AdminConfig.ADMIN_ID) return;

      const chatId = this.configService.get<string>('GROUP_CHAT_ID');
      let deletedCount = 0;

      this.logger.debug(
        `Attempting to delete ${this.botMessages.size} messages`,
      );

      // پاک کردن همه پیام‌های بات به جز نظرسنجی
      for (const messageId of this.botMessages) {
        try {
          if (messageId !== this.currentPollId) {
            await this.bot.deleteMessage(chatId, messageId);
            deletedCount++;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        } catch (error) {
          this.logger.debug(
            `Failed to delete message ${messageId}: ${error.message}`,
          );
          continue;
        }
      }

      // پاک کردن دستور
      try {
        await this.bot.deleteMessage(chatId, msg.message_id);
      } catch (error) {
        this.logger.debug(`Failed to delete command message: ${error.message}`);
      }

      // به روزرسانی لیست پیام‌ها
      if (this.currentPollId) {
        this.botMessages = new Set([this.currentPollId]);
      } else {
        this.botMessages.clear();
      }

      // ارسال پیام تایید
      if (deletedCount > 0) {
        const confirmMsg = await this.bot.sendMessage(
          chatId,
          `✅ ${deletedCount} پیام از بات پاک شد.`,
        );

        setTimeout(async () => {
          try {
            await this.bot.deleteMessage(chatId, confirmMsg.message_id);
          } catch (error) {
            this.logger.debug(
              `Failed to delete confirmation message: ${error.message}`,
            );
          }
        }, 3000);
      }
    } catch (error) {
      this.logger.error('Failed to clear messages:', error);
    }
  };

  private handleAdminPanel = async (msg: TelegramBot.Message) => {
    if (msg.from.id !== AdminConfig.ADMIN_ID) return;

    try {
      await this.bot.sendMessage(
        msg.chat.id,
        '🎮 پنل مدیریت بات ویلانی\n\nاز دکمه‌های زیر برای مدیریت و تست بات استفاده کنید:',
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: AdminConfig.BUTTONS.NEW_VOTE,
                  callback_data: 'new_vote',
                },
                {
                  text: AdminConfig.BUTTONS.RESET_DATA,
                  callback_data: 'reset_data',
                },
              ],
              [
                {
                  text: AdminConfig.BUTTONS.TEST_REMINDER,
                  callback_data: 'test_reminder',
                },
                {
                  text: AdminConfig.BUTTONS.TEST_FOLLOWUP,
                  callback_data: 'test_followup',
                },
              ],
              [
                {
                  text: AdminConfig.BUTTONS.TEST_FINAL,
                  callback_data: 'test_final',
                },
                {
                  text: AdminConfig.BUTTONS.GET_STATS,
                  callback_data: 'get_stats',
                },
              ],
              [
                {
                  text: AdminConfig.BUTTONS.SIMULATE_GAME,
                  callback_data: 'simulate_game',
                },
                {
                  text: AdminConfig.BUTTONS.TEST_ALL,
                  callback_data: 'test_all',
                },
              ],
              [
                {
                  text: AdminConfig.BUTTONS.CLEAR_MESSAGES,
                  callback_data: 'clear_messages',
                },
              ],
              [
                {
                  text: AdminConfig.BUTTONS.CLOSE_MENU,
                  callback_data: 'close_menu',
                },
              ],
            ],
          },
        },
      );
    } catch (error) {
      this.logger.error('Failed to send admin panel', error);
    }
  };

  private handleCallbackQuery = async (query: TelegramBot.CallbackQuery) => {
    if (query.from.id !== AdminConfig.ADMIN_ID) return;

    const chatId = query.message.chat.id;
    try {
      switch (query.data) {
        case 'new_vote':
          await this.resetVoteData();
          await this.sendVote();
          break;

        case 'reset_data':
          await this.resetVoteData();
          await this.bot.sendMessage(chatId, '✅ داده‌ها با موفقیت پاک شدند.');
          break;

        case 'test_reminder':
          await this.reminderCheck();
          break;

        case 'test_followup':
          await this.checkFollowUps();
          break;

        case 'test_final':
          await this.finalCheck();
          break;

        case 'get_stats':
          const stats = await this.databaseService.getGameStats();
          await this.bot.sendMessage(
            chatId,
            `📊 آمار کلی:\n\n` +
              `کل بازی‌ها: ${stats.totalGames}\n` +
              `بازی‌های موفق: ${stats.confirmedGames}\n` +
              `نرخ موفقیت: ${stats.successRate.toFixed(1)}%\n\n` +
              `تعداد رای امروز: ${this.votedUsers.size}\n` +
              `افراد منتظر: ${this.needsFollowUpUsers.size}\n` +
              `رای‌های مثبت: ${this.getActiveVotersCount()}`,
          );
          break;

        case 'simulate_game':
          await this.simulateGame(chatId.toString());
          break;

        case 'test_all':
          await this.runAllTests(chatId.toString());
          break;

        case 'close_menu':
          await this.bot.deleteMessage(chatId, query.message.message_id);
          break;

        case 'clear_messages':
          await this.handleClearMessages(query.message);
          await this.bot.answerCallbackQuery(query.id, {
            text: '✅ پیام‌ها پاک شدند',
            show_alert: true,
          });
          break;
      }

      // حذف loading از دکمه
      await this.bot.answerCallbackQuery(query.id);
    } catch (error) {
      this.logger.error('Failed to handle callback query', error);
      await this.bot.answerCallbackQuery(query.id, {
        text: '❌ خطا در انجام عملیات',
        show_alert: true,
      });
    }
  };

  private handleNewVote = async (msg: TelegramBot.Message) => {
    if (msg.from.id !== AdminConfig.ADMIN_ID) return;

    try {
      await this.resetVoteData();
      await this.sendVote();
      await this.bot.deleteMessage(msg.chat.id, msg.message_id);
    } catch (error) {
      this.logger.error('Failed to create new vote', error);
    }
  };

  private async saveBotMessage(message: TelegramBot.Message) {
    if (message && message.message_id) {
      this.botMessages.add(message.message_id);
      this.logger.debug(`Saved bot message: ${message.message_id}`);
    }
  }

  private async simulateGame(chatId: string) {
    try {
      await this.bot.sendMessage(chatId, '🎮 شروع شبیه‌سازی بازی...');

      // ایجاد نظرسنجی جدید
      await this.resetVoteData();
      const vote = await this.sendVote();
      await this.pinVote(vote.message_id);

      // شبیه‌سازی رای‌ها
      const simulatedVotes = [
        { option: 0, count: 4 }, // 22:00
        { option: 1, count: 3 }, // 22:30
        { option: 2, count: 2 }, // 23:00
        { option: 3, count: 2 }, // بعداً اطلاع میدم
        { option: 4, count: 1 }, // نمیتونم بیام
      ];

      for (const vote of simulatedVotes) {
        for (let i = 0; i < vote.count; i++) {
          await this.simulateVote(vote.option);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // شبیه‌سازی برداشتن رای
      await this.simulateVoteRetraction();

      // شبیه‌سازی تغییر رای از "بعداً اطلاع میدم" به یک ساعت
      await this.simulateFollowUpDecision();

      await this.bot.sendMessage(chatId, '✅ شبیه‌سازی با موفقیت انجام شد.');
    } catch (error) {
      this.logger.error('Failed to simulate game', error);
    }
  }

  private async runAllTests(chatId: string) {
    try {
      await this.bot.sendMessage(chatId, '🔄 شروع تست تمام قابلیت‌ها...');

      const tests = [
        { name: 'ایجاد نظرسنجی', fn: async () => await this.sendVote() },
        {
          name: 'پین کردن نظرسنجی',
          fn: async () => await this.pinVote(this.currentPollId),
        },
        { name: 'رای دادن', fn: async () => await this.simulateVote(0) },
        {
          name: 'برداشتن رای',
          fn: async () => await this.simulateVoteRetraction(),
        },
        { name: 'یادآوری', fn: async () => await this.reminderCheck() },
        { name: 'پیگیری', fn: async () => await this.checkFollowUps() },
        { name: 'بررسی نهایی', fn: async () => await this.finalCheck() },
        {
          name: 'آمار',
          fn: async () => await this.databaseService.getGameStats(),
        },
        {
          name: 'پاکسازی پیام‌ها',
          fn: async () =>
            await this.handleClearMessages({
              from: { id: AdminConfig.ADMIN_ID },
            } as TelegramBot.Message),
        },
      ];

      for (const test of tests) {
        try {
          await test.fn();
          await this.bot.sendMessage(chatId, `✅ تست ${test.name} موفق`);
        } catch (error) {
          await this.bot.sendMessage(
            chatId,
            `❌ تست ${test.name} ناموفق: ${error.message}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await this.bot.sendMessage(chatId, '🏁 تست‌ها به پایان رسید.');
    } catch (error) {
      this.logger.error('Failed to run all tests', error);
    }
  }

  private async simulateVote(option: number) {
    const fakeUser: TelegramBot.User = {
      id: Math.floor(Math.random() * 1000000),
      first_name: `Test User ${Math.floor(Math.random() * 100)}`,
      is_bot: false,
    };

    await this.handlePollAnswer({
      user: fakeUser,
      option_ids: [option],
      poll_id: 'test',
    } as TelegramBot.PollAnswer);
  }

  private async simulateVoteRetraction() {
    if (this.votedUsers.size > 0) {
      const userId = Array.from(this.votedUsers)[0];
      await this.handlePollAnswer({
        user: { id: userId, first_name: 'Test User', is_bot: false },
        option_ids: [],
        poll_id: 'test',
      } as TelegramBot.PollAnswer);
    }
  }

  private async simulateFollowUpDecision() {
    if (this.needsFollowUpUsers.size > 0) {
      const userId = Array.from(this.needsFollowUpUsers)[0];
      await this.handlePollAnswer({
        user: { id: userId, first_name: 'Test User', is_bot: false },
        option_ids: [0], // تغییر به ساعت 22:00
        poll_id: 'test',
      } as TelegramBot.PollAnswer);
    }
  }
}
