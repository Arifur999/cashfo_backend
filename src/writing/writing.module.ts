import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { JournalUnlockService } from './journal-unlock.service.js';
import { JournalService } from './journal.service.js';
import { NotesService } from './notes.service.js';
import { JournalController, NotesController } from './writing.controller.js';

// Habit Tracker > Write: notes, the journal and its diary PIN. JwtModule
// signs the diary unlocks.
@Module({
  imports: [UserAuthModule, JwtModule.register({})],
  controllers: [NotesController, JournalController],
  providers: [NotesService, JournalService, JournalUnlockService],
})
export class WritingModule {}
