import { SetMetadata } from '@nestjs/common';

export const ALLOW_LOCKED_WORKSPACE = 'allowLockedWorkspace';

// For the few workspace routes that must work before its PIN is entered:
// entering the PIN, and the owner removing a forgotten one. Membership is
// still required.
export const AllowLockedWorkspace = () => SetMetadata(ALLOW_LOCKED_WORKSPACE, true);
