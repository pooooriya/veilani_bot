export const CommandsConfig = {
  PUBLIC_COMMANDS: [
    { command: 'server', description: 'دریافت اطلاعات اتصال به سرور' },
    { command: 'stats', description: 'مشاهده آمار شخصی' },
    { command: 'top', description: 'مشاهده برترین بازیکنان' },
    { command: 'game_stats', description: 'آمار کلی بازی‌ها' },
    { command: 'help', description: 'راهنمای دستورات' },
  ],
  ADMIN_COMMANDS: [
    { command: 'admin', description: 'پنل مدیریت' },
    { command: 'new_vote', description: 'ایجاد نظرسنجی جدید' },
    { command: 'clear_messages', description: 'پاکسازی پیام‌های بات' },
  ],
};
