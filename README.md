# Technoblade: The Blood God

A free, open-source 3D wave-survival action game that runs in your browser. Fight endless hordes of skeletons and monsters as the Blood God, with a boss every fifth wave.

**▶ Play it here: https://theagencymge.github.io/technoblade-blood-god/**

> Unofficial fan-made tribute. Not affiliated with or endorsed by Technoblade, his family, or Mojang. *Technoblade never dies.*

## Two combat modes

**Mode I: Arkham Combat.** Third-person free-flow swordplay. Read the horde, counter on the flash, chain combos into cinematic finishers, then switch to the bow, four abilities and Blood God mode.

**Mode II: Parkour Combat.** Momentum-based movement: wall-running, sliding, double jumps, air dashes and ground slams. Your sword hits harder the faster you move. It has first- and third-person views (press **C**) and slow-motion aiming in mid-air.

Each mode keeps its own high scores. Every key can be rebound in **Settings**.

## Controls (defaults)

| Action | Mode I: Arkham | Mode II: Parkour |
| --- | --- | --- |
| Move | WASD / arrow keys | WASD / arrow keys |
| Attack | Left mouse | Left mouse |
| Bow | Hold right mouse to aim, hold and release left mouse to fire | Same |
| Sprint | Shift | Shift |
| Jump | C / Left Ctrl | Space (again in the air for a double jump) |
| Dodge | Space | — |
| Counter | F | — |
| Heavy attack / launcher | E / V | — |
| Finisher | X | — |
| Blood God | Q | F |
| Abilities | 1, 2, 3, 4 | — |
| Slide | — | Left Ctrl / V |
| Dash / ground slam | — | E / Q |
| 1st / 3rd person | — | C |
| Lock on | Tab / T | Tab |
| Pause | Esc / P | Esc / P |

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # static build in dist/, works from any folder or subpath
```

### Windows desktop build (optional)

`desktop/` wraps the web build in Electron:

```bash
npm run build
cp -r dist desktop/dist
cd desktop
npm install
npm run package    # writes release/Technoblade - The Blood God-win32-x64/
```

## Tech

[Three.js](https://threejs.org) (r170) and [Vite](https://vitejs.dev). There are no game engines and no frameworks. Collision, enemy AI with flow-field pathfinding, the free-flow combat system, parkour movement, post-processing and the UI are all written from scratch in plain JavaScript modules under `src/`.

## Credits and licenses

All art, audio and fonts are existing free assets by their original creators (mostly CC0), listed in [CREDITS.md](CREDITS.md) and in the in-game Credits screen. The game's source code is released under the [MIT License](LICENSE). The third-party assets in `public/assets/` keep their own licenses as listed in CREDITS.md.
