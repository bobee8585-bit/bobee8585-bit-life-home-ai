import { Controller, Get } from '@nestjs/common';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Permissions('ADMIN.DASHBOARD.READ')
  @MenuAccess('ADMIN_DASHBOARD', 'read')
  @Get('summary')
  summary() {
    return this.dashboard.summary();
  }
}
