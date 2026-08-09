// Kartan sisäinen tila vaiheessa 0 (elerunko): ei vielä palakirjastoa eikä
// generaattoria, vain tyhjä kartta + piirretyt raakaviivat, joilla eleitä testataan.
// Tämä tila elää kokonaan Preactin ulkopuolella (imperatiivinen saareke).

export interface Point {
  x: number
  y: number
}

export interface DrawnLine {
  id: string
  points: Point[]
}

export interface ViewTransform {
  x: number
  y: number
  scale: number
}

export type Mode = 'view' | 'draw'

export interface AppState {
  view: ViewTransform
  mode: Mode
  lines: DrawnLine[]
  selectedId: string | null
}

// Lattia-alue mikrogridin mukaisissa millimetreissä (README luku 2 & 7).
// Vastaa n. pikakokoa "matto 2x1,5 m" kunnes sivu 1 (alueen valinta) tulee mukaan.
export const WORLD_WIDTH_MM = 2000
export const WORLD_HEIGHT_MM = 1500

export function createInitialState(): AppState {
  return {
    view: { x: 0, y: 0, scale: 1 },
    mode: 'view',
    lines: [],
    selectedId: null,
  }
}

export function makeLineId(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Kumoa/tee uudelleen -historia tilasnapshotteina (data on pientä, README luku 7).
 * Tallentaa vain piirretyt viivat; valinta ja näkymä palautetaan erikseen kutsujassa.
 */
export class History {
  private snapshots: DrawnLine[][]
  private index: number

  constructor(initial: DrawnLine[]) {
    this.snapshots = [cloneLines(initial)]
    this.index = 0
  }

  push(lines: DrawnLine[]): void {
    this.snapshots = this.snapshots.slice(0, this.index + 1)
    this.snapshots.push(cloneLines(lines))
    this.index = this.snapshots.length - 1
  }

  canUndo(): boolean {
    return this.index > 0
  }

  canRedo(): boolean {
    return this.index < this.snapshots.length - 1
  }

  undo(): DrawnLine[] | null {
    if (!this.canUndo()) return null
    this.index -= 1
    return cloneLines(this.snapshots[this.index])
  }

  redo(): DrawnLine[] | null {
    if (!this.canRedo()) return null
    this.index += 1
    return cloneLines(this.snapshots[this.index])
  }
}

function cloneLines(lines: DrawnLine[]): DrawnLine[] {
  return lines.map((line) => ({ id: line.id, points: line.points.slice() }))
}
