export type MrzSymbol = string;

export const MRZ_SYMBOLS: readonly string[] = [
  ...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<',
];

export const SYMBOL_TO_INDEX = new Map(
  MRZ_SYMBOLS.map((s, i) => [s, i]),
);

export const INDEX_TO_SYMBOL = new Map(
  MRZ_SYMBOLS.map((s, i) => [i, s]),
);
