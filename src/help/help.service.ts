import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type HelpVideo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { HelpVideoDto, OrderHelpVideosDto, UpdateHelpCompanyDto, UpdateHelpVideoDto } from './dto/help.dto.js';
import { companyOf, HELP_COMPANY_KEY, youtubeIdOf, type HelpCompany } from './help-rules.js';

const videoView = (video: HelpVideo) => ({
  id: video.id,
  titleEn: video.titleEn,
  titleBn: video.titleBn,
  category: video.category,
  minutes: video.minutes,
  youtubeId: video.youtubeId,
  shown: video.shown,
  position: video.position,
});

// Settings › Help & support's company card and video guides, kept by the
// super admin in Admin › Settings. Every change is in the audit log.
@Injectable()
export class HelpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // What the Help page shows: the company (the platform's name and support
  // email when the card leaves them empty) and the shown videos in order.
  async forUsers() {
    const [company, videos] = await Promise.all([
      this.company(),
      this.prisma.helpVideo.findMany({ where: { shown: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return { company, videos: videos.map(videoView) };
  }

  async forAdmin() {
    const [company, videos] = await Promise.all([this.company(), this.prisma.helpVideo.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })]);
    return { company, videos: videos.map(videoView) };
  }

  async updateCompany(dto: UpdateHelpCompanyDto, adminId: string, ipAddress?: string) {
    const before = await this.company(false);
    const after: HelpCompany = companyOf({ ...before, ...dto });
    await this.prisma.$transaction([
      this.prisma.platformSetting.upsert({
        where: { key: HELP_COMPANY_KEY },
        update: { value: after as unknown as Prisma.InputJsonObject, updatedBy: adminId },
        create: { key: HELP_COMPANY_KEY, value: after as unknown as Prisma.InputJsonObject, updatedBy: adminId },
      }),
      this.prisma.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'HELP_COMPANY_UPDATED',
          entityType: 'PlatformSetting',
          entityId: HELP_COMPANY_KEY,
          oldValue: before as unknown as Prisma.InputJsonObject,
          newValue: after as unknown as Prisma.InputJsonObject,
          ipAddress,
        },
      }),
    ]);
    return this.forAdmin();
  }

  async addVideo(dto: HelpVideoDto, adminId: string, ipAddress?: string) {
    const youtubeId = this.idOf(dto.youtube);
    const last = await this.prisma.helpVideo.aggregate({ _max: { position: true } });
    const video = await this.prisma.$transaction(async (tx) => {
      const made = await tx.helpVideo.create({
        data: {
          titleEn: dto.titleEn,
          titleBn: dto.titleBn || null,
          category: dto.category,
          minutes: dto.minutes,
          youtubeId,
          shown: dto.shown ?? true,
          position: (last._max.position ?? -1) + 1,
        },
      });
      await tx.auditLog.create({
        data: { adminUserId: adminId, action: 'HELP_VIDEO_ADDED', entityType: 'HelpVideo', entityId: made.id, newValue: videoView(made), ipAddress },
      });
      return made;
    });
    return videoView(video);
  }

  async updateVideo(id: string, dto: UpdateHelpVideoDto, adminId: string, ipAddress?: string) {
    const before = await this.prisma.helpVideo.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Video guide not found');
    const data: Prisma.HelpVideoUpdateInput = {
      ...(dto.titleEn !== undefined && { titleEn: dto.titleEn }),
      ...(dto.titleBn !== undefined && { titleBn: dto.titleBn || null }),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.minutes !== undefined && { minutes: dto.minutes }),
      ...(dto.youtube !== undefined && { youtubeId: this.idOf(dto.youtube) }),
      ...(dto.shown !== undefined && { shown: dto.shown }),
    };
    const video = await this.prisma.$transaction(async (tx) => {
      const after = await tx.helpVideo.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'HELP_VIDEO_UPDATED',
          entityType: 'HelpVideo',
          entityId: id,
          oldValue: videoView(before),
          newValue: videoView(after),
          ipAddress,
        },
      });
      return after;
    });
    return videoView(video);
  }

  async deleteVideo(id: string, adminId: string, ipAddress?: string) {
    const before = await this.prisma.helpVideo.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Video guide not found');
    await this.prisma.$transaction([
      this.prisma.helpVideo.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: { adminUserId: adminId, action: 'HELP_VIDEO_DELETED', entityType: 'HelpVideo', entityId: id, oldValue: videoView(before), ipAddress },
      }),
    ]);
    // Enough to put it back (the admin page's Undo).
    return videoView(before);
  }

  // The order the admin set; every video must be named once.
  async orderVideos(dto: OrderHelpVideosDto, adminId: string, ipAddress?: string) {
    const all = await this.prisma.helpVideo.findMany({ select: { id: true } });
    const ids = new Set(all.map((video) => video.id));
    if (dto.ids.length !== ids.size || new Set(dto.ids).size !== ids.size || dto.ids.some((id) => !ids.has(id)))
      throw new BadRequestException('Send every video guide once, in the new order.');
    await this.prisma.$transaction([
      ...dto.ids.map((id, position) => this.prisma.helpVideo.update({ where: { id }, data: { position } })),
      this.prisma.auditLog.create({ data: { adminUserId: adminId, action: 'HELP_VIDEOS_ORDERED', entityType: 'HelpVideo', newValue: dto.ids, ipAddress } }),
    ]);
    return this.forAdmin();
  }

  private idOf(link: string): string {
    const id = youtubeIdOf(link);
    if (!id) throw new BadRequestException('Use a YouTube link: youtube.com/watch, youtu.be, shorts or embed.');
    return id;
  }

  // The stored card; for users, the platform's name and support email fill
  // what it leaves empty.
  private async company(withFallbacks = true): Promise<HelpCompany> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: HELP_COMPANY_KEY } });
    const company = companyOf(row?.value);
    if (!withFallbacks) return company;
    const platform = await this.settings.getCached();
    return { ...company, name: company.name || platform.platformName, email: company.email || platform.supportEmail };
  }
}
