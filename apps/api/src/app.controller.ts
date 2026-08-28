import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Unauthenticated on purpose: a liveness probe that itself requires a
  // credential is not useful to whatever is checking liveness.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
