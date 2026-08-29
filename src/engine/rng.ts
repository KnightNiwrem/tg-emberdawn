/**
 * Deterministic RNG utilities. Battles and loot accept an injected rng so
 * tests can pin outcomes; production uses Math.random by default.
 */

export type Rng = () => number;

export const defaultRng: Rng = Math.random;

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Weighted pick over {weight} entries; returns the index, or -1 if total weight is 0. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return -1;
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

export function variance(rng: Rng, base: number, spread = 0.1): number {
  return Math.max(1, Math.round(base * (1 - spread + rng() * 2 * spread)));
}
