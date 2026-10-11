// better-auth keeps a user's password on an AuthAccount row: providerId
// "credential", accountId = the user's own id, the hash in `password`.
// These helpers are the one place that layout is spelled out -- the app
// (CredentialsService) and the seed both build on them.
export const CREDENTIAL_PROVIDER = 'credential';

export const credentialAccountKey = (userId: string) => ({
  providerId_accountId: { providerId: CREDENTIAL_PROVIDER, accountId: userId },
});

export const credentialAccountData = (userId: string, passwordHash: string) => ({
  userId,
  providerId: CREDENTIAL_PROVIDER,
  accountId: userId,
  password: passwordHash,
});
