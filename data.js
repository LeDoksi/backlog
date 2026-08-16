// data.js
const TITLES = [
  {
    id: 'frieren-2023',
    title: "Frieren: Beyond Journey's End",
    category: 'anime',
    status: 'done',
    airingStatus: 'ongoing',
    seasonInfo: 'Первый сезон (2023, 28 серий) охватил ранние арки манги; второй сезон анонсирован и вышел в январе 2026 года.',
    year: 2023,
    genres: ['драма', 'фэнтези'],
    rating: null,
    synopsis: 'Эльфийка-магиня Фрирен, пережившая своих спутников по приключениям, заново открывает для себя, что значит ценить недолгую человеческую жизнь.',
    cover: 'images/covers/frieren-2023.jpg'
  },
  {
    id: 're-zero-starting-life-in-another-world-2016',
    title: 'Re:Zero − Starting Life in Another World',
    category: 'anime',
    status: 'done',
    airingStatus: 'ongoing',
    seasonInfo: 'Вышло три сезона: первый в 2016-м, второй в 2020–2021-м, третий в двух частях — осенью 2024-го и весной 2025-го. Сюжет остановился в середине арки 7, продолжение официально не анонсировано.',
    year: 2016,
    genres: ['фэнтези', 'триллер'],
    rating: null,
    synopsis: 'Субару переносится в фэнтезийный мир и обнаруживает, что может возвращаться в прошлое после смерти — но каждый раз платит за это дорогую цену.',
    cover: 'images/covers/re-zero-starting-life-in-another-world-2016.jpg'
  },
  {
    id: 'the-boys-2019',
    title: 'The Boys',
    category: 'series',
    status: 'done',
    airingStatus: 'ongoing',
    seasonInfo: 'Вышло четыре сезона (2019–2024). Пятый сезон объявлен заключительным, отснят и ожидается в 2026 году — точная дата премьеры пока не подтверждена.',
    year: 2019,
    genres: ['сатира', 'боевик'],
    rating: null,
    synopsis: 'Группа мстителей без суперсил охотится на коррумпированных супергероев корпорации Vought.',
    cover: 'images/covers/the-boys-2019.jpg'
  },
  {
    id: 'ted-lasso-2020',
    title: 'Ted Lasso',
    category: 'series',
    status: 'queue',
    airingStatus: 'ongoing',
    seasonInfo: 'Три сезона (2020–2023) изначально задумывались как законченная история. В 2024 году Apple TV+ официально анонсировал четвёртый сезон с возвращением Джейсона Судейкиса; дата премьеры пока не объявлена.',
    year: 2020,
    genres: ['комедия', 'спорт'],
    rating: null,
    synopsis: 'Американский тренер по американскому футболу без опыта в футболе возглавляет английский клуб и меняет отношение команды друг к другу.',
    cover: 'images/covers/ted-lasso-2020.jpg'
  },
  {
    id: 'barbie-2023',
    title: 'Barbie',
    category: 'movie',
    status: 'done',
    airingStatus: null,
    year: 2023,
    genres: ['комедия', 'фэнтези'],
    rating: null,
    synopsis: 'Барби покидает идеальный Барбиленд и отправляется в реальный мир, где сталкивается с непростыми вопросами об идентичности.',
    cover: 'images/covers/barbie-2023.jpg'
  },
  {
    id: 'fight-club-1999',
    title: 'Fight Club',
    category: 'movie',
    status: 'queue',
    airingStatus: null,
    year: 1999,
    genres: ['драма', 'триллер'],
    rating: null,
    synopsis: 'Безымянный офисный работник и харизматичный продавец мыла Тайлер Дёрден основывают подпольный бойцовский клуб, который перерастает в нечто гораздо большее.',
    cover: 'images/covers/fight-club-1999.jpg'
  },
  {
    id: 'it-takes-two-2021',
    title: 'It Takes Two',
    category: 'game',
    status: 'done',
    airingStatus: null,
    year: 2021,
    genres: ['кооператив', 'платформер'],
    rating: null,
    synopsis: 'Разводящиеся родители превращаются в кукол и должны пройти изобретательные кооперативные головоломки, чтобы вернуть себе человеческий облик.',
    cover: 'images/covers/it-takes-two-2021.jpg'
  },
  {
    id: 'baldurs-gate-3-2023',
    title: "Baldur's Gate 3",
    category: 'game',
    status: 'queue',
    airingStatus: null,
    year: 2023,
    genres: ['ролевая игра', 'фэнтези'],
    rating: null,
    synopsis: 'Партийная RPG по мотивам D&D: отряд заражённых мозговым паразитом иллитидов пытается остановить вторжение разума в Забытых Королевствах.',
    cover: 'images/covers/baldurs-gate-3-2023.jpg'
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TITLES;
}
