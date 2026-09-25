import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

// Same shape as contacts/contact-photo-upload.ts (and user-auth/user-avatar-
// upload.ts) -- memoryStorage since the bytes only need to reach
// ImgbbService.uploadImage(), never this server's own disk.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const groupMemberPhotoMulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new BadRequestException('Only JPEG, PNG, WEBP, or GIF images are allowed'), false);
      return;
    }
    callback(null, true);
  },
};
