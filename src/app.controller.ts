import { Controller, Get, Redirect } from '@nestjs/common';

@Controller()
export class AppController {
  constructor() {}

  @Get()
  @Redirect()
  launchSteamGame() {
    // Steam deep link URL for CS:GO with connect parameters
    const steamDeepLink =
      'steam://run/730//+connect%205.57.32.32:28441/veilani';

    return {
      url: steamDeepLink,
      statusCode: 302,
    };
  }
}
