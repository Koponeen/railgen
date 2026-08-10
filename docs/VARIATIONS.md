# Vaihda, poista ja autosolver

Toteuttaa README luvun 6 loppuosan siltä osin kuin toteutusjärjestyksen kohta 5
vaatii: **porttisignatuurilistat ("vaihda toiseen"), poiston aukkomerkki,
autosolverin variaatiokuviot parametrisena datana ja palamuutoskortit.**

```
osio valittuna -> Vaihtoehdot -> kuviot + vaihdot -> haamut kartalla -> valinta
                  solve.ts       variations.ts       drawing.ts        App.tsx
                                 swap.ts
               -> Poista -> aukkomerkki -> Täytä / Piirrä tilalle / Kumoa
                  remove.ts                remove.ts  replace.ts
```

Toimintorivi vastaa README:n listaa: **Vaihtoehdot / Piirrä tilalle / Poista**,
ja kaikki kolme saavat saman tehtävänannon — samat päätyportit, saman pituuden,
saman sivutilan ja samat vapautuvat palat (`sectionBrief`, `docs/EDITING.md`).

## 1. Yksi kokoamiskohta kaikille muokkauksille (`assemble.ts`)

Korvaus, haara, vaihto, poisto ja autosolver tuottavat eri paloja mutta
vaativat valmiilta radalta täsmälleen samat kolme asiaa:

1. Muutoksen oma päätyheitto mahtuu **muutoksen omille liitoksille**.
2. Yksikään liitos ei ylitä turvakattoa.
3. Rataan ei synny uutta törmäystä — vertailu alkuperäiseen eikä nollaan.

`assembleTrack` tekee nämä kolme tarkistusta ja kokoaa radan. Epäonnistuminen
palauttaa vain syyn, joten alkuperäinen rata jää aina koskemattomaksi
(CLAUDE.md).

## 2. Vaihda toiseen (`swap.ts`)

Palan napautus valitsee yhden palan osion, ja "Vaihtoehdot" listaa sille saman
**porttisignatuurin** toteutukset. Lista ei ole koodissa: `substitutesFor` antaa
korvausluokan, ja uusi pala palakirjastossa liittyy siihen automaattisesti
(README luku 8). Käytännössä `D` → `T`/`X`, `E1` → `O`/`P`, `A` → `L`/`M`/`I`/`J`.

Signatuuri lupaa vain että sopiva asento on olemassa; sen **etsii geometria**
(`swapPlacement`, sama funktio kuin haarakohdan kaarenvaihdossa). Vaihdon on
päädyttävä täsmälleen samaan päätyporttiin — suunta, taso ja liitin samat,
sijainti alle 0,2 mm:n päässä. Siksi vaihto ei liikuta muuta rataa lainkaan
eikä sillä ole omaa päätyheittoa.

Kokoelmasta puuttuva pala **tarjotaan silti**, mutta merkittynä ja kalliina: se
päätyy listan hännille eikä koskaan ensimmäiseksi. Osaluettelo sivulla 4 kertoo
sitten mitä pitäisi hankkia.

## 3. Poisto ja aukkomerkki (`remove.ts`)

README: "Poisto jättää aukkomerkin: täytä automaattisesti (Solver) / piirrä
tilalle / kumoa."

Radan **keskeltä** poisto on välitila: `removeSection` ei tuota valmista rataa
vaan esikatselun ja aukkomerkin — kaksi avointa päätyporttia ja mitta niiden
välillä. Kartta piirtää merkin katkoviivana, ja toimintorivi vaihtuu neljään
vastaukseen: **jätä auki / täytä / piirrä tilalle / kumoa.**

"Jätä auki" on niistä lopputulos, ja se puuttui aluksi. Ilman sitä poistosta ei
koskaan tullut valmista: täyttö ja piirto rakensivat palat takaisin ja kumous
palautti vanhan, joten poistonappi ei poistanut mitään. Avoin rata on kuitenkin
rata siinä missä silmukkakin — piirtämällä sellaisen saa muutenkin — joten
esikatselun saa myös pitää.

Radan **päästä** poisto ei ole välitila lainkaan vaan toteutuu suoraan: siellä
ei ole aukkoa vaan kiskonpää, joka siirtyy taaksepäin, eikä siitä ole mitään
kysyttävää (`docs/EDITING.md`).

**Muokattava rata on koko ajan alkuperäinen.** Kaikki vastaukset lähtevät
siitä: täyttö ja piirto saavat saman osion kuin ennen poistoa, ja kumoaminen on
pelkkä esikatselun hylkäys. Rikkinäistä välitilaa ei siis ole olemassa, vaikka
kartalla näkyy aukko.

Sauma pysyy poistossa siellä missä oli — poisto ei kosketa sitä vaan avaa radan
toisaalta. Siksi esikatselu kantaa alkuperäisen kireysprosentin, ja aukko näkyy
merkkinä eikä lukuna.

### Automaattinen täyttö

"Täytä" on Track Solver: pelkkiä suoria päätyportista päätyporttiin kokoelman
rajoissa, purkautuneet palat mukaan lukien. Sama `insertIntoRun`-koneisto kuin
vaihteen upotuksessa, mutta **tyhjällä ytimellä** — koko väli on täyttöä.

