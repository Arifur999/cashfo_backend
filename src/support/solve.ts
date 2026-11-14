import { TicketStatus } from '@prisma/client';

// Whether a customer may mark a conversation solved: any but a closed one
// (the team closed it; a new message starts afresh).
export const canSolve = (status: TicketStatus): boolean => status !== TicketStatus.CLOSED;
