import { Module } from '@nestjs/common';
import { OrganizationAdminGuard } from '../auth/organization-admin.guard';
import { RetentionModule } from '../retention/retention.module';
import { OrganizationsController } from './organizations.controller';

@Module({
  imports: [RetentionModule],
  controllers: [OrganizationsController],
  providers: [OrganizationAdminGuard],
})
export class OrganizationsModule {}
