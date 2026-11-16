import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MemberRole, Prisma, type GroupAccessLinkKind, type GroupMember, type GroupMemberRole } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { keyFromEnv, openSecret, sealSecret } from '../common/secret-box.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { areSignupsOpen, SIGNUPS_CLOSED_MESSAGE } from '../settings/signups.js';
import { canonicalPhone } from '../user-auth/phone.service.js';
import { UserAuthService } from '../user-auth/user-auth.service.js';
import { initialsOf } from '../group-expenses/group-names.js';

// A link works once, for a week.
export const LINK_DAYS = 7;
// 4 to 20 small letters, digits, dot or underscore ("rakib.m").
export const USERNAME = /^[a-z0-9._]{4,20}$/;
// Portal logins get an address in RFC 2606's .invalid domain: unique, and
// never delivered to (MailService leaves it out).
export const PORTAL_EMAIL_DOMAIN = 'group-member.invalid';

const GONE = 'This link no longer works. Ask your group admin for a new one.';
type Db = PrismaService | Prisma.TransactionClient;

// What the owner sees about one member's access on the Members page.
export interface MemberAccess {
  login: { username: string | null; lastLoginAt: Date | null; ownAccount: boolean } | null;
  link: { kind: GroupAccessLinkKind; createdAt: Date; expiresAt: Date; canCopy: boolean } | null;
}

// The role a member's access gives on the group's BusinessMember: Viewer
// STAFF, Editor ACCOUNTANT; none for a normal member.
export const memberRoleFor = (role: GroupMemberRole): MemberRole | null =>
  role === 'ACCOUNTANT' ? MemberRole.ACCOUNTANT : role === 'VIEWER' ? MemberRole.STAFF : null;
const givesAccess = (member: Pick<GroupMember, 'role' | 'status' | 'isOwner'>) =>
  member.status === 'ACTIVE' && !member.isOwner && memberRoleFor(member.role) !== null;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Group Expense's member portal: access links (made by the group's owner,
// sent by SMS or WhatsApp), the login a member makes with one, and keeping
// each member's BusinessMember in step with the role the owner gives them.
//
// Design (see also BusinessMembershipGuard and UserAuthGuard):
// - A JOIN link makes a member-portal login: a real customer User with a
//   unique username, portalOnly (it opens only its groups) and a
//   placeholder email; or, opened by someone already signed in, adds the
//   group to that account. Either way the member's record points at the
//   account (GroupMember.userId) and the account becomes a BusinessMember of
//   the group: STAFF for a Viewer, ACCOUNTANT for an Editor.
// - A RESET link sets a new password on a portal login. The owner may send
//   one only while every group that login opens is theirs, so no owner can
//   take over a login another owner's group relies on, and never for a
//   person's own Smartly account (that has its own reset).
// - Links are random 32-byte tokens, looked up by their SHA-256, used once
//   (claimed by deleting the row in the same transaction), and gone after a
//   week. The token is kept sealed so the owner can copy it again.
@Injectable()
export class GroupAccessService {
  private readonly logger = new Logger(GroupAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthSessionsService,
    private readonly userAuth: UserAuthService,
  ) {}

  // ---- The owner's side ----

