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
| 1 | `straight`, `curve`, `ramp`, `terminal` | Pelkät parametrit. Portit, keskilinja, jalanjälki ja piirtopolku johdetaan automaattisesti. |
| 2 | `junction`, `composite` | Vaihteet ja risteykset reitteinä; yhdistelmäpalat listana primitiivejä. |
| 3 | `custom` | Portit käsin, oma piirtopolku **SVG-polkudatana JSON-kentässä** (R3) — ei koodia. |

Yhteiset kentät: `varioFactor` (R5), `mirrorable`, `tags`, `minLevel`, `source`, `notes`.

Suoralla ja rampilla voi antaa `connectors: [sisääntulo, ulostulo]`; oletus on kolo → tappi.
Sukupuolivariantit (B/C, B1/C1, B2/C2, N1) ovat tämän kentän ainoa käyttötarkoitus.

### Taso 2: vaihde tai risteys reitteinä

Vaihde kuvataan **reitteinä**, ei porttikoordinaatteina: jokainen reitti on ketju suoria ja
kaaria, ja portit johdetaan reittien päistä. Käsin ei siis lasketa yhtään koordinaattia.

```jsonc
{
  "id": "L",
  "kind": "junction",
  "mirrorable": false,
  "routes": [
    { "from": { "id": "in", "connector": "socket" },
      "to":   { "id": "out", "connector": "pin" },
      "path": [{ "straight": 144 }] },
    { "from": { "id": "in", "connector": "socket" },
      "to":   { "id": "branch", "connector": "pin", "branch": true },
      "path": [{ "curve": { "radiusMm": 202, "sweepDeg": 45, "hand": "right" } }] }
  ]
}
```

Reitit saavat jakaa portteja. Kun ne jakavat, resolvointi **tarkistaa** että kumpikin reitti
päätyy samaan pisteeseen samaan suuntaan samalla liittimellä. Tähtiristeys `X` on paras
esimerkki: kaksi suoraa ja neljä neljännesympyrää, ja jos jokin kaari ei osuisi samoihin
portteihin kuin suorat, data ei resolvoituisi lainkaan.

Vaihteita ei voi kääntää nurin (kielet ovat päällä), joten niillä on `mirrorable: false` ja
kummallekin puolelle oma palansa — juuri siksi BRIO myy L ja M parina.

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

Lähde: woodenrailway.info **BRIO Track Guide** ja README luku 2. Kaaren keskilinjasäde on
lähteen sisäsäde + puoli laudanleveyttä (182 + 20 = 202, 90 + 20 = 110); lähde vahvistaa
tämän ilmoittamalla E:n ulkosäteeksi 222 mm.

| Tunnus | Tyyppi | Mitat |
|---|---|---|
| `A2`, `A3`, `A1`, `A`, `D` | suora | 54, 72, 108, 144, 216 mm |
| `B`/`C`, `B1`/`C1`, `B2`/`C2` | suora, sukupuolivariantti | 144, 108, 54 mm; kaksi tappia / kaksi koloa |
| `E` | kaari 45° | keskilinjasäde 202 mm (sisäsäde 182 mm) |
| `E1` | kaari 45° | keskilinjasäde 110 mm (sisäsäde 90 mm) |
| `N` | ramppi | 216 mm, nousu 64 mm |
| `N1` | ramppi, kaksi tappia | 216 mm, nousu 64 mm |
| `DECK144/216/324/360` | sillan kansi | 144, 216, 324, 360 mm, `minLevel: 1` |
| `L`, `M` | kaarrevaihde | pääreitti 144 mm, haara E-kaari |
| `I`, `J` | kolmisuuntainen vaihde | pääreitti 144 mm, molemmat E-haarat |
| `O`, `P` | kaksoiskaarrevaihde | kaksi E1-kaarta, ei suoraa läpimenoa |
| `O1`, `P1` | lyhyt kaarrevaihde | pääreitti 108 mm, haara E1-kaari |
| `T` | T-risteys | pääreitti 216 mm, haara 90° säteellä 108 mm |
| `X` | tähtiristeys | 216 × 216 mm, neljä porttia, neljä 108 mm:n neljännesympyrää |
| `H`, `H1`, `H2` | risteys | 2 × 108 mm suorassa kulmassa, 2 × 116 mm suorassa kulmassa, 2 × 144 mm 45 asteessa |
| `R`, `S` | puskuri | 40 mm, yksi portti |
| `U`, `V` | ajoramppi | 54 mm, yksi portti |
| `F`, `G` | rinnakkaisvaihde | 150 mm, ulostulot ±23 mm sivussa — **geometria epävarma, ks. alla** |

### Sukupuolipari vs. peilipari

Vaihteita ei voi kääntää nurin, joten variantteja tarvitaan. Kirjaimet kulkevat parina
kahdella eri tavalla:

- **Peilipari** (`L`/`M`, `O1`/`P1`): sama pala vasemmalle ja oikealle kaartuvana. Vain
  toinen haara kummassakin.
