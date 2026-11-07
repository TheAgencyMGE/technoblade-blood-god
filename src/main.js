import { Game } from './game/Game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
const fill = document.getElementById('load-fill');
const label = document.getElementById('load-label');

game.boot((p, file) => {
  fill.style.width = (p * 100).toFixed(1) + '%';
  if (file) label.textContent = 'Loading ' + file.split('/').pop();
}).then(async () => {
  if (new URLSearchParams(location.search).has('test')) (await import('./dev/testkit.js')).installTestKit(game);
  if (new URLSearchParams(location.search).has('capture')) (await import('./dev/trailerCapture.js')).installCapture(game);
  label.textContent = 'The horde awaits.';
  const click = document.getElementById('load-click');
  click.classList.remove('hidden');
  const enter = () => {
    game.audio.resume();
    game.audio.play('gong', { vol: 0.5 });
    document.getElementById('loading').classList.add('gone');
    removeEventListener('pointerdown', enter); removeEventListener('keydown', enter);
  };
  addEventListener('pointerdown', enter); addEventListener('keydown', enter);
}).catch(err => {
  console.error(err);
  label.textContent = 'Failed to load: ' + err.message;
});
