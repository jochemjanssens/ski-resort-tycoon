// Static game data: map constants, lift/building catalogues, research tree, goals.

const MAP_W = 80;
const MAP_H = 66;
const TILE = 16;           // world pixels per tile
const TILE_M = 50;         // metres per tile (horizontal)
const VILLAGE_ROWS = 8;
const VILLAGE_Y = MAP_H - VILLAGE_ROWS;
const BASE_ALT = 1200;
const ENTRANCE = { x: Math.floor(MAP_W / 2), y: MAP_H - 1 };

const DAY_START = 8 * 60;
const OPEN_TIME = 8 * 60 + 30;
const CLOSE_TIME = 16 * 60 + 30;
const DAY_END = 17 * 60 + 30;
const DAYS_PER_SEASON = 40;

// Slope grade thresholds (rise/run) for piste difficulty.
const GRADE_LIMITS = [0.2, 0.36, 0.55, 0.9];
const DIFFS = [
  { name: 'Green', color: '#22b14c' },
  { name: 'Blue', color: '#1f6feb' },
  { name: 'Red', color: '#e5322d' },
  { name: 'Black', color: '#111111' },
];
const SKILLS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
const GUEST_KINDS = { adult: 'Skier', kid: 'Kid', board: 'Snowboarder' };

const LIFT_TYPES = {
  rope: {
    name: 'Rope Tow', icon: '🪢', baseCost: 1500, perTile: 40, maxLen: 14, speed: 2.4,
    seats: 1, interval: 0.2, upkeep: 40, quality: 0.6, color: '#b5651d', rest: 0,
    wear: 0.6, drag: true, desc: 'Cheap and short. Perfect for beginner slopes.',
  },
  tbar: {
    name: 'T-Bar', icon: '⚓', baseCost: 4500, perTile: 80, maxLen: 26, speed: 3,
    seats: 2, interval: 0.25, upkeep: 90, quality: 0.8, color: '#d4a017', rest: 0,
    wear: 0.8, drag: true, desc: 'Drag lift with decent capacity and length.',
  },
  chair2: {
    name: 'Double Chair', icon: '🪑', baseCost: 10000, perTile: 160, maxLen: 42, speed: 3.6,
    seats: 2, interval: 0.2, upkeep: 180, quality: 1.0, color: '#2b6cb0', rest: 4,
    wear: 1, desc: 'Classic chairlift. Guests rest a little on the way up.',
  },
  chair4: {
    name: 'Quad Chair', icon: '💺', baseCost: 22000, perTile: 260, maxLen: 56, speed: 4.6,
    seats: 4, interval: 0.2, upkeep: 350, quality: 1.25, color: '#6b46c1', rest: 6,
    wear: 1.2, desc: 'High-speed detachable quad. Huge capacity.',
  },
  gondola: {
    name: 'Gondola', icon: '🚡', baseCost: 45000, perTile: 420, maxLen: 80, speed: 6,
    seats: 8, interval: 0.4, upkeep: 600, quality: 1.6, color: '#c53030', rest: 12,
    wear: 1.3, desc: 'Fast, warm cabins all the way to the summit.',
  },
};

