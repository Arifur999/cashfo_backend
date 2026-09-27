import { Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { BooksController } from './books.controller.js';
import { BooksService } from './books.service.js';

@Module({
  imports: [UserAuthModule],
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
