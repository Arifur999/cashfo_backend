import { ANNOUNCEMENT_LINK } from './dto/create-announcement.dto.js';

describe('an announcement link', () => {
  it('may be a page of the app or an https address', () => {
    for (const link of ['/habit-tracker', '/settings/plans?from=banner', 'https://smartly.softech.agency/blog']) expect(ANNOUNCEMENT_LINK.test(link)).toBe(true);
  });

  it('may not leave the site through //, use http or a script, or hold spaces', () => {
    for (const link of ['//evil.example', 'http://example.com', 'javascript:alert(1)', '/a page', 'habit-tracker']) expect(ANNOUNCEMENT_LINK.test(link)).toBe(false);
  });
});