  // Each member's login and waiting link, for the Members page.
  async accessOf(businessId: string): Promise<Map<string, MemberAccess>> {
    const [members, links] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { businessId, userId: { not: null } },
        select: { id: true, user: { select: { username: true, lastLoginAt: true, portalOnly: true } } },
      }),
      this.prisma.groupAccessLink.findMany({ where: { businessId, expiresAt: { gt: new Date() } } }),
    ]);
    const result = new Map<string, MemberAccess>();
    for (const member of members) {
      if (!member.user) continue;
      result.set(member.id, {
        login: { username: member.user.username, lastLoginAt: member.user.lastLoginAt, ownAccount: !member.user.portalOnly },
        link: null,
      });
    }
    for (const link of links) {
      const entry = result.get(link.groupMemberId) ?? { login: null, link: null };
      entry.link = { kind: link.kind, createdAt: link.createdAt, expiresAt: link.expiresAt, canCopy: link.tokenSealed !== null };
      result.set(link.groupMemberId, entry);
    }
    return result;
  }

  // Makes the member's BusinessMember match their record: active with the
  // role's access while they have a login and their role gives access,
  // removed otherwise (and a waiting link goes when access does). Run in the
  // same transaction as every role or status change.
  async sync(db: Db, member: Pick<GroupMember, 'id' | 'businessId' | 'userId' | 'role' | 'status' | 'isOwner'>): Promise<void> {
    const access = givesAccess(member);
    if (!access) await db.groupAccessLink.deleteMany({ where: { groupMemberId: member.id } });
    if (!member.userId) return;
    const business = await db.business.findUnique({ where: { id: member.businessId }, select: { ownerId: true } });
    // The owner's own membership is never touched from here.
    if (!business || business.ownerId === member.userId) return;
    const role = memberRoleFor(member.role);
    if (access && role) {
      await db.businessMember.upsert({
        where: { businessId_userId: { businessId: member.businessId, userId: member.userId } },
        create: { businessId: member.businessId, userId: member.userId, role, status: 'ACTIVE' },
        update: { role, status: 'ACTIVE' },
      });
    } else {
      await db.businessMember.updateMany({ where: { businessId: member.businessId, userId: member.userId }, data: { status: 'REMOVED' } });
    }
  }

  // A new access link (JOIN or RESET) for a member; any older link stops
  // working. Returns the token, which is shown to the owner to send.
  async createLink(businessId: string, memberId: string, kind: GroupAccessLinkKind, actorUserId: string) {
    const member = await this.prisma.groupMember.findFirst({ where: { id: memberId, businessId }, include: { user: true } });
    if (!member) throw new NotFoundException('Group member not found');
    if (!givesAccess(member)) throw new BadRequestException('Give them Viewer or Editor access first.');
    if (kind === 'JOIN' && member.userId) {
      throw new BadRequestException('They can already log in. Send a reset link if they forgot their password.');
    }
    if (kind === 'RESET') {
      if (!member.user) throw new BadRequestException('They have no login yet. Send them an access link instead.');
      if (!member.user.portalOnly) {
        throw new BadRequestException('They sign in with their own Smartly account, so they reset its password from the sign-in page.');
      }
      if (!(await this.ownsEveryGroupOf(member.userId as string, actorUserId))) {
        throw new BadRequestException("This login is also used in another admin's group, so only they can change its password.");
      }
    }
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const fields = {
      kind,
      tokenHash: hashToken(token),
      tokenSealed: this.seal(token),
      createdByUserId: actorUserId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LINK_DAYS * 24 * 60 * 60 * 1000),
    };
    const link = await this.prisma.groupAccessLink.upsert({
      where: { groupMemberId: member.id },
      create: { businessId, groupMemberId: member.id, ...fields },
      update: fields,
    });
    await this.record(businessId, actorUserId, { member: member.name, event: kind === 'JOIN' ? 'LINK' : 'RESET_LINK', role: member.role });
    return { token, kind, createdAt: link.createdAt, expiresAt: link.expiresAt };
  }

  // The waiting link again ("Copy the link again"), while it still works.
  async readLink(businessId: string, memberId: string) {
    const link = await this.prisma.groupAccessLink.findFirst({ where: { groupMemberId: memberId, businessId } });
    if (!link || link.expiresAt <= new Date()) throw new NotFoundException('This link has run out. Make a new one.');
    const token = link.tokenSealed ? this.open(link.tokenSealed) : null;
    if (!token) throw new NotFoundException("This link can't be shown again. Make a new one.");
    return { token, kind: link.kind, createdAt: link.createdAt, expiresAt: link.expiresAt };
  }

  async cancelLink(businessId: string, memberId: string, actorUserId: string) {
    const member = await this.prisma.groupMember.findFirst({ where: { id: memberId, businessId }, select: { name: true } });
    if (!member) throw new NotFoundException('Group member not found');
    const { count } = await this.prisma.groupAccessLink.deleteMany({ where: { groupMemberId: memberId, businessId } });
    if (count > 0) await this.record(businessId, actorUserId, { member: member.name, event: 'LINK_CANCELLED' });
    return { cancelled: count > 0 };
  }

  // ---- The member's side ----

  // What an access link is for, before it is used. Unknown, used and
  // run-out links all answer the same.
  async preview(token: string) {
    const link = await this.live(this.prisma, token);
    const { member, business } = link;
    const owner = await this.prisma.user.findUnique({ where: { id: business.ownerId }, select: { name: true, showNameInGroups: true } });
    const settings = await this.prisma.groupSettings.findUnique({ where: { businessId: business.id }, select: { kind: true } });
    const first = member.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const suggestion = USERNAME.test(first) && !(await this.prisma.user.findUnique({ where: { username: first }, select: { id: true } })) ? first : null;
    return {
      kind: link.kind,
      memberName: member.name,
      role: member.role,
      groupName: business.name,
      groupKind: settings?.kind ?? 'FAMILY',
      adminName: owner ? (owner.showNameInGroups ? owner.name : initialsOf(owner.name)) : null,
      username: link.kind === 'RESET' ? (member.user?.username ?? null) : null,
      suggestedUsername: link.kind === 'JOIN' ? suggestion : null,
      expiresAt: link.expiresAt,
    };
  }

  // Uses a link: a JOIN link makes the member's login (username and
  // password), a RESET link gives their login a new password and signs its
  // other devices out. Then signs this device in, like a sign-in would.
  async accept(token: string, input: { username?: string; password: string }, client: ClientInfo) {
    const tokenHash = hashToken(token);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const link = await this.live(tx, token);
      // Claimed: a second use of the same link finds nothing.
      await tx.groupAccessLink.delete({ where: { tokenHash } });
      const { member } = link;
      if (link.kind === 'RESET') {
        if (!member.user || !member.user.portalOnly) throw new BadRequestException(GONE);
        // Checked again as it is used, not only when it was made: the login
        // may have joined another owner's group since, and then only that
        // owner's own password reset stands.
        if (!(await this.ownsEveryGroupOf(member.user.id, link.business.ownerId, tx))) throw new BadRequestException(GONE);
        await this.credentials.set(member.user.id, input.password, tx);
        return { userId: member.user.id, businessId: member.businessId, member, reset: true, username: null as string | null };
      }
      if (member.userId) throw new BadRequestException(GONE);
      if (!(await areSignupsOpen(tx))) throw new ForbiddenException(SIGNUPS_CLOSED_MESSAGE);
      const username = (input.username ?? '').trim().toLowerCase();
      if (!USERNAME.test(username)) throw new BadRequestException('Use 4 to 20 small letters, numbers, dot or underscore, like rakib.m');
      if (await tx.user.findUnique({ where: { username }, select: { id: true } })) {
        throw new ConflictException(`Someone already uses “${username}”. Try another.`);
      }
      const user = await tx.user.create({
        data: {
          name: member.name,
          email: `member-${randomUUID()}@${PORTAL_EMAIL_DOMAIN}`,
          phone: canonicalPhone(member.phone),
          username,
          portalOnly: true,
          createdBy: link.createdByUserId,
        },
      });
      await this.credentials.set(user.id, input.password, tx);
      await this.join(tx, member, user.id);
      return { userId: user.id, businessId: member.businessId, member, reset: false, username: username as string | null };
    });
    if (outcome.reset) await this.sessions.revokeAllForUser(outcome.userId);
    await this.record(
      outcome.businessId,
      outcome.userId,
      outcome.reset
        ? { member: outcome.member.name, event: 'RESET' }
        : { member: outcome.member.name, event: 'JOINED', role: outcome.member.role, username: outcome.username },
    );
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: outcome.userId } });
    const sessionId = await this.sessions.create(user.id, client);
    const signedIn = await this.userAuth.finishSignIn(user, sessionId, client);
    return { ...signedIn, businessId: outcome.businessId };
  }

  // A JOIN link opened by someone already signed in: the group joins the
  // account they have. A portal login takes groups of one owner only (that
  // owner can reset its password), and the owner can't join their own group.
  async attach(token: string, userId: string) {
    const tokenHash = hashToken(token);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const link = await this.live(tx, token);
      if (link.kind !== 'JOIN') throw new BadRequestException('Open this reset link while signed out.');
      const { member, business } = link;
      if (member.userId) throw new BadRequestException(GONE);
      if (business.ownerId === userId) throw new BadRequestException('This is your own group.');
      const already = await tx.groupMember.findFirst({ where: { businessId: business.id, userId }, select: { id: true } });
      const membership = await tx.businessMember.findUnique({ where: { businessId_userId: { businessId: business.id, userId } }, select: { status: true } });
      if (already || membership?.status === 'ACTIVE') throw new ConflictException('You are already in this group.');
      const account = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { portalOnly: true } });
      if (account.portalOnly && !(await this.ownsEveryGroupOf(userId, business.ownerId, tx))) {
        throw new BadRequestException("Your login belongs to another admin's groups. Log out and make a new username for this group.");
      }
      await tx.groupAccessLink.delete({ where: { tokenHash } });
      await this.join(tx, member, userId);
      return { businessId: business.id, member };
    });
    await this.record(outcome.businessId, userId, { member: outcome.member.name, event: 'ATTACHED', role: outcome.member.role });
    return { businessId: outcome.businessId };
  }

  // ---- Helpers ----

  // The link a token names, still waiting, with its member (who still has
  // access) and group (not deleted).
  private async live(db: Db, token: string) {
    const link =
      typeof token === 'string' && token.length >= 20 && token.length <= 100
        ? await db.groupAccessLink.findUnique({ where: { tokenHash: hashToken(token) } })
        : null;
    if (!link || link.expiresAt <= new Date()) throw new NotFoundException(GONE);
    const [member, business] = await Promise.all([
      db.groupMember.findUnique({ where: { id: link.groupMemberId }, include: { user: true } }),
      db.business.findUnique({ where: { id: link.businessId }, select: { id: true, name: true, ownerId: true, deletedAt: true, type: true } }),
    ]);
    if (!member || !business || business.deletedAt || business.type !== 'GROUP' || !givesAccess(member)) throw new NotFoundException(GONE);
    return { ...link, member, business };
  }

  private async join(tx: Prisma.TransactionClient, member: GroupMember, userId: string) {
    await tx.groupMember.update({ where: { id: member.id }, data: { userId } });
    await this.sync(tx, { ...member, userId });
  }

  // Whether every group this login opens belongs to `ownerId`.
  private async ownsEveryGroupOf(userId: string, ownerId: string, db: Db = this.prisma): Promise<boolean> {
    const others = await db.groupMember.count({ where: { userId, business: { ownerId: { not: ownerId } } } });
    return others === 0;
  }

  private seal(token: string): string | null {
    try {
      return sealSecret(token, keyFromEnv(['GROUP_LINK_ENCRYPTION_KEY', 'TWO_FACTOR_ENCRYPTION_KEY', 'VAULT_ENCRYPTION_KEY']));
    } catch {
      return null;
    }
  }

  private open(sealed: string): string | null {
    try {
      return openSecret(sealed, keyFromEnv(['GROUP_LINK_ENCRYPTION_KEY', 'TWO_FACTOR_ENCRYPTION_KEY', 'VAULT_ENCRYPTION_KEY']));
    } catch {
      return null;
    }
  }

  // An "ACCESS" line in the group's activity log.
  private async record(businessId: string, actorUserId: string | null, summary: Record<string, string | null>) {
    try {
      await this.prisma.groupActivity.create({ data: { businessId, actorUserId, action: 'EDITED', entity: 'ACCESS', summary } });
    } catch (error) {
      this.logger.warn(`Could not log a group access change for ${businessId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
