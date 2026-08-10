import { tOptional } from './index'

/**
 * Variaatiokuvion näyttönimi. Kuviokirjasto on kieletöntä dataa, joten nimi
 * tulee lokaalista kuviotyypin mukaan; kääntämätön kuvio putoaa takaisin
 * tunnukseensa (sama sääntö kuin paloilla, R8).
 */
export function variationName(kind: string): string {
  return tOptional(`variation.name.${kind}`) ?? kind
}