const BUILDING_TYPES = {
  cafe: {
    name: 'Café', icon: '☕', size: 1, cost: 2500, upkeep: 60, kind: 'food', capacity: 6,
    duration: 15, priceKey: 'food', priceMult: 1, where: 'any', color: '#8b5a2b',
    desc: 'Hot chocolate and snacks. Place next to a piste or in the village.',
  },
  restaurant: {
    name: 'Restaurant', icon: '🍽️', size: 2, cost: 9000, upkeep: 180, kind: 'food', capacity: 24,
    duration: 35, priceKey: 'food', priceMult: 2.4, where: 'any', color: '#a0522d',
    desc: 'Big mountain hut. Guests love a long lunch.',
  },
  rental: {
    name: 'Ski Rental', icon: '🎿', size: 1, cost: 3000, upkeep: 70, kind: 'rental',
    priceKey: 'rental', where: 'village', color: '#2f855a',
    desc: 'Guests without gear rent skis here. Village only.',
  },
  school: {
    name: 'Ski School', icon: '🧑‍🏫', size: 1, cost: 4000, upkeep: 150, kind: 'school', capacity: 12,
    duration: 60, priceKey: 'school', where: 'village', color: '#d53f8c',
    desc: 'Beginners take lessons and improve their skill. Village only.',
  },
  parking: {
    name: 'Car Park', icon: '🅿️', size: 2, cost: 3500, upkeep: 40, kind: 'parking',
    where: 'village', color: '#555',
    desc: '+100 guest capacity. Village only.',
  },
  hotel: {
    name: 'Hotel', icon: '🏨', size: 2, cost: 30000, upkeep: 400, kind: 'hotel',
    where: 'village', color: '#7b341e',
    desc: '+60 capacity, more visitors and nightly room income.',
  },
  cannon: {
    name: 'Snow Cannon', icon: '❄️', size: 1, cost: 1800, upkeep: 50, kind: 'cannon',
    where: 'mountain', color: '#4a90d9',
    desc: 'Makes snow overnight on pistes within 3 tiles. Snowmaking costs water and power per cm — set it in the Snow panel.',
  },
  groomer: {
    name: 'Groomer Garage', icon: '🚜', size: 1, cost: 6000, upkeep: 200, kind: 'groomer',
    where: 'village', color: '#c05621',
    desc: 'Its snowcat grooms up to 260 piste tiles back to corduroy each night. Build more for bigger resorts.',
  },
  park: {
    name: 'Terrain Park', icon: '🏂', size: 2, cost: 7000, upkeep: 120, kind: 'park', capacity: 12,
    duration: 10, where: 'mountain', color: '#e8590c',
    desc: 'Jumps, rails and a halfpipe. Snowboarders and good skiers stop here. Place next to a piste.',
  },
  square: {
    name: 'Village Square', icon: '⛲', size: 2, cost: 8000, upkeep: 80, kind: 'square', where: 'village', color: '#9aa3ad',
    desc: 'A paved square with a clock tower and the ticket office. Makes nearby plots worth more and gives the village a heart.',
  },
  // Built by private developers on land you zone (not in the build menu). Levels: busy, valuable plots upgrade.
  chalet: {
    name: 'Chalet', icon: '🏡', size: 1, cost: 0, upkeep: 0, kind: 'lodging', zone: 1, beds: 6, buyout: 6000,
    where: 'village', color: '#8b5a2b', private: true, minRep: 25, levels: ['Chalet', 'Guesthouse', 'Chalet Hotel'],
    desc: 'A private holiday chalet. Its guests stay for several days and it pays you a lease for every occupied bed.',
  },
  apartments: {
    name: 'Apartments', icon: '🏢', size: 2, cost: 0, upkeep: 0, kind: 'lodging', zone: 1, beds: 26, buyout: 30000,
    where: 'village', color: '#7a6248', private: true, minRep: 45, minGuests: 100, levels: ['Apartments', 'Residence', 'Grand Residence'],
    desc: 'A private apartment block. Lots of beds close to the lifts.',
  },
  lodge: {
    name: 'Boutique Lodge', icon: '🛎️', size: 2, cost: 0, upkeep: 0, kind: 'lodging', zone: 1, beds: 16, lux: true, buyout: 45000,
    where: 'village', color: '#6b3a2a', private: true, minRep: 65, minGuests: 180, levels: ['Boutique Lodge', 'Mountain Lodge', 'Luxury Spa Lodge'],
    desc: 'A luxury lodge. Wealthy guests who happily pay more for everything.',
  },
  shop: {
    name: 'Sports Shop', icon: '🛍️', size: 1, cost: 0, upkeep: 0, kind: 'shop', zone: 2, shopLease: 12, capacity: 6, duration: 12, spend: 20,
    buyout: 8000, where: 'village', color: '#3d7ea6', private: true, minRep: 30, levels: ['Sports Shop', 'Ski Boutique', 'Flagship Store'],
    desc: 'A privately run sports shop. Guests browse it during the day and in the evening; you get a cut of its sales.',
  },
  apres: {
    name: 'Après-ski Hut', icon: '🍻', size: 1, cost: 0, upkeep: 0, kind: 'evening', zone: 2, shopLease: 8, capacity: 22, duration: 35, spend: 18,
    buyout: 7000, where: 'village', color: '#9c4f2a', private: true, minRep: 25, levels: ['Après-ski Hut', 'Après-ski Bar', 'Après Club'],
    desc: 'Music, mulled wine and a sunny terrace. Overnight guests come here after the lifts close.',
  },
  bistro: {
    name: 'Bistro', icon: '🍷', size: 1, cost: 0, upkeep: 0, kind: 'evening', zone: 2, shopLease: 10, capacity: 16, duration: 45, spend: 32,
    buyout: 9000, where: 'village', color: '#7d2e3a', private: true, minRep: 40, levels: ['Bistro', 'Brasserie', 'Fine Dining'],
    desc: 'Evening dining for guests staying in the village.',
  },
  garage: {
    name: 'Car Park', icon: '🅿️', size: 2, cost: 0, upkeep: 0, kind: 'garage', zone: 3, spaces: 90, shopLease: 8, buyout: 12000,
    where: 'village', color: '#7b8088', private: true, minRep: 0, levels: ['Private Car Park', 'Parking Deck', 'Parking Garage'],
    desc: 'A private car park. More day visitors can come; the operator pays you a lease.',
  },
};

