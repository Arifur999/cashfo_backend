import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

// Local-disk storage -- this app has no cloud storage credentials
// configured (see CLAUDE.md's "no Docker/install" local-dev philosophy),
// so uploaded contact photos are just written to backend/uploads/contacts
// and served back statically (see main.ts's express.static() mount).
export const CONTACT_PHOTO_UPLOAD_DIR = join(process.cwd(), 'uploads', 'contacts');
if (!existsSync(CONTACT_PHOTO_UPLOAD_DIR)) {
  mkdirSync(CONTACT_PHOTO_UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const contactPhotoMulterOptions = {
  storage: diskStorage({
    destination: CONTACT_PHOTO_UPLOAD_DIR,
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
