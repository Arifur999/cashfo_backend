import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { LegalDocumentsController } from './legal-documents.controller.js';
import { LegalDocumentsService } from './legal-documents.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [LegalDocumentsController],
  providers: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
