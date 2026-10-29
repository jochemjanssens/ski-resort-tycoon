# Ski Resort Tycoon

A browser management game in the spirit of RollerCoaster Tycoon: turn an empty valley into a busy ski resort, drawn in real 3D with three.js.

## Play

No build step. The only dependency is [three.js](https://threejs.org), loaded from a CDN, so the first load needs an internet connection. Open `index.html` in a browser, or serve the folder:

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
- **Regulars and progression**: guests improve with every run and lesson and can move up a skill level. Happy guests come back as regulars with their skill and loyalty, so over the seasons your crowd wants harder terrain. Loyal regulars buy **season passes** in the first 12 days of each season (set the price in 🎟️ Prices).
- **Snow** ❄️: every tile has its own snow depth. Snow falls more up high, melts faster low down and late in the season, and busy pistes get scraped thin. Pistes under 8 cm close. **Snow cannons** top pistes up overnight (Off / Top up to a target / Full power, paid per cm). Each **Groomer Garage** snowcat grooms the busiest 260 tiles a night, and you can leave black runs ungroomed for moguls.
- **Freeride zones** 🏔️: mark ungroomed off-piste slopes and forest. Advanced and expert skiers seek out untracked powder, which gets tracked out through the day and refills with fresh snow. Fresh snow raises the avalanche danger (1–5): blast the slopes, hire enough ski patrol, or close the zones, or risk a slide.
- **Events** 🚩: book a ski race, torchlight parade, food festival, big-air contest, Freeride Tour stop or a two-day World Cup weekend. Each has requirements and a few days of preparation, brings crowds, and pays off in rating and sponsorship if guests leave happy.
- **Village** 🏘️: once the resort is busy, liked and well developed, private developers build chalets, sports shops, apartments and boutique lodges. They add beds and pay you a lease every night; set the lease rate to trade growth against income, or buy a building out.
- **Staff** 👷: mechanics (breakdowns and repairs), ski patrol (injuries and avalanche control after big snowfalls), instructors (ski school capacity).
- **Facilities**: cafés, restaurants, terrain park, ski rental, ski school, car parks, hotels, snow cannons, groomer garage.
- **Marketing** 📣: ad campaigns, family weeks, a snowboard festival, and night skiing with floodlights (after research).
- **Rating**: moves slowly each night towards how happy that day's guests were. The 👥 panel shows what departing guests liked and disliked.
- **Advisor** 🧑‍💼: pops up with tips when queues are long, the car park is full, guests are hungry, and so on.
- **3D world**: free camera (pan, turn, tilt, zoom), a sun that crosses the sky with real shadows, fog and weather, floodlit night skiing, chairs and gondolas moving on the cables, and snowcats grooming after closing.
- **Map views** 🗺️: slope difficulty, piste condition, snow depth, skier traffic, lift queues — draped over the terrain — plus a mini-map.
- **Research** 🔬 unlocks better lifts and facilities; **Goals** 🎯 pay cash rewards. The final goal is 600 guests in a day with an 80% rating.

The game saves automatically every night to `localStorage`. You can also save and load from the ☰ menu.

## Controls

| Input | Action |
|---|---|
| Drag (Inspect tool) / middle-drag / WASD / two fingers | Pan |
| Right-drag, Shift+drag, `,` `.`, Page Up/Down, two-finger twist | Turn and tilt the camera |
| Mouse wheel, + / −, pinch | Zoom |
| Home | Reset the camera |
| Space, 1–4 | Pause, game speed |
| Ctrl/⌘+Z or ↩️ | Undo last build |
| Q / P / R / F / L / B / X | Inspect / Piste / Route / Freeride / Lifts / Build / Demolish |
| G, V | Slope view, cycle map views |
| Esc | Cancel |

## Code layout

- `js/data.js`: constants, lift/building catalogues, staff, campaigns, scenarios, research, goals
- `js/terrain.js`: procedural mountain generator
- `js/sim.js`: simulation (pathfinding, guest AI, lifts, staff, economy, undo, save/load)
- `js/resort.js`: snow and grooming, freeride zones and avalanches, regulars and season passes, events, village growth
- `js/render.js`: three.js rendering (terrain, trees, lifts, buildings, guests, lighting), camera and picking, map-view overlay, mini-map
- `js/ui.js`: input (mouse and touch), tools, panels, tutorial
- `js/main.js`: boot and main loop
