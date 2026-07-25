import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

@Public()
@Controller('system')
export class HealthController {
  @Get('health')
  health(): {
    status: 'ok';
    service: string;
    version: string;
    timestamp: string;
  } {
    return {
      status: 'ok',
      service: 'life-home-api',
      version: '0.14.0',
      timestamp: new Date().toISOString(),
    };
  }
}
