# Palakirjasto

Palakirjasto on **dataa, ei koodia** (CLAUDE.md). Palat asuvat `data/pieces/`-hakemistossa
JSON-tiedostoina, ja `src/core/library.ts` kokoaa niistä ajonaikaisen kirjaston. Uusi pala on
rivi dataan — kooditiedostoihin ei kosketa.

## Koordinaatisto ja portit

- Millimetrit, `x` oikealle ja `y` alas (sama kuin SVG:ssä).
- Suunnat ovat **45°-lokeroita** `0..7`: `0 = +x`, kulma kasvaa myötäpäivään näytöllä.
  Akselisuunnat lasketaan taulukosta, joten suorat pysyvät 18 mm:n gridissä eksakteina.
- Portti = `{ id, x, y, dir, connector, levelOffset, branch }`. `dir` osoittaa **ulospäin**
  palasta. Kaksi porttia voi liittyä vain, jos suunnat ovat vastakkaiset, sijainnit samat,
  tasot samat ja liittimet toistensa vastaparit (`pin` ↔ `socket`).
- Parametriset palat kirjoitetaan aina samaan asentoon: sisääntulo origossa suuntaan 4
  (länteen, `socket`), ulostulo `+x`-akselilla (`pin`).

## Kolme palatasoa (README luku 8)

| Taso | `kind` | Mitä data sisältää |
|---|---|---|
| 1 | `straight`, `curve`, `ramp` | Pelkät parametrit. Portit, keskilinja, jalanjälki ja piirtopolku johdetaan automaattisesti. |
| 2 | `composite` | Lista primitiivejä ja liitoskohdat. Esim. kaarrevaihde "L = A + E". |
| 3 | `custom` | Portit käsin, oma piirtopolku **SVG-polkudatana JSON-kentässä** (R3) — ei koodia. |

Yhteiset kentät: `varioFactor` (R5), `mirrorable`, `tags`, `minLevel`, `source`, `notes`.

### Esimerkki: taso 2

```jsonc
{
  "id": "L",
  "kind": "composite",
  "parts": [
    { "piece": "A", "rename": { "in": "in", "out": "mid" } },
    { "piece": "E", "join": { "toPort": "mid" }, "rename": { "out": "branch" }, "branchPorts": ["out"] }
  ]
}
```

## Korvausluokat

Korvausluokkaan liittyminen on automaattista porttisignatuurin kautta — generointikoodiin ei
kosketa (README luku 8). Signatuuri kanonisoidaan siirtämällä jokainen portti vuorollaan
origoon suuntaan 4 ja valitsemalla pienin merkkijonoesitys, joten se ei riipu siitä, missä
asennossa pala on kirjoitettu dataan. `mirrorable`-palat saavat lisäksi peilatun avaimen.

**Signatuuri lasketaan vain pääporteista.** `branch: true` -portti jätetään sen ulkopuolelle,
jolloin haaroittava pala (vaihde, T-risteys) päätyy automaattisesti läpimenevän suoransa
luokkaan — juuri kuten README luvun 2 korvausluokkataulukko sanoo.

Tasomuutos ei kuulu signatuuriin, joten N-ramppi on 216 mm:n luokassa (kuten README sanoo),
mutta `levelDelta` kertoo kutsujalle että vaihto muuttaa tasoa.

## Validointi

`validatePiece()` tarkistaa: porttisuunnat ovat 45°-lokeroita, portteja on vähintään kaksi,
pääportteja on tasan kaksi, tunnukset ovat uniikkeja, suorapituudet ovat 18 mm:n gridissä
(`off-grid`-tagi ohittaa) ja pääporttien liittimet ovat vastaparit.

## Näyttönimet

Palakirjassa on vain tunnukset ja mitat. Näyttönimet ovat käännösavaimia
`piece.<ID>.name` lokaalitiedostoissa (R8); `pieceName()` palauttaa tunnuksen, jos käännöstä
ei ole. Omistajan custom-pala toimii siis heti ilman käännöstyötä.

## Mukana oleva palasto

Kaikki alla olevat mitat tulevat README luvusta 2.

| Tunnus | Tyyppi | Mitat |
|---|---|---|
| `A2`, `A3`, `A1`, `A`, `D` | suora | 54, 72, 108, 144, 216 mm |
| `E` | kaari 45° | keskilinjasäde 202 mm (sisäsäde 182 mm) |
| `E1` | kaari 45° | keskilinjasäde 110 mm (sisäsäde 90 mm) |
| `N` | ramppi | 216 mm, nousu 64 mm |
| `DECK144/216/324/360` | sillan kansi | 144, 216, 324, 360 mm, `minLevel: 1` |

`DECK*`-tunnukset ovat kuvailevia: README antaa kansien pituudet muttei BRIO:n kirjainkoodeja.

## Odottavat palat — mitat tarkistamatta

Näitä **ei ole** lisätty kirjastoon, koska README ei anna niiden geometriaa eikä
woodenrailway.info ole ollut saatavilla mittojen tarkistamiseen. Työskentelykäytäntö on
selvä: *jos mitat epäilyttävät, tarkista lähteestä äläkä arvaa* (CLAUDE.md). Kukin näistä on
yhden datarivin työ, kun mitat on tarkistettu — koodimuutoksia ei tarvita.

| Pala | Mitä pitää tarkistaa |
|---|---|
| `T` (T-risteys) | haaraportin sijainti ja suunta 216 mm:n läpikulun varrella |
| `X` (X-tähtiristeys) | haarojen lukumäärä, kulmat ja porttien sijainnit |
| `K` | geometria (216 mm:n luokka) |
| `L`, `M` (kaarrevaihteet) | mihin porttiin E-kaari kiinnittyy ja kummalle puolelle; README antaa vain "L = A + E" |
| `I`, `J`, `F1`, `G1`, `H2`, `Q` | 144 mm:n luokan vaihteiden haaraportit |
| `O1`, `P1`, `H` (risti) | 108 mm:n luokka |
| `H3` (kaariristeys) | E-luokka, README sanoo "= 2×E" |
| `O`, `P` | E1-luokka, README sanoo "= 2×E1" |
| Taipuva pala | pituushaarukka ja maksimitaivutus omistajan 3D-tulosteesta (parametrit ovat dataa, ks. `FlexSettings`) |
| IKEA Lillabo -osat | mitat |

Ennen kuin nämä ovat mukana, generaattorin haara- ja X-risteysmutaatiot hylkäävät itsensä
siististi ("signatuurille ei ole toteutusta") — runko pysyy silti ehjänä.
