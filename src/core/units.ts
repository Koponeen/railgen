// Perusmitat README luvusta 2. Kaikki pituudet millimetreinä, kulmat asteina.

/** Mikrogrid: jokainen suorapituus on tämän monikerta (54 = 3u, 108 = 6u, 216 = 12u). */
export const MICRO_GRID_MM = 18

/** Loginen solu = D-suoran pituus. */
export const CELL_MM = 216

/** Lyhin matka, jonka voi täyttää kummalla pituusperheellä tahansa (1 D = 2 A1 = 4 A2, 2 D = 3 A). */
export const FIT_LENGTH_MM = 432

/** Laudan leveys ja urien keskietäisyys. */
export const TRACK_WIDTH_MM = 40
export const GROOVE_SPACING_MM = 26

/** Yhden tason nousu (N-ramppi: 64 mm / 216 mm matkalla). */
export const LEVEL_RISE_MM = 64

// Geometria lasketaan liukuluvuilla, joten tarkkuusvertailut tarvitsevat epsilonin.
// Mitat pyöristetään signatuureissa kahteen desimaaliin, joten EPS_MM on sitä väljempi.
export const EPS_MM = 0.05
export const EPS_DEG = 0.001

/** Onko pituus mikrogridissä eksakti? */
export function isOnMicroGrid(lengthMm: number): boolean {
  return Math.abs(lengthMm - Math.round(lengthMm / MICRO_GRID_MM) * MICRO_GRID_MM) <= EPS_MM
}

/** Pituus mikrogridin yksikköinä (ei pyöristä: heittää jos ei osu gridiin). */
export function toMicroUnits(lengthMm: number): number {
  const units = lengthMm / MICRO_GRID_MM
  const rounded = Math.round(units)
  if (Math.abs(units - rounded) * MICRO_GRID_MM > EPS_MM) {
    throw new RangeError(`length ${lengthMm} mm is not a multiple of ${MICRO_GRID_MM} mm`)
  }
  return rounded
}
