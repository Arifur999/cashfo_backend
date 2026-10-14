export interface RequestUser {
  id: string;
  email: string;
  // The better-auth session this request's token is bound to.
  sessionId: string;
  // Set when a super admin is viewing the account (read-only): their id.
  impersonatedBy?: string;
}
