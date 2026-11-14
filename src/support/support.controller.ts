import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateIdeaDto } from './dto/create-idea.dto.js';
import { CreateSupportMessageDto, ReplySupportMessageDto } from './dto/support-message.dto.js';
import { screenshotMulterOptions } from './screenshot-upload.js';
import { SupportService } from './support.service.js';

// Writing to the support team or adding an idea: a handful a minute is
// plenty for a person.
const WRITE_THROTTLE = { default: { limit: 5, ttl: 60 * 1000 } };

// Settings > Help in the customer app.
@UseGuards(UserAuthGuard)
@Controller('api/support')
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Get('messages')
  listMessages(@CurrentUser() user: RequestUser) {
    return this.service.listMessages(user.id);
  }

  @Throttle(WRITE_THROTTLE)
  @Post('messages')
  @UseInterceptors(FileInterceptor('screenshot', screenshotMulterOptions))
  createMessage(@CurrentUser() user: RequestUser, @Body() dto: CreateSupportMessageDto, @UploadedFile() screenshot?: Express.Multer.File) {
    return this.service.createMessage(user.id, dto, screenshot);
  }

  @Throttle(WRITE_THROTTLE)
  @Post('messages/:id/replies')
  reply(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplySupportMessageDto) {
    return this.service.reply(user.id, id, dto);
  }

  @Throttle(WRITE_THROTTLE)
  @Post('messages/:id/solve')
  solve(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.solve(user.id, id);
  }

  // Never cached by the browser: it may show the customer's money.
  @Get('attachments/:id')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async attachment(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    const file = await this.service.attachment(user.id, id);
    return new StreamableFile(file.data, { type: file.mimeType, disposition: 'inline' });
  }

  @Get('ideas')
  listIdeas(@CurrentUser() user: RequestUser) {
    return this.service.listIdeas(user.id);
  }

  @Throttle(WRITE_THROTTLE)
  @Post('ideas')
  createIdea(@CurrentUser() user: RequestUser, @Body() dto: CreateIdeaDto) {
    return this.service.createIdea(user.id, dto);
  }

  @Post('ideas/:id/vote')
  vote(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.vote(user.id, id, true);
  }

  @Delete('ideas/:id/vote')
  unvote(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.vote(user.id, id, false);
  }
}
