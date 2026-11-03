import { baseSiteName, matchUploadProject } from '@/lib/upload-utils';

describe('baseSiteName', () => {
  it.each([
    ['portfolio-v2.html', 'portfolio'],
    ['Portfolio_v2.0.HTML', 'portfolio'],
    ['landing.v1.2.zip', 'landing'],
    ['landing-v2-final.html', 'landing'],
    ['site (1).html', 'site'],
    ['My Site_final.htm', 'my-site'],
    ['my site', 'my-site'],
    // Digits that are part of the name stay.
    ['game-2048.html', 'game-2048'],
    ['dev2.html', 'dev2'],
    ['web3', 'web3'],
    ['v2.html', 'v2'],
  ])('%s → %s', (input, expected) => {
    expect(baseSiteName(input)).toBe(expected);
  });
});

describe('matchUploadProject', () => {
  const portfolio = { id: 'p1', name: 'portfolio' };
  const game = { id: 'p2', name: 'game' };

  it('matches a new version to its site', () => {
    expect(matchUploadProject('portfolio-v2.html', [portfolio, game])).toBe(portfolio);
  });

  it('does not match on digits that belong to the name', () => {
    expect(matchUploadProject('game-2048.html', [portfolio, game])).toBeNull();
  });

  it('picks nothing when several sites match', () => {
    // An account that already has the duplicate this feature prevents.
    const portfolioV2 = { id: 'p3', name: 'portfolio-v2' };
    expect(matchUploadProject('portfolio-v3.html', [portfolio, portfolioV2])).toBeNull();
  });

  it('picks nothing for an unrelated file', () => {
    expect(matchUploadProject('resume.html', [portfolio, game])).toBeNull();
  });
});
