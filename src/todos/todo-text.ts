import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { cleanText, INVISIBLE_ONLY } from '../common/text.js';
import { MAX_NOTE_LENGTH, MAX_STEP_LENGTH, MAX_STEPS, type TodoStepDto } from './dto/todo-fields.js';

// A task's note and its smaller steps: how they are cleaned on the way in
// and read back out. Pure.

// A type, not an interface, so it passes as a Prisma JSON value.
export type TodoStepView = { text: string; done: boolean };

// A note keeps its line breaks (cleanText() would fold them into spaces);
// only the ends are trimmed. NFC can lengthen Bangla, so the limit is
// checked again on the cleaned value. NUL never gets here (NoNulPipe).
export function cleanNote(value: string): string {
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (text.length > MAX_NOTE_LENGTH) throw new BadRequestException(`The note can't be longer than ${MAX_NOTE_LENGTH} characters`);
  return INVISIBLE_ONLY.test(text) ? '' : text;
}

export function cleanSteps(steps: readonly TodoStepDto[]): TodoStepView[] {
  return steps.map((step) => {
    const text = cleanText(step.text, 'step', MAX_STEP_LENGTH);
    if (INVISIBLE_ONLY.test(text)) throw new BadRequestException('A step needs some words');
    return { text, done: step.done };
  });
}

// The steps as stored, read defensively: anything that isn't a step is left out.
export function stepsOf(value: Prisma.JsonValue): TodoStepView[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((step): step is Prisma.JsonObject => typeof step === 'object' && step !== null && !Array.isArray(step))
    .filter((step) => typeof step.text === 'string' && typeof step.done === 'boolean')
    .slice(0, MAX_STEPS)
    .map((step) => ({ text: step.text as string, done: step.done as boolean }));
}

// A repeat's copies start with every step unticked.
export const unticked = (steps: readonly TodoStepView[]): TodoStepView[] => steps.map((step) => ({ text: step.text, done: false }));
