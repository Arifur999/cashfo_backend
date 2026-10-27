import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminRole, END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';

type NoteRow = { id: string; body: string; createdAt: Date; authorId: string; author: { id: string; name: string } };

const view = (note: NoteRow, admin: { id: string; role: AdminRole }) => ({
  id: note.id,
  body: note.body,
  createdAt: note.createdAt,
  author: { id: note.author.id, name: note.author.name },
  // The author, or a super admin, may remove it.
  canDelete: note.authorId === admin.id || admin.role === AdminRole.SUPER_ADMIN,
});

// "Notes for admins" on a customer's page. The customer never sees them.
// Any admin reads; support and super admins write; a note is removed by
// its author or a super admin (soft: the audit trail keeps what it said).
@Injectable()
export class AdminNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, admin: { id: string; role: AdminRole }) {
    await this.requireOwner(userId);
    const notes = await this.prisma.adminNote.findMany({
      where: { subjectUserId: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true } } },
    });
    return notes.map((note) => view(note, admin));
  }

  async add(userId: string, body: string, admin: { id: string; role: AdminRole }, ipAddress?: string) {
    await this.requireOwner(userId);
    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.adminNote.create({
        data: { subjectUserId: userId, authorId: admin.id, body },
        include: { author: { select: { id: true, name: true } } },
      });
      await tx.auditLog.create({
        data: { adminUserId: admin.id, action: 'OWNER_NOTE_ADDED', entityType: 'User', entityId: userId, newValue: { noteId: created.id, body }, ipAddress },
      });
      return created;
    });
    return view(note, admin);
  }

  async remove(userId: string, noteId: string, admin: { id: string; role: AdminRole }, ipAddress?: string) {
    const note = await this.prisma.adminNote.findFirst({ where: { id: noteId, subjectUserId: userId, deletedAt: null } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.authorId !== admin.id && admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only the admin who wrote a note, or a super admin, can remove it.');
    }
    await this.prisma.$transaction([
      this.prisma.adminNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { adminUserId: admin.id, action: 'OWNER_NOTE_DELETED', entityType: 'User', entityId: userId, oldValue: { noteId, body: note.body }, ipAddress },
      }),
    ]);
    return { success: true };
  }

  private async requireOwner(userId: string) {
    const owner = await this.prisma.user.findUnique({ where: { id: userId, ...END_USER_WHERE }, select: { id: true } });
    if (!owner) throw new NotFoundException('Owner not found');
  }
}
