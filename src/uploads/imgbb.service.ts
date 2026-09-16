import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ImgbbResponse {
  success: boolean;
  data?: { url: string; display_url: string };
  error?: { message: string };
}

// Every image upload in this app (User.avatarUrl, Contact.photoUrl) goes
// through imgbb instead of local disk storage -- this app has no cloud
// storage credentials of its own (see CLAUDE.md's "no Docker/install"
// local-dev philosophy), and imgbb's free API is a simple drop-in for "give
// me back a permanent, publicly-servable URL for this image." Callers pass
// the raw file buffer straight from multer's memoryStorage (see
// user-avatar-upload.ts/contact-photo-upload.ts) -- nothing is ever written
// to this server's own disk anymore for these uploads.
@Injectable()
export class ImgbbService {
  constructor(private readonly configService: ConfigService) {}

  async uploadImage(buffer: Buffer, filename?: string): Promise<string> {
    const apiKey = this.configService.get<string>('IMGBB_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('Image upload is not configured (IMGBB_API_KEY missing)');
    }

    const formData = new FormData();
    formData.append('key', apiKey);
    formData.append('image', buffer.toString('base64'));
    if (filename) {
      formData.append('name', filename);
    }

    const response = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
    const json = (await response.json()) as ImgbbResponse;
    if (!response.ok || !json.success || !json.data) {
      throw new InternalServerErrorException(json.error?.message ?? 'Image upload failed');
    }
    return json.data.url;
  }
}