// Snow per tile in cm. Pistes under bareBelow close; under thinBelow they ski badly.
const SNOW = {
  bareBelow: 8, thinBelow: 30,
  cannonRate: 25,        // cm a cannon adds per night to each covered piste tile
  costPerCm: 0.35,       // water and power per tile per cm
  groomPerGarage: 260,   // tiles one snowcat grooms per night
  groomCost: 1.2,        // fuel per tile groomed
  modes: { off: 'Off', auto: 'Top up', max: 'Full power' },
};

// Freeride zones: ungroomed off-piste terrain for advanced and expert skiers.
const FREERIDE = { cost: 12, minSkill: 2, blastCost: 6, patrolPer: 120 };
const AVY_LEVELS = ['', 'Low', 'Moderate', 'Considerable', 'High', 'Very high'];
const AVY_COLORS = ['', '#7ee08a', '#ffd43b', '#ff922b', '#ff5c4d', '#c92a2a'];

// Skier progression: runs (and lessons) earn experience; enough of it moves a guest up a level.
const SKILL_XP = [10, 40, 100];
const REGULARS_MAX = 400;
const PASS = { sellUntil: 12, defaultPrice: 420 };

// Zones the player paints in the village (and on gentle land around it); developers only build inside them.
const ZONES = {
  1: { key: 'lodging', name: 'Lodging', icon: '🛏️', color: '#4caf50', types: ['chalet', 'apartments', 'lodge'] },
  2: { key: 'shops', name: 'Shops & dining', icon: '🛍️', color: '#2f8fd8', types: ['shop', 'apres', 'bistro'] },
  3: { key: 'parking', name: 'Parking', icon: '🅿️', color: '#8a929e', types: ['garage'] },
};
// Land: the map is split into parcels; the resort starts with a few and buys neighbouring ones.
const PARCEL = 8;
const PARCELS_X = Math.ceil(MAP_W / PARCEL);
const PARCELS_Y = Math.floor(MAP_H / PARCEL);   // the bottom row of parcels takes the leftover rows
const LAND = { base: 1500, perTile: 25, alt: 600, growth: 0.05 };

