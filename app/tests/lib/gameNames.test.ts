import { describe, expect, it } from 'vitest';
import { canonicalGenres, canonicalPlatforms } from '../../src/lib/gameNames';
import { fromRow } from '../../src/lib/titleRow';

describe('gameNames', () => {
  it('one spelling per platform, no repeats', () => {
    expect(canonicalPlatforms(['PlayStation 5', 'PS5', 'Xbox Series S/X', 'macOS', 'PC'])).toEqual(['PS5', 'Xbox Series X/S', 'Mac', 'PC']);
    expect(canonicalPlatforms(null)).toBeNull();
  });
  it("RAWG's English genres read as Steam's Russian ones", () => {
    expect(canonicalGenres(['Action', 'RPG', 'Экшены', 'кооператив'])).toEqual(['Экшены', 'Ролевые игры', 'кооператив']);
  });
  it('a game row reads with them; other titles are left as they are', () => {
    const game = fromRow({ id: 'g', title: 'g', category: 'game', status: 'queue', genres: ['Action'], platforms: ['PlayStation 5'] }).title;
    expect([game.genres, game.platforms]).toEqual([['Экшены'], ['PS5']]);
    const film = fromRow({ id: 'f', title: 'f', category: 'movie', status: 'queue', genres: ['Action'] }).title;
    expect(film.genres).toEqual(['Action']);
  });
});
