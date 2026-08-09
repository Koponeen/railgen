import { tOptional } from './index'

/**
 * Palakirjasto on kieletöntä dataa: siinä on vain tunnukset ja mitat. Näyttönimet
 * ovat käännösavaimia (R8). Omistajan lisäämä custom-pala ilman käännöstä
 * palautuu tunnukseensa, eikä puuttuva käännös koskaan riko käyttöliittymää.
 */
export function pieceName(pieceId: string): string {
  return tOptional(`piece.${pieceId}.name`) ?? pieceId
}

export function hasPieceName(pieceId: string): boolean {
  return tOptional(`piece.${pieceId}.name`) !== null
}
