import { initialsOf } from './group-names.js';

describe('initialsOf', () => {
  it('keeps the first letter of the first two names', () => {
    expect(initialsOf('Arif Mahmud')).toBe('A. M.');
    expect(initialsOf('  md. khaled  hasan rony ')).toBe('M. K.');
    expect(initialsOf('রাকিব')).toBe('র.');
  });

  it('never shows an empty name', () => {
    expect(initialsOf('   ')).toBe('?');
  });
});
