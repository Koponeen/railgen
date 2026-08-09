import { CELL_MM } from '../core/units'
import type { Vec } from '../core/vec'

// Aluemaski: lattia jaetaan 216 mm:n soluihin ja muoto on solumaski
// (suorakaide tai L = suorakaide miinus nurkka). README luku 4 kohta 1.

export type AreaShape =
  | { kind: 'rect'; widthMm: number; depthMm: number }
  | {
      kind: 'L'
      widthMm: number
      depthMm: number
      /** Leikatun nurkan koko. */
      cutWidthMm: number
      cutDepthMm: number
      corner: 'nw' | 'ne' | 'sw' | 'se'
    }

export interface CellMask {
  cols: number
  rows: number
  /** Rivijärjestyksessä: index = row * cols + col. */
  cells: boolean[]
  count: number
  /** Solukon vasen ylänurkka maailmakoordinaatistossa (solukko keskitetään alueelle). */
  originMm: Vec
  areaWidthMm: number
  areaDepthMm: number
  has(col: number, row: number): boolean
}

export function buildMask(shape: AreaShape): CellMask {
  const cols = Math.max(0, Math.floor(shape.widthMm / CELL_MM))
  const rows = Math.max(0, Math.floor(shape.depthMm / CELL_MM))
  const cells = new Array<boolean>(cols * rows).fill(true)

  if (shape.kind === 'L') {
    const cutCols = Math.min(cols, Math.ceil(shape.cutWidthMm / CELL_MM))
    const cutRows = Math.min(rows, Math.ceil(shape.cutDepthMm / CELL_MM))
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const inCutCols = shape.corner === 'nw' || shape.corner === 'sw' ? col < cutCols : col >= cols - cutCols
        const inCutRows = shape.corner === 'nw' || shape.corner === 'ne' ? row < cutRows : row >= rows - cutRows
        if (inCutCols && inCutRows) cells[row * cols + col] = false
      }
    }
  }

  // Solukko keskitetään alueelle, jotta reunoille jää tasainen marginaali.
  const originMm: Vec = {
    x: (shape.widthMm - cols * CELL_MM) / 2,
    y: (shape.depthMm - rows * CELL_MM) / 2,
  }

  return {
    cols,
    rows,
    cells,
    count: cells.filter(Boolean).length,
    originMm,
    areaWidthMm: shape.widthMm,
    areaDepthMm: shape.depthMm,
    has: (col, row) => col >= 0 && row >= 0 && col < cols && row < rows && cells[row * cols + col],
  }
}

/** Solun keskipiste maailmakoordinaatistossa. */
export function cellCenter(mask: CellMask, col: number, row: number): Vec {
  return {
    x: mask.originMm.x + (col + 0.5) * CELL_MM,
    y: mask.originMm.y + (row + 0.5) * CELL_MM,
  }
}

export function areaBounds(mask: CellMask): { minX: number; minY: number; maxX: number; maxY: number } {
  return { minX: 0, minY: 0, maxX: mask.areaWidthMm, maxY: mask.areaDepthMm }
}

/**
 * Alueen ääriviiva myötäpäivään: suorakaide tai L (suorakaide miinus nurkka).
 * Sekä kartan piirto että osion sivutilan mittaus katsovat tätä samaa muotoa.
 */
export function areaOutline(area: AreaShape): Vec[] {
  const { widthMm: w, depthMm: d } = area
  if (area.kind === 'rect') {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ]
  }
  const west = area.corner === 'nw' || area.corner === 'sw'
  const north = area.corner === 'nw' || area.corner === 'ne'
  const x0 = west ? area.cutWidthMm : w - area.cutWidthMm
  const y0 = north ? area.cutDepthMm : d - area.cutDepthMm

  if (north && !west) return [{ x: 0, y: 0 }, { x: x0, y: 0 }, { x: x0, y: y0 }, { x: w, y: y0 }, { x: w, y: d }, { x: 0, y: d }]
  if (north && west) return [{ x: x0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }, { x: 0, y: y0 }, { x: x0, y: y0 }]
  if (!north && !west) return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: y0 }, { x: x0, y: y0 }, { x: x0, y: d }, { x: 0, y: d }]
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: x0, y: d }, { x: x0, y: y0 }, { x: 0, y: y0 }]
}