const ZONE_COST = 6;
const PATH_COST = 10;
const LEVEL_MULT = [0, 1, 1.6, 2.3];   // beds, capacity and lease per building level
const HAMLET_RANGE = 4;                // zoning allowed this close to a lift station on the mountain
const VILLAGE_SPREAD = 8;              // and this many rows up the gentle slope above the village

// Private village growth. Lease is what developers pay you per occupied bed per night.
const VILLAGE_LEASE = {
  low: { name: 'Low', perBed: 7, growth: 1.7 },
  normal: { name: 'Normal', perBed: 12, growth: 1 },
  high: { name: 'High', perBed: 19, growth: 0.45 },
};

const STAFF_TYPES = {
  mechanic: { name: 'Mechanic', icon: '🔧', wage: 150, per: 3, desc: 'Inspects and repairs lifts. One mechanic covers 3 lifts.' },
  patrol: { name: 'Ski Patrol', icon: '⛑️', wage: 180, per: 4, desc: 'Rescues injured skiers and blasts avalanches. One patroller covers 4 lifts.' },
  instructor: { name: 'Instructor', icon: '🧑‍🏫', wage: 120, per: 4, desc: 'Teaches at the ski school. Each instructor teaches 4 guests at once.' },
};
const START_STAFF = { mechanic: 1, patrol: 1, instructor: 0 };

const CAMPAIGNS = {
  radio: { name: 'Radio ads', icon: '📻', cost: 2000, days: 5, demand: 0.25, desc: '+25% visitors for 5 days.' },
  social: { name: 'Powder alerts', icon: '📱', cost: 1200, days: 4, demand: 0.15, powder: 0.35, desc: '+15% visitors for 4 days, +50% on fresh-snow days.' },
  family: { name: 'Family weeks', icon: '👨‍👩‍👧', cost: 3000, days: 7, demand: 0.15, kids: 0.25, desc: '+15% visitors and many more kids for 7 days.' },
  board: { name: 'Snowboard festival', icon: '🏂', cost: 4000, days: 5, demand: 0.2, boards: 0.3, requires: 'park', desc: '+20% visitors and lots of snowboarders for 5 days.' },
  tv: { name: 'TV commercial', icon: '📺', cost: 12000, days: 10, demand: 0.5, desc: '+50% visitors for 10 days.' },
};

// Events you schedule a few days ahead. They need certain facilities and pay off if guests leave happy.
const EVENTS = {
  race: {
    name: 'Ski race', icon: '🏁', cost: 8000, prep: 1, days: 1, demand: 0.6, experts: 0.3, sponsor: 0, rep: [5, 2], cooldown: 5,
    req: ['redblack'], desc: 'A slalom on a red or black run. Lots of experts come to race and watch.',
  },
  torch: {
    name: 'Torchlight parade', icon: '🔥', cost: 3000, prep: 1, days: 1, demand: 0.35, kids: 0.2, sponsor: 0, rep: [3, 1], cooldown: 6,
    req: ['night'], desc: 'Instructors ski down in the dark carrying torches. Families love it.',
  },
  festival: {
    name: 'Winter food festival', icon: '🎪', cost: 5000, prep: 2, days: 2, demand: 0.45, food: true, sponsor: 3000, rep: [4, 2], cooldown: 10,
    req: ['food3'], desc: 'Two days of street food in the village. Guests eat more and forgive higher food prices.',
  },
  bigair: {
    name: 'Big-air contest', icon: '🤸', cost: 6000, prep: 2, days: 1, demand: 0.5, boards: 0.35, sponsor: 5000, rep: [4, 2], cooldown: 8,
    req: ['park'], desc: 'Pros fly off a giant kicker in your terrain park. Snowboarders flock in.',
  },
  freeride: {
    name: 'Freeride Tour stop', icon: '🏔️', cost: 15000, prep: 3, days: 1, demand: 0.7, experts: 0.45, sponsor: 14000, rep: [6, 3], cooldown: 15,
    req: ['free40', 'rating60'], desc: 'The world\'s best freeriders drop into your backcountry. Needs a big freeride zone.',
  },
  worldcup: {
    name: 'World Cup weekend', icon: '🏆', cost: 40000, prep: 5, days: 2, demand: 1.2, experts: 0.3, sponsor: 70000, rep: [10, 6], cooldown: 30,
    req: ['black400', 'bigLift', 'hotel', 'rating70'], desc: 'Two days of TV-broadcast downhill racing. Huge crowds, a huge sponsor cheque — and a huge embarrassment if it goes wrong.',
  },
};
const EVENT_REQS = {
  redblack: { text: 'An open red or black piste', check: () => S.cache.diffSet.has(2) || S.cache.diffSet.has(3) },
  night: { text: 'Night skiing switched on', check: () => S.night.on },
  food3: { text: '3 cafés or restaurants', check: () => countB('cafe') + countB('restaurant') >= 3 },
  park: { text: 'A terrain park', check: () => countB('park') > 0 },
  free40: { text: 'A freeride zone of 40+ tiles', check: () => freerideTiles() >= 40 },
  black400: { text: 'A lift rising 400 m with a black run', check: () => S.lifts.some(l => l.usable && l.vert >= 400 && l.maxRd >= 3) },
  bigLift: { text: 'A quad chair or gondola', check: () => S.lifts.some(l => l.type === 'chair4' || l.type === 'gondola') },
  hotel: { text: 'A hotel or lodge for the teams', check: () => countB('hotel') + countB('lodge') > 0 },
  rating60: { text: 'Resort rating 60%+', check: () => S.reputation >= 60 },
  rating70: { text: 'Resort rating 70%+', check: () => S.reputation >= 70 },
};

