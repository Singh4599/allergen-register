// LV Spices — Allergen & Cross-Contamination Control Register
// Deterministic Lifetime Auto-Generation Engine (Starting 01 April 2026)

import { MASTER_PRODUCTS } from './products-master.js';

// Seeded PRNG (Mulberry32) for deterministic, reproducible generation
function mulberry32(a) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Split products into pools
const pools = {
  seasoning_with: MASTER_PRODUCTS.filter(p => p.group === 'seasoning' && p.hasAllergen),
  seasoning_without: MASTER_PRODUCTS.filter(p => p.group === 'seasoning' && !p.hasAllergen),
  blended_with: MASTER_PRODUCTS.filter(p => p.group === 'blended' && p.hasAllergen),
  blended_without: MASTER_PRODUCTS.filter(p => p.group === 'blended' && !p.hasAllergen),
  other_with: MASTER_PRODUCTS.filter(p => p.group === 'other' && p.hasAllergen),
  other_without: MASTER_PRODUCTS.filter(p => p.group === 'other' && !p.hasAllergen)
};

export function getDayIndex(dateStr) {
  const base = new Date('2026-04-01T00:00:00Z');
  const target = new Date(dateStr + 'T00:00:00Z');
  return Math.floor((target - base) / 86400000);
}

export function getPreviousWorkingDate(dateStr) {
  let d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0) { // Skip Sunday
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().split('T')[0];
}

/**
 * Generate production register entries for a given date string (YYYY-MM-DD).
 * Ordered with latest entries at the TOP so that each entry's Previous Product
 * is the entry directly BELOW it.
 */
export function generateEntriesForDate(dateStr, isNested = false) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const dayOfWeek = d.getUTCDay();
  if (dayOfWeek === 0) return []; // Sunday = No production

  const dayIdx = getDayIndex(dateStr);
  const rng = mulberry32(dayIdx * 7919 + 424242);

  // Daily count distribution:
  // 6 entries: 15% | 8 entries: 30% | 10 entries: 25% | 12 entries: 10% | 7: 10% | 9: 10%
  const rCount = rng();
  let count;
  if (rCount < 0.15) count = 6;
  else if (rCount < 0.45) count = 8;
  else if (rCount < 0.70) count = 10;
  else if (rCount < 0.80) count = 12;
  else if (rCount < 0.90) count = 7;
  else count = 9;

  // Category composition: 70% Seasoning, 20% Blended, 10% Other
  const countSeasoning = Math.round(count * 0.70);
  const countBlended = Math.max(1, Math.round(count * 0.20));
  const countOther = count - countSeasoning - countBlended;

  // Allergen target: exactly ~40% with allergens
  const targetAllergen = Math.round(count * 0.40);

  // Distribute allergen target across categories
  let withSeasoning = Math.min(countSeasoning, Math.round(targetAllergen * 0.75));
  let remainingWith = targetAllergen - withSeasoning;
  let withBlended = Math.min(countBlended, remainingWith > 0 ? 1 : 0);
  remainingWith -= withBlended;
  let withOther = Math.min(countOther, remainingWith);
  if (withSeasoning + withBlended + withOther < targetAllergen) {
    if (withSeasoning < countSeasoning) withSeasoning++;
    else if (withBlended < countBlended) withBlended++;
  }

  const withoutSeasoning = countSeasoning - withSeasoning;
  const withoutBlended = countBlended - withBlended;
  const withoutOther = countOther - withOther;

  const used = new Set();
  const pick = (pool, n) => {
    const list = [];
    if (!pool.length || n <= 0) return list;
    const offset = Math.floor(rng() * pool.length);
    for (let i = 0; list.length < n && i < pool.length * 2; i++) {
      const prod = pool[(offset + i) % pool.length];
      if (!used.has(prod.name)) {
        used.add(prod.name);
        list.push(prod);
      }
    }
    return list;
  };

  const selected = [
    ...pick(pools.seasoning_with, withSeasoning),
    ...pick(pools.seasoning_without, withoutSeasoning),
    ...pick(pools.blended_with, withBlended),
    ...pick(pools.blended_without, withoutBlended),
    ...pick(pools.other_with, withOther),
    ...pick(pools.other_without, withoutOther)
  ];

  // Shuffle selected products so allergens and categories are naturally mixed
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }

  // Previous product calculation for the earliest batch of the day
  // (links to the latest batch of the previous working day)
  let prevProduct = 'JEERA POWDER';
  if (!isNested && dateStr > '2026-04-01') {
    const prevDate = getPreviousWorkingDate(dateStr);
    const prevEntries = generateEntriesForDate(prevDate, true);
    if (prevEntries && prevEntries.length) {
      // Since entries are returned latest-first, prevEntries[0] is yesterday's latest batch!
      prevProduct = prevEntries[0].productName;
    }
  }

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const formattedDate = `${dayStr}/${monthStr}/${yearStr.slice(-2)}`;
  const mmyy = `${monthStr}${yearStr.slice(-2)}`;

  // Shuffled quality checkers: Vishal and Tejas
  const dayChecker = rng() < 0.5 ? 'Vishal' : 'Tejas';
  const otherChecker = dayChecker === 'Vishal' ? 'Tejas' : 'Vishal';

  // 1. Build chronological sequence (morning batch to evening batch)
  const chronological = [];
  let curPrev = prevProduct;
  for (let idx = 0; idx < selected.length; idx++) {
    const prod = selected[idx];
    const batchNo = `${prod.code}-${mmyy}`;
    const checkedBy = (rng() < 0.82) ? dayChecker : otherChecker;

    // Clean allergen text without emoji
    const cleanAllergen = prod.allergenText.replace(/^[⚠️!\s]+/, '');

    chronological.push({
      id: `${dateStr}_${idx + 1}`,
      seq: idx + 1,
      date: formattedDate,
      dateISO: dateStr,
      productName: prod.name.toUpperCase(),
      batchNo: batchNo,
      allergenPresent: cleanAllergen,
      hasAllergen: prod.hasAllergen,
      allergens: prod.allergens,
      category: prod.category,
      group: prod.group,
      previousProduct: curPrev,
      equipmentCleaned: 'Yes',
      crossContaminationCheck: 'Pass',
      checkedBy: checkedBy,
      isAuto: true
    });

    curPrev = prod.name.toUpperCase();
  }

  // 2. Reverse so LATEST batch is at the TOP (Row 1):
  // When latest is at top, Row 1's previous product is Row 2 (the row directly below it)!
  return chronological.reverse();
}
