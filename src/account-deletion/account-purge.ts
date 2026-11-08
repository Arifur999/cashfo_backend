import type { Prisma } from '@prisma/client';
import { anonymisedUser } from './deletion-rules.js';

// Everything a workspace holds, child rows before their parents (the same
// FK-safe order as AdminOwnersService.resetOwnerData, plus Group Expense),
// then the workspace itself. Members of the workspace lose it too.
export async function deleteWorkspaces(tx: Prisma.TransactionClient, businessIds: string[]): Promise<void> {
  if (businessIds.length === 0) return;
  const inIds = { in: businessIds };
  await tx.transactionEntry.deleteMany({ where: { transaction: { businessId: inIds } } });
  await tx.savingsGoalEntry.deleteMany({ where: { businessId: inIds } });
  await tx.transaction.deleteMany({ where: { businessId: inIds } });
  await tx.savingsGoal.deleteMany({ where: { businessId: inIds } });
  await tx.contact.deleteMany({ where: { businessId: inIds } });
  await tx.assetValueHistory.deleteMany({ where: { asset: { businessId: inIds } } });
  await tx.asset.deleteMany({ where: { businessId: inIds } });
  await tx.assetCategoryOption.deleteMany({ where: { businessId: inIds } });
  await tx.budgetCategory.deleteMany({ where: { businessId: inIds } });
  await tx.incomeGoal.deleteMany({ where: { businessId: inIds } });
  await tx.account.updateMany({ where: { businessId: inIds }, data: { parentId: null } });
  await tx.account.deleteMany({ where: { businessId: inIds } });

  await tx.groupExpenseSplit.deleteMany({ where: { expense: { businessId: inIds } } });
  await tx.groupSettlementMember.deleteMany({ where: { settlement: { businessId: inIds } } });
  await tx.groupSettlement.deleteMany({ where: { businessId: inIds } });
  await tx.groupExpense.deleteMany({ where: { businessId: inIds } });
  await tx.groupContribution.deleteMany({ where: { businessId: inIds } });
  await tx.groupCashHandover.deleteMany({ where: { businessId: inIds } });
  await tx.groupActivity.deleteMany({ where: { businessId: inIds } });
  await tx.groupMeal.deleteMany({ where: { businessId: inIds } });
  await tx.groupExpenseCategoryOption.deleteMany({ where: { businessId: inIds } });
  await tx.groupMonthlyBudget.deleteMany({ where: { businessId: inIds } });
  await tx.groupSettings.deleteMany({ where: { businessId: inIds } });
  await tx.groupMember.deleteMany({ where: { businessId: inIds } });

  await tx.userNotification.deleteMany({ where: { businessId: inIds } });
  await tx.businessMember.deleteMany({ where: { businessId: inIds } });
  await tx.business.deleteMany({ where: { id: inIds } });
}

// The purge after the 30-day grace: every workspace the person owns and
// everything personal goes; the User row is anonymised rather than
// deleted, so payments, invoices (with their issuedTo snapshot), referrals,
// payout requests and support tickets keep their references for the books.
// Runs inside the caller's transaction, under its per-user lock.
export async function purgeUser(tx: Prisma.TransactionClient, userId: string, email: string): Promise<void> {
  const owned = await tx.business.findMany({ where: { ownerId: userId }, select: { id: true } });
  await deleteWorkspaces(
    tx,
    owned.map((business) => business.id),
  );

  // Seats in other people's workspaces.
  await tx.businessMember.deleteMany({ where: { userId } });

  // Copies of their records (Settings › Data & privacy).
  await tx.dataBackup.deleteMany({ where: { userId } });

  // The personal apps.
  await tx.vaultEntry.deleteMany({ where: { userId } });
  await tx.habit.deleteMany({ where: { userId } });
  await tx.habitMonthTracker.deleteMany({ where: { userId } });
  await tx.prayerSettings.deleteMany({ where: { userId } });
  await tx.qazaLog.deleteMany({ where: { userId } });
  await tx.book.deleteMany({ where: { userId } });
  await tx.bookGoal.deleteMany({ where: { userId } });
  await tx.skill.deleteMany({ where: { userId } });
  await tx.skillGoal.deleteMany({ where: { userId } });
  await tx.todoList.deleteMany({ where: { userId } });
  await tx.todoRepeat.deleteMany({ where: { userId } });
  await tx.note.deleteMany({ where: { userId } });
  await tx.journalEntry.deleteMany({ where: { userId } });
  await tx.noteCategory.deleteMany({ where: { userId } });
  await tx.writingSettings.deleteMany({ where: { userId } });
  await tx.ramadanPrep.deleteMany({ where: { userId } });
  await tx.reminder.deleteMany({ where: { userId } });
  await tx.userNotification.deleteMany({ where: { userId } });
  await tx.pushSubscription.deleteMany({ where: { userId } });

  // Money details and sign-in.
  await tx.payoutMethod.deleteMany({ where: { userId } });
  await tx.oneTimeCode.deleteMany({ where: { userId } });
  await tx.trustedDevice.deleteMany({ where: { userId } });
  await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
  await tx.twoStepChallenge.deleteMany({ where: { userId } });
  await tx.twoFactor.deleteMany({ where: { userId } });
  await tx.emailVerificationToken.deleteMany({ where: { userId } });
  await tx.passwordResetToken.deleteMany({ where: { userId } });
  await tx.userSession.deleteMany({ where: { userId } });
  await tx.authSession.deleteMany({ where: { userId } });
  await tx.authAccount.deleteMany({ where: { userId } });
  await tx.loginAttempt.deleteMany({ where: { email } });
  await tx.adminNote.deleteMany({ where: { subjectUserId: userId } });

  // Screenshots sent to support may show their money; the ticket text stays.
  await tx.ticketAttachment.deleteMany({ where: { message: { senderType: 'USER', senderId: userId } } });

  // The plan ends with the account.
  await tx.userSubscription.updateMany({ where: { userId }, data: { status: 'EXPIRED', cancelAtPeriodEnd: true } });

  await tx.user.update({ where: { id: userId }, data: anonymisedUser(userId) });
}