const NIGHT_SKIING = { cost: 25000, upkeep: 600, close: 20 * 60 };

const SCENARIOS = {
  alpine: {
    name: 'Alpine Valley', icon: '🏔️', money: 30000, maxLoan: 60000, snow: 70, snowMult: 1, melt: 1,
    terrain: { vert: 1150, bumps: 200, tree: 0 }, unlock: [],
    desc: 'A balanced mountain with forests and a rocky summit. The classic start.',
  },
  shoestring: {
    name: 'Shoestring Start', icon: '🪙', money: 8000, maxLoan: 20000, snow: 70, snowMult: 1, melt: 1,
    terrain: { vert: 1150, bumps: 200, tree: 0 }, unlock: [],
    desc: 'Same kind of valley, but only $8,000 in the bank and a small loan limit. Every dollar counts.',
  },
  glacier: {
    name: 'Glacier Peak', icon: '🧊', money: 45000, maxLoan: 80000, snow: 110, snowMult: 1.4, melt: 0.5,
    terrain: { vert: 1600, bumps: 260, tree: -250 }, unlock: [],
    desc: 'Huge, steep and snowy. Few trees, lots of black terrain. Hard to find gentle runs.',
  },
  hills: {
    name: 'Warm Hills', icon: '🌤️', money: 35000, maxLoan: 60000, snow: 40, snowMult: 0.55, melt: 2,
    terrain: { vert: 720, bumps: 140, tree: 180 }, unlock: ['building:cannon'],
    desc: 'Gentle, forested low hills with unreliable snow. Snow cannons are unlocked from the start — you will need them.',
  },
};

