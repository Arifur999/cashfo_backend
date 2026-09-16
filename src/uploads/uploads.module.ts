import { Module } from '@nestjs/common';
import { ImgbbService } from './imgbb.service.js';

// Shared/cross-cutting, same shape as PrismaModule -- any feature module
// that needs to turn an uploaded file into a permanent URL imports this
// rather than duplicating imgbb-calling logic.
@Module({
  providers: [ImgbbService],
  exports: [ImgbbService],
})
export class UploadsModule {}
