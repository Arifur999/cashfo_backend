import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CredentialsService } from '../auth/credentials.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto.js';
import { ResetVaultDto } from './dto/reset-vault.dto.js';
import { SetVaultPasswordDto } from './dto/set-vault-password.dto.js';
import { UnlockVaultDto } from './dto/unlock-vault.dto.js';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto.js';
import { decryptVaultSecret, encryptVaultSecret, isSealedVaultText, openVaultText, sealVaultText, vaultPasswordFingerprint } from './vault-crypto.js';

type StoredEntry = { id: string; usernameOrEmail: string | null; holderName: string | null; notes: string | null; passwordCiphertext: string };

@Injectable()
export class PasswordVaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly credentials: CredentialsService,
  ) {}

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { hasVaultPassword: user.vaultPasswordHash !== null };
  }

  // Sets the first vault password, or changes it. Changing needs the
  // current vault password as well as the account password: the vault is
  // meant to stay shut even when the account password leaks.
  async setVaultPassword(userId: string, dto: SetVaultPasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.requireAccountPassword(userId, dto.currentPassword);
    if (user.vaultPasswordHash) {
      const vaultMatches = !!dto.currentVaultPassword && (await bcrypt.compare(dto.currentVaultPassword, user.vaultPasswordHash));
      if (!vaultMatches) {
        throw new BadRequestException('Your current vault password is incorrect. Forgot it? Reset the vault instead (this deletes the saved entries).');
      }
    }
    const vaultPasswordHash = await bcrypt.hash(dto.vaultPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { vaultPasswordHash } });
    return { success: true };
  }

  // "Forgot vault password?" -- a fresh vault password, and every saved
  // entry deleted in the same transaction (see ResetVaultDto).
  async resetVault(userId: string, dto: ResetVaultDto) {
    await this.requireAccountPassword(userId, dto.currentPassword);
    const vaultPasswordHash = await bcrypt.hash(dto.vaultPassword, 10);
    const [deleted] = await this.prisma.$transaction([
      this.prisma.vaultEntry.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { vaultPasswordHash } }),
    ]);
    return { success: true, deletedEntries: deleted.count };
  }

  private async requireAccountPassword(userId: string, password: string) {
    if (await this.credentials.verify(userId, password)) return;
    if (!(await this.credentials.has(userId))) {
      throw new BadRequestException(
        'Your account has no password yet because you sign in with Google. Set one with "Forgot password?" on the sign-in page, then come back.',
      );
    }
    throw new BadRequestException('Your account password is incorrect');
  }

  async unlock(userId: string, dto: UnlockVaultDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.vaultPasswordHash) {
      throw new BadRequestException('Set up a vault password first');
    }
    const matches = await bcrypt.compare(dto.vaultPassword, user.vaultPasswordHash);
    if (!matches) {
      throw new UnauthorizedException('Incorrect vault password');
    }
    const expiresIn = this.configService.get<string>('VAULT_TOKEN_EXPIRES_IN') ?? '10m';
    const vaultToken = this.jwtService.sign(
      { sub: userId, scope: 'vault', ver: vaultPasswordFingerprint(user.vaultPasswordHash) },
      { secret: this.configService.get<string>('VAULT_TOKEN_SECRET'), expiresIn: expiresIn as JwtSignOptions['expiresIn'] },
    );
    return { vaultToken, expiresIn };
  }

  async list(userId: string) {
    const entries = await this.prisma.vaultEntry.findMany({
      where: { userId },
      orderBy: { title: 'asc' },
    });
    // Entries saved before the login, holder name and notes were encrypted
    // get sealed now, the first time their owner opens the vault.
    for (const entry of entries.filter((e) => !isSealedVaultText(e.usernameOrEmail) || !isSealedVaultText(e.holderName) || !isSealedVaultText(e.notes))) {
      await this.prisma.vaultEntry.update({
        where: { id: entry.id },
        data: {
          usernameOrEmail: sealVaultText(openVaultText(entry.usernameOrEmail)),
          holderName: sealVaultText(openVaultText(entry.holderName)),
          notes: sealVaultText(openVaultText(entry.notes)),
        },
      });
    }
    // Never include passwordCiphertext in the list response -- a single
    // GET here should not hand back every stored secret at once. The eye
    // icon on each row calls reveal() individually instead.
    return entries.map((entry) => this.toSummary(entry));
  }

  // What the client sees of an entry: the text fields opened, the password
  // left out.
  private toSummary<T extends StoredEntry>(entry: T) {
    const { passwordCiphertext: _passwordCiphertext, ...rest } = entry;
    return { ...rest, usernameOrEmail: openVaultText(entry.usernameOrEmail), holderName: openVaultText(entry.holderName), notes: openVaultText(entry.notes) };
  }

  async create(userId: string, dto: CreateVaultEntryDto) {
    const { password, usernameOrEmail, holderName, notes, ...rest } = dto;
    const entry = await this.prisma.vaultEntry.create({
      data: {
        ...rest,
        userId,
        usernameOrEmail: sealVaultText(usernameOrEmail),
        holderName: sealVaultText(holderName),
        notes: sealVaultText(notes),
        passwordCiphertext: encryptVaultSecret(password),
      },
    });
    return this.toSummary(entry);
  }

  async update(userId: string, id: string, dto: UpdateVaultEntryDto) {
    await this.assertOwnership(userId, id);
    const { password, usernameOrEmail, holderName, notes, ...rest } = dto;
    const entry = await this.prisma.vaultEntry.update({
      where: { id },
      data: {
        ...rest,
        ...(usernameOrEmail !== undefined && { usernameOrEmail: sealVaultText(usernameOrEmail) }),
        ...(holderName !== undefined && { holderName: sealVaultText(holderName) }),
        ...(notes !== undefined && { notes: sealVaultText(notes) }),
        ...(password ? { passwordCiphertext: encryptVaultSecret(password) } : {}),
      },
    });
    return this.toSummary(entry);
  }

  async remove(userId: string, id: string) {
    await this.assertOwnership(userId, id);
    await this.prisma.vaultEntry.delete({ where: { id } });
    return { success: true };
  }

  async reveal(userId: string, id: string) {
    const entry = await this.assertOwnership(userId, id);
    return { password: decryptVaultSecret(entry.passwordCiphertext) };
  }

  private async assertOwnership(userId: string, id: string) {
    const entry = await this.prisma.vaultEntry.findUnique({ where: { id } });
    if (!entry) {
      throw new NotFoundException('Vault entry not found');
    }
    if (entry.userId !== userId) {
      throw new ForbiddenException('You do not have access to this vault entry');
    }
    return entry;
  }
}