const RESEARCH = [
  { id: 'tbar', name: 'T-Bar', unlock: 'lift:tbar', points: 3000 },
  { id: 'groomer', name: 'Groomer Garage', unlock: 'building:groomer', points: 3000 },
  { id: 'school', name: 'Ski School', unlock: 'building:school', points: 4000 },
  { id: 'cannon', name: 'Snow Cannons', unlock: 'building:cannon', points: 5000 },
  { id: 'restaurant', name: 'Restaurant', unlock: 'building:restaurant', points: 8000 },
  { id: 'park', name: 'Terrain Park', unlock: 'building:park', points: 6000 },
  { id: 'night', name: 'Night Skiing', unlock: 'upgrade:night', points: 15000, requires: 'chair2' },
  { id: 'chair2', name: 'Double Chairlift', unlock: 'lift:chair2', points: 10000, requires: 'tbar' },
  { id: 'hotel', name: 'Hotel', unlock: 'building:hotel', points: 20000, requires: 'restaurant' },
  { id: 'chair4', name: 'Quad Chairlift', unlock: 'lift:chair4', points: 25000, requires: 'chair2' },
  { id: 'gondola', name: 'Gondola', unlock: 'lift:gondola', points: 50000, requires: 'chair4' },
];
const RESEARCH_FUNDING = [0, 200, 500, 1000, 2500, 5000, 10000]; // dollars (= points) per day
const START_UNLOCKED = ['lift:rope', 'building:cafe', 'building:rental', 'building:parking', 'building:square'];

const PISTE_COST = 20;
const TREE_CLEAR_COST = 30;

const DEFAULT_PRICES = { ticket: 30, food: 8, rental: 25, school: 40, pass: 420 };
const FAIR_PRICES = { food: 8, rental: 25, school: 40 };

const THOUGHTS = {
  queue: { text: "I've been waiting in this queue for ages", good: false },
  too_hard: { text: 'That run was way too difficult for me!', good: false },
  great_run: { text: 'What a fantastic run!', good: true },
  nice_run: { text: 'Nice run', good: true },
  boring: { text: 'These slopes are too easy for me', good: false },
  icy: { text: 'The snow is icy and scraped', good: false },
  powder: { text: 'Fresh powder today!', good: true },
  hungry: { text: "I'm hungry and can't find food", good: false },
  tired: { text: "I'm exhausted, time to head home", good: true },
  food_good: { text: 'That food was delicious!', good: true },
  food_pricey: { text: 'The food here is expensive', good: false },
  no_rental: { text: "There's nowhere to rent skis!", good: false },
  rental_pricey: { text: 'Ski rental is a rip-off', good: false },
  nothing: { text: "There's nothing here I can ski", good: false },
  stuck: { text: "I'm stuck up here with no way down!", good: false },
  lesson: { text: 'The ski school really helped me!', good: true },
  good_value: { text: 'The lift pass is good value', good: true },
  pricey_pass: { text: 'The lift pass was expensive', good: false },
  comfy: { text: 'Nice to rest on the lift', good: true },
  crowded: { text: "It's too crowded here", good: false },
  drag_board: { text: 'Drag lifts are a pain on a snowboard', good: false },
  park_fun: { text: 'The terrain park is awesome!', good: true },
  broken: { text: 'The lift broke down!', good: false },
  stuck_lift: { text: "I'm stuck on a broken lift!", good: false },
  injured: { text: 'Ouch! I crashed and got hurt', good: false },
  rescued: { text: 'Ski patrol was there in no time', good: true },
  slow_rescue: { text: 'It took ages for ski patrol to come', good: false },
  avalanche: { text: 'Some pistes are closed for avalanche danger', good: false },
  race: { text: 'Watching the ski race was great!', good: true },
  night: { text: 'Night skiing under the lights is magical!', good: true },
  no_lesson: { text: "The ski school has no instructors", good: false },
  level_up: { text: "I'm getting so much better at this!", good: true },
  regular: { text: 'Good to be back at my favourite resort', good: true },
  pass: { text: 'My season pass is paying for itself', good: true },
  freeride: { text: 'Fresh tracks in the backcountry!', good: true },
  tracked: { text: 'The off-piste is all tracked out', good: false },
  moguls: { text: 'Those moguls were brutal — loved it!', good: true },
  thin: { text: 'The snow is so thin, I hit rocks', good: false },
  bare: { text: 'Half the pistes are closed — no snow', good: false },
  corduroy: { text: 'Perfect corduroy this morning', good: true },
  event: { text: 'What an event — great atmosphere!', good: true },
  avy_caught: { text: 'I got caught in an avalanche!', good: false },
  chalet: { text: 'Our chalet is right by the lifts', good: true },
  skiin: { text: 'Ski-in, ski-out from our chalet — perfect!', good: true },
  long_walk: { text: 'It is a long walk from our room to the lifts', good: false },
  apres: { text: 'Après-ski in the village was great fun!', good: true },
  dinner: { text: 'Lovely dinner in the village tonight', good: true },
  shopping: { text: 'Found some great gear in the village shop', good: true },
  no_evening: { text: "There's nothing to do in the village at night", good: false },
  village_nice: { text: 'What a charming village', good: true },
  staying: { text: 'Back on the slopes for another day!', good: true },
};

