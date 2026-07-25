import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigController } from './app-config/app-config.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { FeaturePolicyService } from './feature-policy/feature-policy.service';
import { MenuAccessGuard } from './feature-policy/menu-access.guard';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './system/health.controller';
import { BrokersModule } from './brokers/brokers.module';
import { PropertiesModule } from './properties/properties.module';
import { CurrencyModule } from './currency/currency.module';
import { ReservationsModule } from './reservations/reservations.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    BrokersModule,
    CurrencyModule,
    PropertiesModule,
    ReservationsModule,
    NotificationsModule,
  ],
  controllers: [AppConfigController, HealthController],
  providers: [
    FeaturePolicyService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MenuAccessGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
