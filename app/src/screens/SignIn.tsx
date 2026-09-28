import { ASSET_ROOT } from '../config';
import { resolveCover } from '../lib/covers';
import { Button } from '../ui/Button';
import s from './SignIn.module.css';

// Real posters from the repo, so the first screen already looks like the app.
const WALL = [
  'frieren-2023.jpg', 'the-boys-2019.jpg', 'baldurs-gate-3-2023.jpg', 'the-apothecary-diaries-2023.jpg',
  'spider-man-across-the-spider-verse-2023.jpg', 'clair-obscur-expedition-33-2025.webp', 'the-batman-2022.jpg', 'blue-eye-samurai-2023.jpg',
  'drive-2011.jpg', 'stardew-valley-2016.jpg', 'ted-lasso-2020.jpg', 'suzume-2022.jpg',
  'cyberpunk-edgerunners-2022.jpg', 'split-fiction-2025.jpg', 'the-legend-of-vox-machina-2022.jpg', 'alien-romulus-2024.jpg'
];

export function SignIn({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className={s.screen}>
      <div className={s.wall} aria-hidden="true">
        {WALL.map((file) => <img key={file} src={resolveCover('images/covers/' + file, ASSET_ROOT)} alt="" className={s.poster} />)}
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