const GOALS = [
  { id: 'g1', text: 'Have 40 guests visit in one day', reward: 3000, check: s => s.stats.guestsToday >= 40 },
  { id: 'g2', text: 'Build a Café', reward: 1500, check: s => s.buildings.some(b => b.type === 'cafe') },
  { id: 'g3', text: 'Research the T-Bar', reward: 2000, check: s => s.research.unlocked.has('lift:tbar') },
  { id: 'g4', text: 'Open pistes of 3 different difficulties', reward: 5000, check: s => s.cache.diffsOpen >= 3 },
  { id: 'g5', text: 'Have 120 guests visit in one day', reward: 8000, check: s => s.stats.guestsToday >= 120 },
  { id: 'g6', text: 'Reach a 70% resort rating', reward: 8000, check: s => s.reputation >= 70 },
  { id: 'g7', text: 'Build a chairlift', reward: 10000, check: s => s.lifts.some(l => l.type === 'chair2' || l.type === 'chair4') },
  { id: 'g8', text: 'Make $10,000 profit in a single day', reward: 15000, check: s => s.stats.lastDayProfit >= 10000 },
  { id: 'g9', text: 'Have 300 guests visit in one day', reward: 20000, check: s => s.stats.guestsToday >= 300 },
  { id: 'g10', text: 'Build a Gondola', reward: 25000, check: s => s.lifts.some(l => l.type === 'gondola') },
  { id: 'g10b', text: 'Sell 100 season passes', reward: 20000, check: s => (s.passesSold || 0) >= 100 },
  { id: 'g10c', text: 'Host a successful World Cup weekend', reward: 40000, check: s => !!(s.eventWins && s.eventWins.worldcup) },
  { id: 'g11', text: 'Have 600 guests in a day with an 80% rating', reward: 100000, final: true,
    check: s => s.stats.guestsToday >= 600 && s.reputation >= 80 },
];

const FIRST_NAMES = ['Anna', 'Ben', 'Clara', 'David', 'Emma', 'Felix', 'Greta', 'Hugo', 'Ida', 'Jonas', 'Kai', 'Lena',
  'Max', 'Nina', 'Oscar', 'Paula', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Ugo', 'Vera', 'Willem', 'Xena', 'Yara', 'Zoe',
  'Lars', 'Mia', 'Noah', 'Eva', 'Finn', 'Sofie', 'Luca', 'Julia', 'Tom', 'Fleur', 'Bram', 'Lotte', 'Sven', 'Elin'];
const JACKET_COLORS = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce', '#805ad5', '#d53f8c', '#00b5d8',
  '#1a202c', '#f56565', '#48bb78', '#ed64a6'];

const WEATHER = {
  sunny: { name: 'Sunny', icon: '☀️', mult: 1.2, snow: 0, melt: 1 },
  cloudy: { name: 'Cloudy', icon: '☁️', mult: 1.0, snow: 0, melt: 0 },
  snow: { name: 'Snowing', icon: '🌨️', mult: 0.9, snow: 18, melt: 0 },
  storm: { name: 'Blizzard', icon: '🌪️', mult: 0.45, snow: 40, melt: 0 },
  warm: { name: 'Warm spell', icon: '🌡️', mult: 0.85, snow: 0, melt: 6 },
};
