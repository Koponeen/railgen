import type { PieceLibrary } from '../core/library'
import type { ResolvedPiece } from '../core/pieces'

// Inventaariosivun ryhmittely. Ryhmä johdetaan palan tyypistä ja tageista,
// joten uusi pala ilmestyy listaan ilman koodimuutosta.

export type PieceGroupId = 'straight' | 'curve' | 'switch' | 'crossing' | 'elevation' | 'terminal'

export interface PieceGroup {
  id: PieceGroupId
  pieces: ResolvedPiece[]
}

const GROUP_ORDER: PieceGroupId[] = ['straight', 'curve', 'switch', 'crossing', 'elevation', 'terminal']

function groupOf(piece: ResolvedPiece): PieceGroupId {
  if (piece.isTerminal) return 'terminal'
  if (piece.kind === 'ramp' || piece.tags.includes('bridge-deck')) return 'elevation'
  if (piece.tags.includes('crossing')) return 'crossing'
  if (piece.tags.includes('switch')) return 'switch'
  if (piece.kind === 'curve') return 'curve'
  return 'straight'
}

/**
 * Palat, joita käyttäjä voi omistaa. Geometrialtaan varmistamattomat jätetään
 * pois: niitä ei saa päätyä osaluetteloon ennen kuin mitat on tarkistettu.
 */
export function ownablePieces(library: PieceLibrary): ResolvedPiece[] {
  return library.pieces.filter((piece) => !piece.tags.includes('unverified-geometry'))
}

export function pieceGroups(library: PieceLibrary, onlyBasic: boolean): PieceGroup[] {
  const pieces = ownablePieces(library).filter((piece) => !onlyBasic || piece.tags.includes('basic'))
  return GROUP_ORDER.map((id) => ({ id, pieces: pieces.filter((piece) => groupOf(piece) === id) })).filter(
    (group) => group.pieces.length > 0,
  )
}

/** Osaluettelon järjestys: ryhmittäin, ryhmän sisällä pituuden mukaan. */
export function sortForPartsList(library: PieceLibrary, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const pieceA = library.get(a)
    const pieceB = library.get(b)
    const groupDelta = GROUP_ORDER.indexOf(groupOf(pieceA)) - GROUP_ORDER.indexOf(groupOf(pieceB))
    if (groupDelta !== 0) return groupDelta
    return pieceA.lengthMm - pieceB.lengthMm || a.localeCompare(b)
  })
}
