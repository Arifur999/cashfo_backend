import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AdminRole } from '../common/roles.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { screenshotMulterOptions } from '../support/screenshot-upload.js';
import { AddMessageDto } from './dto/add-message.dto.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto.js';
import { CreateSavedReplyDto, UpdateSavedReplyDto } from './dto/saved-reply.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';
import { SavedRepliesService } from './saved-replies.service.js';
import { TicketsService } from './tickets.service.js';

// Tickets are SUPPORT_ADMIN's primary job -- along with SUPER_ADMIN they get
// full read+write access; everyone else authenticated can still view.
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly savedRepliesService: SavedRepliesService,
  ) {}

  @Get('stats')
  stats() {
    return this.ticketsService.stats();
  }

  @Get()
  list(@Query() query: ListTicketsQueryDto) {
    return this.ticketsService.list(query);
  }

  // Saved replies: static paths, so they sit before the :id routes.
  @Get('saved-replies')
  listSavedReplies() {
    return this.savedRepliesService.list();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Post('saved-replies')
  createSavedReply(@Body() dto: CreateSavedReplyDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.savedRepliesService.create(dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch('saved-replies/:replyId')
  updateSavedReply(
    @Param('replyId', ParseUUIDPipe) replyId: string,
    @Body() dto: UpdateSavedReplyDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
  ) {
    return this.savedRepliesService.update(replyId, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Delete('saved-replies/:replyId')
  deleteSavedReply(@Param('replyId', ParseUUIDPipe) replyId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.savedRepliesService.remove(replyId, admin.id, req.ip);
  }

  // A customer's screenshot. Never cached: it may show their money.
  @Get('attachments/:attachmentId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async attachment(@Param('attachmentId', ParseUUIDPipe) attachmentId: string) {
    const file = await this.ticketsService.attachment(attachmentId);
    return new StreamableFile(file.data, { type: file.mimeType, disposition: 'inline' });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.ticketsService.getById(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Post()
  create(@Body() dto: CreateTicketDto) {
    return this.ticketsService.create(dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.ticketsService.update(id, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Post(':id/messages')
  // JSON, or multipart with one picture in `file` (the same rules as a
  // customer's screenshot: JPEG, PNG or WEBP, 5 MB at most).
  @UseInterceptors(FileInterceptor('file', screenshotMulterOptions))
  addMessage(
    @Param('id') id: string,
    @Body() dto: AddMessageDto,
    @CurrentAdmin() admin: RequestAdminUser,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.ticketsService.addMessage(id, dto, admin.id, req.ip, file);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.ticketsService.assign(id, dto);
  }
}
