import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { RequireBusinessMembership } from '../business-access/decorators/require-business-membership.decorator.js';
import { RequireRole } from '../business-access/decorators/require-role.decorator.js';
import { CreateEventDto, CreateGiftDto, UpdateEventDto, UpdateGiftDto, UpdatePersonDto } from './dto/events.dto.js';
import { EventsService } from './events.service.js';

// Calendar & Events for a workspace: its owner and accountant read and
// change its events, people and gifts.
@RequireBusinessMembership()
@RequireRole(MemberRole.OWNER, MemberRole.ACCOUNTANT)
@Controller('api/businesses/:businessId/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  overview(@Param('businessId') businessId: string) {
    return this.events.overview(businessId);
  }

  @Post()
  create(@Param('businessId') businessId: string, @Body() dto: CreateEventDto) {
    return this.events.createEvent(businessId, dto);
  }

  @Patch('people/:personId')
  updatePerson(@Param('businessId') businessId: string, @Param('personId') personId: string, @Body() dto: UpdatePersonDto) {
    return this.events.updatePerson(businessId, personId, dto);
  }

  @Patch('gifts/:giftId')
  updateGift(@Param('businessId') businessId: string, @Param('giftId') giftId: string, @Body() dto: UpdateGiftDto) {
    return this.events.updateGift(businessId, giftId, dto);
  }

  @Delete('gifts/:giftId')
  deleteGift(@Param('businessId') businessId: string, @Param('giftId') giftId: string) {
    return this.events.deleteGift(businessId, giftId);
  }

  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.updateEvent(businessId, id, dto);
  }

  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.events.deleteEvent(businessId, id);
  }

  @Post(':id/gifts')
  addGift(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: CreateGiftDto) {
    return this.events.addGift(businessId, id, dto);
  }
}
