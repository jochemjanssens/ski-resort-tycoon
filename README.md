# Ski Resort Tycoon

A browser management game in the spirit of RollerCoaster Tycoon: turn an empty valley into a busy ski resort.

## Play

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
npx http-server . -p 8765
```

Then open http://localhost:8765. It works on desktop and on phones/tablets (pinch to zoom, two-finger pan).

## Scenarios

| Scenario | Start | Challenge |
|---|---|---|
| 🏔️ Alpine Valley | $30,000 | The balanced classic |
| 🪙 Shoestring Start | $8,000 | Tiny budget and loan limit |
| 🧊 Glacier Peak | $45,000 | Steep, snowy, few gentle runs |
| 🌤️ Warm Hills | $35,000 | Gentle hills with unreliable snow; snow cannons unlocked from the start |

A step-by-step tutorial is offered when you start a new resort (and can be replayed from 🎯 Goals).

## How it works

- **Pistes**: paint them with ⛷️, or use 🛣️ **Route**: click a high point and a lower point and the game paints the gentlest line downhill, aiming for the difficulty you pick. A piste's colour comes from the slope.
- **Lifts**: click a bottom station, then a top station. A piste must lead away from the top. Lifts age and break down; refurbish them, or upgrade them in place to a better lift type.
- **Guests**: skiers, kids and snowboarders of four skill levels. They buy a pass if it's worth the price, pick lifts that suit them, spread out over the piste width, get hungry and tired, and sometimes crash.
- **Staff** 👷: mechanics (breakdowns and repairs), ski patrol (injuries and avalanche control after big snowfalls), instructors (ski school capacity).
- **Facilities**: cafés, restaurants, terrain park, ski rental, ski school, car parks, hotels, snow cannons, groomer garage.
- **Marketing** 📣: ad campaigns, family weeks, a snowboard festival, ski races, and night skiing with floodlights (after research).
- **Rating**: moves slowly each night towards how happy that day's guests were. The 👥 panel shows what departing guests liked and disliked.
- **Advisor** 🧑‍💼: pops up with tips when queues are long, the car park is full, guests are hungry, and so on.
- **Map views** 🗺️: slope difficulty, piste condition, snow depth, skier traffic, lift queues — plus a mini-map.
- **Research** 🔬 unlocks better lifts and facilities; **Goals** 🎯 pay cash rewards. The final goal is 600 guests in a day with an 80% rating.

The game saves automatically every night to `localStorage`. You can also save and load from the ☰ menu.

## Controls

| Input | Action |
|---|---|
| Drag (Inspect tool) / right-drag / WASD / two fingers | Pan |
| Mouse wheel, + / −, pinch | Zoom |
| Space, 1–4 | Pause, game speed |
| Ctrl/⌘+Z or ↩️ | Undo last build |
| Q / P / R / L / B / X | Inspect / Piste / Route / Lifts / Build / Demolish |
| G, V | Slope view, cycle map views |
| Esc | Cancel |

## Code layout

- `js/data.js`: constants, lift/building catalogues, staff, campaigns, scenarios, research, goals
- `js/terrain.js`: procedural mountain generator
- `js/sim.js`: simulation (pathfinding, guest AI, lifts, staff, events, economy, undo, save/load)
- `js/render.js`: canvas rendering, map views, mini-map, night lighting
- `js/ui.js`: input (mouse and touch), tools, panels, tutorial
- `js/main.js`: boot and main loop
