import { IsString, IsUrl, MaxLength } from 'class-validator';

// Where a photo can come back from ("Undo" after changing or removing it):
// our own uploads (imgbb) and Google sign-in photos. Nothing else, so the
// photo is never a link to somewhere a person picked.
export const AVATAR_HOSTS: (string | RegExp)[] = ['i.ibb.co', /^[a-z0-9-]+\.googleusercontent\.com$/];

export class RestoreAvatarDto {
  @IsString()
  @MaxLength(500)
  @IsUrl({ protocols: ['https'], require_protocol: true, host_whitelist: AVATAR_HOSTS })
  url: string;
}
