// gameNames.ts — one spelling per platform and genre of a game. Steam,
// RAWG and the old site each name them their own way («PS5» and
// «PlayStation 5», «Action» and «Экшены»); a card and the genre filter
// show one of each.

const PLATFORMS: Record<string, string> = {
  'playstation 5': 'PS5', 'playstation 4': 'PS4', 'playstation 3': 'PS3',
  'xbox series s/x': 'Xbox Series X/S', 'xbox series x': 'Xbox Series X/S',
  macos: 'Mac', 'apple macintosh': 'Mac', windows: 'PC'
};

// RAWG's English genres, named as Steam names them in Russian.
const GENRES: Record<string, string> = {
  action: 'Экшены', adventure: 'Приключенческие игры', rpg: 'Ролевые игры', strategy: 'Стратегии',
  simulation: 'Симуляторы', indie: 'Инди', casual: 'Казуальные игры', racing: 'Гонки', sports: 'Спортивные игры',
  'massively multiplayer': 'Многопользовательские игры', puzzle: 'Головоломки', shooter: 'Шутеры',
  platformer: 'Платформеры', arcade: 'Аркады', fighting: 'Файтинги', family: 'Семейные',
  'board games': 'Настольные игры', card: 'Карточные', educational: 'Обучающие'
};

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

export function canonicalPlatforms(list: string[] | null | undefined): string[] | null {
  if (!Array.isArray(list)) return list ?? null;
  return unique(list.map((p) => PLATFORMS[String(p).trim().toLowerCase()] ?? p));
}

export function canonicalGenres(list: string[]): string[] {
  return unique(list.map((g) => GENRES[String(g).trim().toLowerCase()] ?? g));
}
