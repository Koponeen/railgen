import type { AreaShape } from '../gen/mask'
import type { Track } from '../gen/build'

// Kartan sisäinen tila. Tämä elää kokonaan Preactin ulkopuolella
// (imperatiivinen saareke, docs/IMPLEMENTATION_PLAN.md luku 2).

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
  /** Lattia-alue millimetreinä; kartan viewBox seuraa tätä. */
  area: AreaShape
  /** Näytettävä rata, tai null jos sitä ei ole vielä generoitu. */
  track: Track | null
  /** Valittu pala `track.pieces`-indeksinä. */
  selectedPiece: number | null
  /** Vapaalla kädellä piirretyt viivat (vaihe 2 ottaa nämä käyttöön). */
  lines: DrawnLine[]
}

export const DEFAULT_AREA: AreaShape = { kind: 'rect', widthMm: 2000, depthMm: 1500 }

export function createInitialState(area: AreaShape = DEFAULT_AREA): AppState {
  return {
    view: { x: 0, y: 0, scale: 1 },
    mode: 'view',
    area,
    track: null,
    selectedPiece: null,
    lines: [],
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
