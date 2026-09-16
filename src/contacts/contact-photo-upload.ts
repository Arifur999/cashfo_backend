import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

// memoryStorage -- the uploaded file's bytes stay in memory (file.buffer)
// just long enough to hand off to ImgbbService.uploadImage(); nothing is
// ever written to this server's own disk (see that service's comment for
// why the app moved off local-disk storage for uploads).
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const contactPhotoMulterOptions = {
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
