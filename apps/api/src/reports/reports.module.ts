import { Module } from '@nestjs/common';
import { CsvExportService } from './csv-export.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ controllers: [ReportsController], providers: [ReportsService, CsvExportService] })
export class ReportsModule {}
