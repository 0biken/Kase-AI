import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryController } from './inventory.controller';
import { InventoryQueryService } from './inventory-query.service';

@Module({ imports: [PrismaModule], controllers: [InventoryController], providers: [InventoryQueryService] })
export class ReconModule {}
