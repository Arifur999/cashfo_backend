import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

// A screenshot on a support message: kept in memory just long enough to be
// saved with the message (TicketAttachment). Raster images only -- an SVG
// could carry a script when the support team opens it.
export const SCREENSHOT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export const screenshotMulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    if (!SCREENSHOT_TYPES.has(file.mimetype)) {
      callback(new BadRequestException('Only JPEG, PNG or WEBP screenshots are allowed'), false);
      return;
    }
    callback(null, true);
  },
};
