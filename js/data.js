// Static game data: map constants, lift/building catalogues, research tree, goals.

const MAP_W = 80;
const MAP_H = 64;
const TILE = 16;           // world pixels per tile
const TILE_M = 50;         // metres per tile (horizontal)
const VILLAGE_ROWS = 6;
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
    desc: 'Keeps pistes within 3 tiles covered with snow.',
  },
  groomer: {
    name: 'Groomer Garage', icon: '🚜', size: 1, cost: 6000, upkeep: 200, kind: 'groomer',
    where: 'village', color: '#c05621',
    desc: 'Grooms every piste back to perfect corduroy each night.',
  },
  park: {
    name: 'Terrain Park', icon: '🏂', size: 2, cost: 7000, upkeep: 120, kind: 'park', capacity: 12,
    duration: 10, where: 'mountain', color: '#e8590c',
    desc: 'Jumps, rails and a halfpipe. Snowboarders and good skiers stop here. Place next to a piste.',
  },
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
  race: { name: 'Host a ski race', icon: '🏁', cost: 8000, days: 1, delay: 1, demand: 0.6, experts: 0.3, requires: 'redblack', desc: 'Tomorrow: +60% visitors and lots of experts. Happy guests boost your rating.' },
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
const START_UNLOCKED = ['lift:rope', 'building:cafe', 'building:rental', 'building:parking'];

const PISTE_COST = 20;
const TREE_CLEAR_COST = 30;

const DEFAULT_PRICES = { ticket: 30, food: 8, rental: 25, school: 40 };
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
