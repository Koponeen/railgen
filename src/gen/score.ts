import type { Inventory } from '../core/inventory'
import type { Track } from './build'
import type { CellMask } from './mask'
import type { Skeleton } from './skeleton'

// Pisteytys (README luku 4 kohta 6): inventaarion käyttöaste, täyttöaste,
// risteysten/ylikulkujen määrä, sakko tylsyydestä, kireysprosentti.

export interface ScoreBreakdown {
  /** Kuinka suuri osa inventaariosta on käytössä (0–1). */
  inventoryUse: number
  /** Kuinka suuren osan alueesta rata täyttää (0–1). */
  areaFill: number
  /** Erilaisten palatyyppien osuus käytössä (0–1). */
  variety: number
  /** Muodon kiinnostavuus: kulmien määrä yli perusnelikulmion (0–1). */
  shapeInterest: number
  /** Mäet, ylikulut ja muut tasoerikoisuudet (0–1). */
  features: number
  /** Kireysprosentti nollasta yhteen. */
  tightness: number
  total: number
}

const WEIGHTS = {
  inventoryUse: 25,
  areaFill: 30,
  variety: 15,
  shapeInterest: 15,
  features: 15,
  tightness: -20,
}

export function scoreTrack(track: Track, skeleton: Skeleton, mask: CellMask, inventory: Inventory): ScoreBreakdown {
  const areaMm2 = mask.areaWidthMm * mask.areaDepthMm
  const trackMm2 = Math.max(0, (track.bbox.maxX - track.bbox.minX) * (track.bbox.maxY - track.bbox.minY))
  const areaFill = areaMm2 > 0 ? Math.min(1, trackMm2 / areaMm2) : 0

  let inventoryUse = 0.5
  if (!inventory.unlimited) {
    const stock = Object.values(inventory.counts).reduce((sum, count) => sum + count, 0)
    const used = Object.values(track.usage).reduce((sum, count) => sum + count, 0)
    inventoryUse = stock > 0 ? Math.min(1, used / stock) : 0
  }

  const distinctPieces = Object.keys(track.usage).length
  const variety = Math.min(1, distinctPieces / 5)

  const shapeInterest = Math.min(1, Math.max(0, skeleton.corners.length - 4) / 8)

  const hillCount = Object.keys(skeleton.hills).length
  const features = Math.min(1, (hillCount + Math.max(0, track.maxLevel)) / 3)

  const tightness = Math.min(1, track.closure.tightnessPct / 100)

  const total =
    WEIGHTS.inventoryUse * inventoryUse +
    WEIGHTS.areaFill * areaFill +
    WEIGHTS.variety * variety +
    WEIGHTS.shapeInterest * shapeInterest +
    WEIGHTS.features * features +
    WEIGHTS.tightness * tightness

  return { inventoryUse, areaFill, variety, shapeInterest, features, tightness, total }
}
