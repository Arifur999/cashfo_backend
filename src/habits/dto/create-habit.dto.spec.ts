import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateHabitDto } from './create-habit.dto.js';

const errorsFor = async (icon: string) => (await validate(plainToInstance(CreateHabitDto, { name: 'Walk', icon }))).map((error) => error.property);

describe('CreateHabitDto icon', () => {
  // The DailyHabitDrawer board's picker: walking, sleep, food and quitting something.
  it('takes the Habit Tracker picker icons', async () => {
    for (const icon of ['footprints', 'moon', 'apple', 'ban', 'droplet', 'dumbbell', 'book-open', 'pencil', 'sun', 'heart', 'leaf', 'target']) {
      expect(await errorsFor(icon)).toEqual([]);
    }
  });

  it('still refuses an icon outside the list', async () => {
    expect(await errorsFor('not-an-icon')).toEqual(['icon']);
  });
});
