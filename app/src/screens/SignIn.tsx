import { ASSET_ROOT } from '../config';
import { resolveCover } from '../lib/covers';
import { Button } from '../ui/Button';
import { useIsDesktop } from '../ui/useMediaQuery';
import s from './SignIn.module.css';

// Real posters from the repo, so the first screen already looks like the app.
// The phone shows the first 16 (four rows of four); desktop shows all 36.
// Only the shown ones are rendered: a hidden <img> still downloads.
const WALL = [
  'frieren-2023.jpg', 'the-boys-2019.jpg', 'baldurs-gate-3-2023.jpg', 'the-apothecary-diaries-2023.jpg',
  'spider-man-across-the-spider-verse-2023.jpg', 'clair-obscur-expedition-33-2025.webp', 'the-batman-2022.jpg', 'blue-eye-samurai-2023.jpg',
  'drive-2011.jpg', 'stardew-valley-2016.jpg', 'ted-lasso-2020.jpg', 'suzume-2022.jpg',
  'cyberpunk-edgerunners-2022.jpg', 'split-fiction-2025.jpg', 'the-legend-of-vox-machina-2022.jpg', 'alien-romulus-2024.jpg',
  'your-name-2016.png', 'portal-2-2011.jpg', 'moon-knight-2022.webp', 'the-gentlemen-2019.jpg', 'violet-evergarden-2018.png', 'it-takes-two-2021.jpg',
  'guardians-of-the-galaxy-2014.jpg', 'demon-slayer-kimetsu-no-yaiba-2019.jpg', 'fight-club-1999.jpg', 'castlevania-2017.jpg',
  'barbie-2023.jpg', 'hell-s-paradise-jigokuraku-2023.jpg', 'stranger-things-2016.jpg', 'divinity-original-sin-ii-2017.jpg',
  'snatch-2000.jpg', 'a-silent-voice-2016.jpg', 'thor-ragnarok-2017.jpg', 'spiritfarer-farewell-edition-2021.jpg',
  'baby-driver-2017.jpg', 'tengen-toppa-gurren-lagann-2007.png'
];

export function SignIn({ onSignIn }: { onSignIn: () => void }) {
  const wall = useIsDesktop() ? WALL : WALL.slice(0, 16);
  return (
    <div className={s.screen}>
      <div className={s.wall} aria-hidden="true">
        {wall.map((file) => <img key={file} src={resolveCover('images/covers/' + file, ASSET_ROOT)} alt="" className={s.poster} />)}
      </div>
      <div className={s.fade} aria-hidden="true" />
      <div className={s.content}>
        <h1 className={s.title}>Бэклог</h1>
        <p className={s.text}>Игры, сериалы, кино и аниме, до которых хочется добраться. Для себя и вместе с друзьями.</p>
        <Button size="lg" className={s.cta} onClick={onSignIn}>Войти через Google</Button>
        <p className={s.note}>Вход по приглашению</p>
      </div>
    </div>
  );
}
