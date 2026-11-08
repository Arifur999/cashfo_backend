import { profileDetailsProblem } from './profile-rules.js';

describe('profile details', () => {
  const today = '2026-11-07';
  it('takes a date of birth from 13 years back to 1920', () => {
    expect(profileDetailsProblem({ dateOfBirth: '2013-11-07', mainPhone: null }, today)).toBeNull();
    expect(profileDetailsProblem({ dateOfBirth: '2013-11-08', mainPhone: null }, today)).toBe('You need to be at least 13 to use Smartly.');
    expect(profileDetailsProblem({ dateOfBirth: '2027-01-01', mainPhone: null }, today)).toBe('That date is in the future.');
    expect(profileDetailsProblem({ dateOfBirth: '1919-12-31', mainPhone: null }, today)).toBe('Check the year.');
  });

  it('wants a second number that is a mobile and not the main one', () => {
    expect(profileDetailsProblem({ phone2Typed: '01811000000', phone2: '+8801811000000', mainPhone: '+8801711000000' }, today)).toBeNull();
    expect(profileDetailsProblem({ phone2Typed: '12345', phone2: null, mainPhone: null }, today)).toBe(
      'Use a Bangladesh mobile number that starts with 13 to 19.',
    );
    expect(profileDetailsProblem({ phone2Typed: '01711000000', phone2: '+8801711000000', mainPhone: '+8801711000000' }, today)).toBe(
      'This is the same as your main number.',
    );
  });
});
