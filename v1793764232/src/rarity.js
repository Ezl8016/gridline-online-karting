// How rare each piece of gear is: hats, helmet designs, visors, suits and
// kart liveries. Shown on every picture card (Garage pickers, the shop),
// and the shop's prices go up with it. Exclusive: one of a kind (an
// account's own, the admins', the beta testers', limited-time ones).

export const TIERS = {
  common: { name: 'Common', colour: '#8a9097' },
  uncommon: { name: 'Uncommon', colour: '#2f9e57' },
  rare: { name: 'Rare', colour: '#2f6fe0' },
  epic: { name: 'Epic', colour: '#8b3fd9' },
  legendary: { name: 'Legendary', colour: '#e39a12' },
  exclusive: { name: 'Exclusive', colour: '#d42a2a' },
};

const by = (o) => Object.fromEntries(Object.entries(o).flatMap(([tier, ids]) => ids.split(' ').map(id => [id, tier])));
const RARITY = {
  hat: by({
    common: 'none beanie bucket beret party chef cone headphones antennae',
    uncommon: 'fedora cowboy grad cat bunny propeller mohawk sharkfin',
    rare: 'cap tophat sombrero wizard viking unicorn halo',
    epic: 'crown',
    exclusive: 'goldcrown fcowboy yarmulke',
  }),
  helmet: by({
    common: 'solid stripe twin halo split tricolour quarters',
    uncommon: 'checker chevron arrow bolt speed stars',
    rare: 'flames wings tiger camo swirl halftone zebra topo gulf carbon retro',
    epic: 'hex drip splatter circuit digital scales hurricane neon',
    legendary: 'galaxy shatter inferno sakura',
    exclusive: 'shark pumpkin',
  }),
  visor: by({ common: 'clear smoke dark emerald purple rosegold chrome teal orange', uncommon: 'gold blue red copper ice lime blackchrome',
    rare: 'iridium sunset ocean ember neonpink toxic', epic: 'aurora holo', legendary: 'galaxy', exclusive: 'winner champion' }),
  suit: by({
    common: 'classic twotone sides split bands fade',
    uncommon: 'chevron sash shoulders chequer twin pinstripe',
    rare: 'flames bolt camo waves dots stars zebra topo gulf carbon retro',
    epic: 'tiger argyle hex drip flag circuit digital scales hurricane neon',
    legendary: 'galaxy shatter inferno sakura',
  }),
  livery: by({
    common: 'none factory retro speed',
    uncommon: 'chevron wave pinstripes bolt',
    rare: 'shark flames stars chequer hex zebra topo gulf carbon retro',
    epic: 'tiger camo argyle splash circuit digital scales hurricane neon',
    legendary: 'galaxy shatter inferno sakura',
  }),
};

// kind: 'hat' | 'helmet' | 'visor' | 'suit' | 'livery'
export const rarityOf = (kind, id) => RARITY[kind]?.[id] ?? 'common';
export const tierOf = (kind, id) => TIERS[rarityOf(kind, id)];