Siitä seuraa yksi rehellinen rajoitus: aukon päiden on oltava samalla linjalla.
Mutkan yli venytetyn valinnan jälkeen ne eivät ole, ja Solver sanoo sen suoraan
sen sijaan että arvaisi kaaria väliin. Piirtäminen tilalle toimii silloinkin.

### Miksi pitkä suora jää usein ilman vaihtoehtoja

Tyhjä vastaus ei yleensä johdu paloista vaan **tilasta**. Lähes jokainen kuvio
tarvitsee tilaa radan viereen, ja lattian laitaan tai toisen raiteen viereen
jäävällä osuudella sitä ei ole — sivutila mitataan sekä radan muihin paloihin
että alueen reunaan. Rataa täynnä olevalla lattialla se on nolla melkein
kaikkialla, ja silloin vain mäki (joka ei tarvitse sivutilaa) ja suoristus
kelpaavat.

Se on rehellinen rajoitus, mutta se pitää myös sanoa. README luku 0: tyhjä
vastaus ei ole vastaus, ja kun mitään ei ole tarjottavaa, syyn on oltava
**mitattu tosiasia**. Kaksi yleisintä syytä mitataan suoraan:

- **Yhden palan korvausluokka on tyhjä.** E-kaarelle ei ole toista palaa, joka
  päättyisi samoihin portteihin — se on kirjastosta luettava tosiasia, ei
  algoritmin väsähdys. Statusrivi nimeää palan ja neuvoo venyttämään valintaa,
  koska pidemmällä osiolla vaihtoehtoja on enemmän.
- **Sivutilaa ei ole kummallakaan puolella.** Silloin kerrotaan tilasta eikä
  paloista.

Vasta jos kumpikaan ei päde, jäljelle jää yleinen "ei löytynyt vaihtoehtoja".

Toinen, aiemmin näkymätön syy oli täyttötaulukon katto. Taulukko kattoi vain
2160 mm, joten sitä pidemmän osuuden väliä ei voinut täyttää lainkaan — pitkä
suora hylkäsi kaikki kuviot, ja valintaa piti lyhentää ennen kuin mitään
tarjottiin. Katto on nyt olohuoneen lattian mitta.

## 3.5 Suoristus: yksinkertaisin vaihtoehto mutkalle

Valmiit kuviot upotetaan **suoralle** osuudelle: kuvio korvaa osan siitä ja
loput täytetään suorilla. Mutkittelevalle osuudelle ei siis kelpaa yksikään
niistä, ja siksi "Vaihtoehdot" jäi sellaisella tyhjäksi — vaikka mutkalla on
yksi ilmeinen vaihtoehto, jota kuviokirjastossa ei ole: **suora**.

Mutka, joka lähtee ulos ja palaa takaisin, kuluttaa paloja saamatta aikaan
mitään mitä suora ei saisi. Suoristus tarjotaan, kun geometria sen sallii:
päätyporttien on osoitettava samaan suuntaan ja loppuportin on oltava
alkuportin suoralla. Sivuttaisheiton nielee Vario-budjetti, ja `assembleTrack`
hylkää sen jos se ei mahdu — arvaamiselle ei jää sijaa.

Koneisto on sama `insertIntoRun` tyhjällä ytimellä kuin aukon täytössä. Ero on
yksi luku: täyttö saa pituudekseen **päätyporttien välin** eikä purettavien
palojen nimellispituutta. Juuri sen erotuksen verran mutka oikenee, ja siksi
suoristus lyhentää rataa vaikka päätyportit pysyvät paikallaan.

Jo valmiiksi suoraa osuutta ei tarjota suoristettavaksi: alle yhden lyhimmän
suoran oikaisu ei näy lattialla eikä säästä palaa.

## 4. Variaatiokuviot dataa (`data/variations/`, `variations.ts`)

Kuviokirjasto on dataa kuten palat ja elementit: uusi kuvio on rivi JSONia eikä
koodimuutos. Kuvio on osuuden **ydin** — se lähtee osuuden alkuportista, päätyy
samaan suuntaan samalle tasolle eikä siirry sivusuunnassa, jolloin loput
osuudesta täytetään suorilla sen molemmin puolin.

README luvun 6 seitsemän kuviota ovat kaikki mukana (`kind`-kenttä):

| Kuvio | `kind` | Etenemä | Sivutila |
|---|---|---|---|
| Sivuraide puskurilla | `siding` | 108–144 mm | 99–164 mm toisella puolella |
| Ohituskaide | `passing-loop` | 576 mm | 118 mm toisella puolella |
| S-kiemura | `s-bend` | 622 mm | 64 mm molemmin puolin |
| Pullistuma | `bulge` | 311 / 571 mm | 64 / 118 mm toisella puolella |
| Mäki | `hill` | 684 / 756 mm | ei mitään |
| Viisto venytys | `skew` | 648 mm alkaen | 157 mm alkaen |
| T/X-risteys + haara | `junction` | 216 mm | 256 mm toisella puolella |

