import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

// Same local-disk storage pattern as ContactsController's own photo upload
// (see contact-photo-upload.ts's comment) -- written to backend/uploads/avatars
// and served back statically (main.ts's express.static() mount).
export const USER_AVATAR_UPLOAD_DIR = join(process.cwd(), 'uploads', 'avatars');
if (!existsSync(USER_AVATAR_UPLOAD_DIR)) {
  mkdirSync(USER_AVATAR_UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const userAvatarMulterOptions = {
  storage: diskStorage({
    destination: USER_AVATAR_UPLOAD_DIR,
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new BadRequestException('Only JPEG, PNG, WEBP, or GIF images are allowed'), false);
      return;
    }
    callback(null, true);
  },
};