- **Sukupuolipari** (`I`/`J`, `O`/`P`, `F`/`G`): sama pala, liitinsukupuolet päinvastoin.
  Näissä on jo molemmat haarat, joten peilaus ei tuottaisi uutta palaa.

Käänteinen variantti päätyy silti samaan korvausluokkaan: signatuurin kanonisointi kokeilee
kumpaakin porttia lähtökohtana, joten `J` kelpaa `A`:n paikalle — se vain kuljetaan toisesta
päästä. Testit tarkistavat tämän.

Yksi hienovaraisuus: **suora on akiraalinen, kaari ei.** `I` ja `J` ovat suoraan toistensa
tilalle vaihdettavissa, koska suora näyttää samalta kummasta päästä tahansa. `O` ja `P`
kelpaavat kumpikin `E1`:n paikalle, mutteivät toistensa tilalle — takaperin kuljettuna
kaaren kätisyys kääntyy. `E1` itse kattaa molemmat kätisyydet, koska sen voi kääntää nurin
(`mirrorable: true`) ja se saa siksi kaksi signatuuria; vaihde saa yhden.

`DECK*`-tunnukset ovat kuvailevia: lähde antaa kansien pituudet muttei BRIO:n kirjainkoodeja.

### Mitä lähteestä on johdettu, ei luettu suoraan

- **`T` ja `X` haarasäde 108 mm.** Lähde antaa sisäsäteen 88 mm ja huomauttaa, että säde on
  "2 mm E1:tä tiukempi, koska suora sivu on D". 88 + 20 = 108 = 216/2, eli neljännesympyrä
  vie täsmälleen puolet D:n pituudesta — sama luku kahdesta suunnasta.
- **`L`/`M` ja `O1`/`P1` puolisuus.** Lähde kertoo, että ne ovat pari, muttei kumpi kirjain
  on kumpi puoli. Geometria on molemmille oikein; vain nimilappu voi olla väärinpäin.
- **`R`/`S` ja `U`/`V` liitinsukupuoli.** Sama tilanne: pari on varma, kirjain–sukupuoli ei.
- **Sukupuoliparien kirjainjärjestys.** `I`/`J`, `O`/`P` ja `F`/`G` ovat sama pala
  liitinsukupuolet päinvastoin; kumpi kirjain on kumpi variantti, ei ole varmistettu.
- **Vaihteiden haaraportin liitinsukupuoli.** Mallinnettu samaksi kuin pääreitin ulostulo.
  Lähde ei kerro tätä.

### Epävarma geometria: `F` ja `G`

Nämä ovat mukana mutta merkitty `unverified-geometry`-tagilla, ja **generaattori ei käytä
niitä** — testi tarkistaa, ettei yksikään elementti viittaa tagattuun palaan.

Lähde kertoo vain pituuden (150 mm) ja sen, että molemmat ulostulot ovat sivussa
sisääntulon keskilinjasta. Sivusiirtymäksi on oletettu ±23 mm, koska kaksoisraide on
lähteen mukaan 46 mm keskeltä keskelle eikä muuta lukua ole tarjolla. Myös palan sisäinen
muoto on piirretty arvaamalla. Kun oikeat mitat löytyvät, tagi pois ja luvut tilalle.

## Odottavat palat

Näitä ei ole kirjastossa. Työskentelykäytäntö on selvä: *jos mitat epäilyttävät, tarkista
lähteestä äläkä arvaa* (CLAUDE.md). Kukin on yhden datarivin työ, kun tiedot löytyvät.

| Pala | Mikä puuttuu |
|---|---|
| `F1`, `G1`, `F2`, `G2` (rinnakkaisvaihteet) | Haaraporttien sijainnit; kaksoisraiteen 46 mm:n väli tiedetään, muttei haaran kiinnityskohtaa. |
| `H3` (kaariristeys) | Kahden E-kaaren keskinäistä risteämiskulmaa ei kerrota. Ei ilmeisesti enää valmistuksessa — selvitetään myöhemmin. |
| `Q` (viisipistevaihde) | Lähde kertoo mitat: ulkokäännökset 45°, **sisäkäännökset 22,5°**. Jälkimmäinen ei osu 45°:n porttilokeroihin, joten pala vaatisi porttimallin laajennuksen eikä pelkkää datariviä. Ei ilmeisesti enää valmistuksessa — lykätty. |
| `EE`, `EE1`, `K`, `K1` (kaksoisraidepalat) | Geometria on johdettavissa (46 mm väli), mutta palamalli olettaa yhden pääreitin. Kaksoisraidepala tarvitsisi käsitteen "kaksi rinnakkaista pääreittiä". |
| Taipuva pala | Pituushaarukka ja maksimitaivutus omistajan 3D-tulosteesta (parametrit ovat dataa, ks. `FlexSettings`). |
| IKEA Lillabo -osat | Mitat. |

Ennen kuin nämä ovat mukana, generaattorin haara- ja X-risteysmutaatiot hylkäävät itsensä
siististi ("signatuurille ei ole toteutusta") — runko pysyy silti ehjänä.