Vaatimuksia ei kirjoiteta dataan: ne **mitataan kuviosta itsestään**. Etenemä on
ytimen läpimenevä matka ja sivutilan tarve sen keskilinjojen ääriarvot. Näin
data ei voi valehdella geometriasta, ja mitat pysyvät oikeina myös silloin kun
kuvion palat vaihtuvat kokoelman mukaan.

### Kaksi asiaa tekee kuviosta parametrisen

**Täyttöaskel** (`fill`) on pituusväli, ei paloja: sivuraiteen pituus ja
ohituskaiteen rinnakkaissuora valitaan vasta kun tiedetään paljonko tilaa on.

**Linkki** (`link`) sulkee umpisilmukan: ohituskaiteen sivuraide palaa toiseen
vaihteeseen. Geometria tarkistaa sulkeutumisen — suunta, taso ja liitin
täsmälleen, sijainnin heiton nielee Vario — joten datassa ei tarvitse laskea
mitään käsin. Väärä kuvio ei ratkea, eikä se pääse rataan.

Ohituskaide on hyvä esimerkki siitä, miten data joutuu tottelemaan
palajärjestelmää: jälkimmäinen vaihde kuljetaan takaperin, ja siksi se on **J**
eikä M. J on I liitinsukupuolet päinvastoin, joten sen kauempi pää ottaa
vastaan tapin ja sen haaraportti kolon — juuri tähän koko pala on olemassa.
Silmukka ei sulkeudu eksaktisti (45°:n kaaret vaihteiden välissä), vaan noin
4,7 mm jää liitosten nieltäväksi. Sama syy kuin palakirjaston H2:ssa.

### Miksi geometria ensin ja palat vasta sitten

Pituusyhdistelmiä on kymmeniä, ja valtaosa niistä karsiutuu jo geometriaan.
Siksi täyttöaskel on ensimmäisellä kierroksella pelkkä **siirtymä eteenpäin**:
kohdistin liikkuu, mutta paloja ei etsitä. Vasta selvinneille yhdistelmille
haetaan oikeat palat kokoelmasta. Sovitus on nopea myös puhelimella — koko
osuuden ratkaisu on kymmeniä millisekunteja.

### Kaaret eivät osu gridiin

Suorista koottu kuvio (mäki, sivuraide) täyttää osuuden eksaktisti, mutta
kaarista koottu ei: 45° tuottaa √2-murtolukuja. Silloin täyttö napsautetaan
lähimpään täytettävään pituuteen ja jäännös jää Varion nieltäväksi
(`snapFill`). Se on sama toleranssibudjetti kuin silmukan saumassa, ja se
tarkistetaan kattoineen ennen kuin kuviota tarjotaan — ei siis toivota parasta
vaan mitataan.

## 5. Pisteytys ja esitys (`solve.ts`)

README: "Pisteytys: monipuolisuus (uusi elementtityyppi = bonus), inventaario,
joustobudjetti."

- **Monipuolisuus** mitataan radasta: jos kuvion paloja ei vielä ole radalla,
  se saa bonuksen. Ensimmäinen sivuraide muuttaa radan luonnetta, kolmas ei enää.
- **Inventaario**: puuttuva pala ei estä ehdotusta muttei myöskään voita
  vertailua.
- **Joustobudjetti**: kireä rata on kallis, koska jokainen kuvio kuluttaa
  Variota ja sen pitää näkyä.

Vaihtoehtoja tarjotaan enintään kolme, ja **samaa kuviotyyppiä vain kerran**:
kaksi lähes samanlaista haamua kartalla ei ole valinta vaan sotku. Vaihdot ja
kuviot kilpailevat samassa listassa, koska ne vastaavat samaan kysymykseen.

Esitys on sama kuin haarakyselyissä (`docs/BRANCHING.md`): haamut kartalle,
numerolaput haamujen päälle, samat vaihtoehdot toimintorivin nappeina ja
palamuutoskortti statusrivillä. Kortti kertoo **netton** — "käyttää 1×L,
vapauttaa 1×D" — koska osuuden uudelleentäyttö purkaa ja palauttaa samoja
suoria eikä kirjanpito kerro käyttäjälle mitään.

Kysymyksen ollessa auki päätykahvat piilotetaan: kahvan osuma-alue on sormen
kokoinen ja se peittäisi juuri ne haamut, joita on tarkoitus napauttaa.

## Mikä jäi tekemättä

- **Kumoa/tee uudelleen** koko muokkaushistorialle (README luku 7,
  tilasnapshotit). Nyt kumoaminen koskee vain aukkoa, ja paluu käy generoimalla
  tai piirtämällä uudelleen — generoitu, piirretty ja muokattu rata elävät yhä
  rinnakkain.
- **Muokatun radan jako linkillä** (README luku 9): jako kantaa yhä vain
  siemenen ja asetukset, ja sivu 4 sanoo sen suoraan.
- Kuvioiden **peilaus koodissa**: vasen ja oikea variantti ovat omat rivinsä
  datassa, koska vaihdetta ei saa kääntää nurin (kielet ovat päällä) — peilikuva
  on eri pala, ei sama pala toisin päin.
