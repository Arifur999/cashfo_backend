import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BUILT_IN_TEMPLATE_KEYS } from '../database/seed/content.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { recipientVariables, renderTemplate } from './campaign-content.js';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto.js';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto.js';

@Injectable()
export class NotificationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // "Send a test to me": the template filled in for the admin asking, in
  // the language picked, emailed to them whatever its channel (an admin
  // has no app bell or phone to push to), so they read it as it goes out.
  async sendTest(id: string, adminId: string, language: 'EN' | 'BN' = 'EN') {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Notification template not found');
    }
    if (!this.mail.configured) {
      throw new ServiceUnavailableException("Email sending is not set up, so a test can't be sent");
    }
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { name: true, email: true } });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    const appName = await this.mail.platformName();
    const { subject, body } = renderTemplate(template, language, recipientVariables({ ...admin, planName: 'Monthly Pro' }, appName));
    const link = this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000';
    const failed = await this.mail.sendCampaignBatch([
      { to: admin.email, locale: language === 'BN' ? 'bn' : 'en', email: { subject: `[Test] ${subject ?? template.key}`, body, link } },
    ]);
    if (failed.size > 0) {
      throw new ServiceUnavailableException(failed.get(0) ?? 'The test email could not be sent');
    }
    return { sentTo: admin.email };
  }

  list() {
    return this.prisma.notificationTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  // A template made in the admin panel (one for a campaign, say). Keys are
  // unique: the code and campaigns find a template by its key.
  async create(dto: CreateNotificationTemplateDto, adminId: string, ipAddress?: string) {
    const taken = await this.prisma.notificationTemplate.findUnique({ where: { key: dto.key }, select: { id: true } });
    if (taken) {
      throw new ConflictException('A template with this key already exists');
    }

    const result = await this.prisma.notificationTemplate.create({
      data: {
        key: dto.key,
        channel: dto.channel,
        subjectEn: dto.subjectEn?.trim() || null,
        subjectBn: dto.subjectBn?.trim() || null,
        bodyEn: dto.bodyEn,
        bodyBn: dto.bodyBn,
        variables: dto.variables ?? [],
        isActive: dto.isActive ?? true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'NOTIFICATION_TEMPLATE_CREATED',
        entityType: 'NotificationTemplate',
        entityId: result.id,
        newValue: { key: result.key, channel: result.channel, isActive: result.isActive },
        ipAddress,
      },
    });

    return result;
  }

  // Only one made in the panel, and only when no campaign still to send
  // uses it. A built-in one comes back on the next deploy, so it is turned
  // off instead.
  async remove(id: string, adminId: string, ipAddress?: string) {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Notification template not found');
    }
    if (BUILT_IN_TEMPLATE_KEYS.includes(existing.key)) {
      throw new BadRequestException("A built-in template can't be deleted. Turn it off instead.");
    }
    const waiting = await this.prisma.bulkNotificationCampaign.count({ where: { templateKey: existing.key, status: { in: ['DRAFT', 'SCHEDULED', 'SENDING'] } } });
    if (waiting > 0) {
      throw new ConflictException("A campaign that hasn't been sent yet uses this template");
    }
    await this.prisma.notificationTemplate.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { adminUserId: adminId, action: 'NOTIFICATION_TEMPLATE_DELETED', entityType: 'NotificationTemplate', entityId: id, oldValue: { key: existing.key, channel: existing.channel }, ipAddress },
    });
    return { id };
  }

  async update(id: string, dto: UpdateNotificationTemplateDto, adminId: string, ipAddress?: string) {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Notification template not found');
    }

    const result = await this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(dto.subjectEn !== undefined && { subjectEn: dto.subjectEn }),
        ...(dto.subjectBn !== undefined && { subjectBn: dto.subjectBn }),
        ...(dto.bodyEn !== undefined && { bodyEn: dto.bodyEn }),
        ...(dto.bodyBn !== undefined && { bodyBn: dto.bodyBn }),
        ...(dto.variables !== undefined && { variables: dto.variables }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'NOTIFICATION_TEMPLATE_UPDATED',
        entityType: 'NotificationTemplate',
        entityId: id,
        oldValue: { subjectEn: existing.subjectEn, bodyEn: existing.bodyEn, isActive: existing.isActive },
        newValue: { subjectEn: result.subjectEn, bodyEn: result.bodyEn, isActive: result.isActive },
        ipAddress,
      },
    });

    return result;
  }
}
