// The shop: themed sets of skins bought with points, each a kart livery, a
// helmet and a suit in one look (paint.js SHOP_LIVERIES, driver.js
// SHOP_DESIGNS, suits.js SHOP_SUITS). The sets in the shop are IN_SHOP
// below, and they stay until that's changed. And the
// artists' music (music.js ARTISTS), each artist on their own, always in. Points come from
// driving (POINTS); what you buy is yours for good. The record lives with the
// driver's stats (profile.js): points earned, and what was bought for what,
// so the balance is the one minus the other, and two computers' records
// merge without losing a purchase or a point.

import { rarityOf } from './rarity.js';
import { SHOP_VISORS } from './driver.js';

export const THEMES = ['sakura', 'gulf', 'neon', 'hurricane', 'carbon', 'retro', 'topo', 'zebra', 'digital', 'inferno', 'scales', 'circuit', 'galaxy', 'shatter'];
export const THEME_NAMES = { scales: 'Dragon scale', circuit: 'Circuit', galaxy: 'Galaxy', shatter: 'Shattered',
  topo: 'Topographic', zebra: 'Zebra', digital: 'Digital camo', inferno: 'Inferno',
  sakura: 'Sakura Drift', gulf: 'Gulf Coast', hurricane: 'Hurricane', neon: 'Neon Grid', carbon: 'Carbon Fibre', retro: 'Retro Sunset' };
// the sets that come in their own colours: main, second, third
export const THEME_COLOURS = { sakura: ['#17131f', '#ff4f9a', '#ffd3e4'], gulf: ['#ff8a3c', '#0b7f8c', '#ffe9b0'], hurricane: ['#2a3340', '#7fd4e8', '#ffffff'],
  neon: ['#0a0a14', '#19e3ff', '#ff2bd6'], carbon: ['#141518', '#34373e', '#d42a2a'], retro: ['#2a0a4a', '#ff2e88', '#ffc83c'] };
export const KINDS = { livery: 'Kart livery', helmet: 'Helmet', suit: 'Suit' };
// prices: by kind, more for the rarer sets (rarity.js)
export const PRICE = { helmet: 1000, suit: 1500, livery: 2000, visor: 1000 };
// the artists' music: item `music:${id}`
export const MUSIC = { adamholt: { price: 1000 }, marloboys: { price: 1000 } };
const RARITY_PRICE = { common: 0.5, uncommon: 0.75, rare: 1, epic: 1.5, legendary: 2 };
export const priceOf = (kind, theme) => Math.round(PRICE[kind] * (RARITY_PRICE[rarityOf(kind, theme)] ?? 1));
// accounts that have every item, to try them out (Ezra_Langley)
export const TESTERS = new Set(['8c894d35-d15a-44ad-875a-587d0fe6bfc9']);
// what driving earns
export const POINTS = { lap: 10, best: 50, fastestLap: 100, top10: 150, top1: 500, champRace: 250, champPodium: [1000, 600, 400] };

// an item's id: `${kind}:${theme}`
export const itemId = (kind, theme) => `${kind}:${theme}`;
export const parseItem = (id) => { const [kind, theme] = id.split(':'); return { kind, theme }; };

// the themes in the shop: these six, all at once, until they're changed by hand
const IN_SHOP = ['sakura', 'gulf', 'neon', 'hurricane', 'carbon', 'retro'];
export const themesFor = () => IN_SHOP;
// the items on sale, sets in order
export const shopItems = (d = new Date()) => themesFor(d).flatMap(t => Object.keys(KINDS).map(k => ({ id: itemId(k, t), kind: k, theme: t, price: priceOf(k, t) })));
// the visors: always in
export const visorItems = () => Object.keys(SHOP_VISORS).map(t => ({ id: itemId('visor', t), kind: 'visor', theme: t, price: priceOf('visor', t) }));

// this week's deals: DEALS items at a quarter off, the same for everyone, from
// the Monday (UTC) each week. Nothing to run: worked out from the date.
const WEEK = 7 * 86400e3, WEEK0 = Date.UTC(2026, 0, 5), DEALS = 2, OFF = 0.25;
const weekIndex = (d) => Math.floor((d.getTime() - WEEK0) / WEEK);
export function dealsFor(d = new Date()) {
  const all = [...shopItems(d), ...visorItems()], out = [];
  let seed = (weekIndex(d) * 2654435761 + 12345) >>> 0;
  while (out.length < DEALS && all.length) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out.push(all.splice(seed % all.length, 1)[0]);
  }
  return out.map(i => ({ ...i, was: i.price, price: Math.round(i.price * (1 - OFF) / 5) * 5 }));
}
export const nextDeals = (d = new Date()) => new Date((weekIndex(d) + 1) * WEEK + WEEK0);
// what an item costs today
export function priceToday(item, d = new Date()) { return dealsFor(d).find(x => x.id === item.id)?.price ?? item.price; }
export const isDeal = (id, d = new Date()) => dealsFor(d).some(x => x.id === id);
// new in the shop: tagged until this date
const NEW_UNTIL = Date.UTC(2026, 11, 1);
export const isNew = (kind, d = new Date()) => kind === 'visor' && d.getTime() < NEW_UNTIL;


// the wallet, from a driver's stats data ({ points, owned: { id: price } })
export const spent = (data) => Object.values(data.owned || {}).reduce((s, p) => s + (+p || 0), 0);
export const balance = (data) => Math.max(0, (data.points || 0) - spent(data));
export const owns = (data, kind, theme) => !!data.owned?.[itemId(kind, theme)];
