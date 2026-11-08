import { companyOf, EMPTY_COMPANY, youtubeIdOf } from './help-rules.js';

describe('help rules', () => {
  it('reads a YouTube link in any of its shapes', () => {
    const id = 'dQw4w9WgXcQ';
    expect(
      [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
        'youtu.be/dQw4w9WgXcQ',
        'https://youtube.com/shorts/dQw4w9WgXcQ',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        id,
      ].map(youtubeIdOf),
    ).toEqual([id, id, id, id, id]);
    expect(['https://vimeo.com/123', 'https://youtube.com/watch?v=short', 'not a link'].map(youtubeIdOf)).toEqual([null, null, null]);
  });

  it('reads the stored company loosely', () => {
    expect(companyOf(null)).toEqual(EMPTY_COMPANY);
    expect(companyOf({ name: 'Smartly', openDays: ['sat', 'xyz', 'sat'], opensAt: '25:00', replyHours: 3 })).toMatchObject({
      name: 'Smartly',
      openDays: ['sat'],
      opensAt: '09:00',
      replyHours: 3,
    });
  });
});
