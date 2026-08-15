# Pocket Pool

*Big Fun. Small Table. Endless Game.*

A browser-based 3D pool (8-ball) game built with Three.js and Cannon-es physics, playable solo against an AI opponent or with up to 4 players over a lobby code.

## Features

- **Real 3D physics** — Cannon-es-driven ball collisions, cushions, and pockets, with continuous collision detection so fast shots don't tunnel through the rails.
- **Single player vs. computer** — four difficulties (Easy / Medium / Hard / Insane), powered by a headless hill-climbing shot search that plays out candidate shots in an invisible physics simulation before committing to the best one.
- **Multiplayer** — create or join a lobby with a 4-character code, up to 4 players per match. The host's client is authoritative for shot outcomes, so every player's scores/turns/pots stay in sync even though each client renders shots locally.
- **Full 8-ball rules** — suit assignment on first legal pot (2-player), fouls, ball-in-hand placement, and win/loss detection.
- **Responsive** — playable on desktop, tablet, and phone; touch devices are locked to landscape (with a "rotate your device" prompt in portrait) since a pool table needs the width.

## Tech stack

| Layer | Tech |
|---|---|
| Rendering | [Three.js](https://threejs.org/) |
| Physics | [Cannon-es](https://github.com/pmndrs/cannon-es) |
| Multiplayer transport | [Socket.io](https://socket.io/) |
| Backend | Node.js + Express |
| Client | Plain ES modules (no build step — loaded via an import map) |

## Project structure

```
pool game/
├── client/                 # Static 3D game client — deploy this folder as-is
│   ├── index.html
│   ├── devserver.py        # local-dev-only static server with no-cache headers
│   ├── assets/              # sprites/sounds carried over from the original 2D prototype
│   ├── public/              # logo (used for the favicon)
│   └── src/
│       ├── main.js
│       ├── config.js         # server URL, max players
│       ├── core/              # screen router
│       ├── game/              # physics, rules, AI, cue controls, 3D scene, match orchestrator
│       ├── net/                # Socket.io client wrapper
│       └── screens/            # welcome, credits, lobby, single/multiplayer HUD, etc.
├── server/                 # Multiplayer lobby + shot-relay server — deploy to Render
│   ├── index.js
│   ├── rooms.js
│   ├── package.json
│   └── render.yaml
├── LICENSE.txt
└── README.md
```

## Running locally

**Client** (any static file server works — no build step):

```bash
npx http-server client -p 5500
```

Or use the included no-cache dev server:

```bash
python client/devserver.py 5500
```

Then open `http://localhost:5500`.

**Server** (only needed for multiplayer):

```bash
cd server
npm install
npm start
```

Runs on `http://localhost:3001` by default. The client automatically points at `localhost:3001` when it detects it's running on `localhost` itself (see `client/src/config.js`).

## Deploying

- **Server**: push the `server/` folder to a repo and deploy to [Render](https://render.com/) — `render.yaml` is already set up (build: `npm install`, start: `npm start`). Once deployed, update `SERVER_URL` in `client/src/config.js` to your Render URL.
- **Client**: deploy the `client/` folder as-is to any static host (Render static site, Netlify, Vercel, GitHub Pages, etc.) — it's plain HTML/CSS/JS with no build step.

## Controls

- **Left-drag** (or one finger) — aim the cue. Watch the dotted guide line for the shot path.
- **Right-drag** (or two fingers) — orbit the camera.
- **Hold Space** (or the on-screen "Hold to Shoot" button on touch) — charge your shot; release to strike.
- **Click the table** — place the cue ball after a foul (ball in hand).

## License

All rights reserved — see [LICENSE.txt](LICENSE.txt).

## Credits

Developed by **Areen Sharma** — game design, development, UI/UX, and audio integration. August 2026.
