import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto.js';
import { SetVaultPasswordDto } from './dto/set-vault-password.dto.js';
import { UnlockVaultDto } from './dto/unlock-vault.dto.js';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto.js';
import { decryptVaultSecret, encryptVaultSecret } from './vault-crypto.js';

@Injectable()
export class PasswordVaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { hasVaultPassword: user.vaultPasswordHash !== null };
  }

  // Also used to CHANGE an already-set vault password -- always re-checks
  // the account password (not the old vault password), same trust level as
  // ChangePasswordDto for the main account password.
  async setVaultPassword(userId: string, dto: SetVaultPasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('Your account password is incorrect');
    }
    const vaultPasswordHash = await bcrypt.hash(dto.vaultPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { vaultPasswordHash } });
    return { success: true };
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
      { sub: userId, scope: 'vault' },
      { secret: this.configService.get<string>('VAULT_TOKEN_SECRET'), expiresIn: expiresIn as JwtSignOptions['expiresIn'] },
    );
    return { vaultToken, expiresIn };
  }

  async list(userId: string) {
    const entries = await this.prisma.vaultEntry.findMany({
      where: { userId },
      orderBy: { title: 'asc' },
    });
    // Never include passwordCiphertext in the list response -- a single
    // GET here should not hand back every stored secret at once. The eye
    // icon on each row calls reveal() individually instead.
    return entries.map(({ passwordCiphertext: _passwordCiphertext, ...entry }) => entry);
  }

  async create(userId: string, dto: CreateVaultEntryDto) {
    const { password, ...rest } = dto;
    const entry = await this.prisma.vaultEntry.create({
      data: { ...rest, userId, passwordCiphertext: encryptVaultSecret(password) },
    });
    const { passwordCiphertext: _passwordCiphertext, ...summary } = entry;
    return summary;
  }

  async update(userId: string, id: string, dto: UpdateVaultEntryDto) {
    await this.assertOwnership(userId, id);
    const { password, ...rest } = dto;
    const entry = await this.prisma.vaultEntry.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordCiphertext: encryptVaultSecret(password) } : {}) },
    });
    const { passwordCiphertext: _passwordCiphertext, ...summary } = entry;
    return summary;
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
