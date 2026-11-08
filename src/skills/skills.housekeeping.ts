import { Injectable, type OnModuleInit } from '@nestjs/common';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { SkillsService } from './skills.service.js';

const HOUR = 60 * 60 * 1000;

// Deleted skills are kept a day so the delete can be undone; this clears
// the ones past that (their practice, roadmap, notes and resources go with
// them).
@Injectable()
export class SkillsHousekeeping implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly skills: SkillsService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'skills-purge-deleted', everyMs: HOUR, run: async (now) => void (await this.skills.purgeDeleted(now)) });
  }
}
