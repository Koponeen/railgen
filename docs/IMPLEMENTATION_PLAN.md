# Toteutussuunnitelma

Tämä dokumentti vaiheistaa README.md:n spesifikaation toteutettavaksi. README on totuuden lähde suunnittelupäätöksille; tämä dokumentti kertoo *missä järjestyksessä, millä työkaluilla ja millä mallilla* työ tehdään. Kielilinjaus: dokumentaatio suomeksi, koodi, tiedostonimet, URL:t ja commit-viestit englanniksi.

---

## 1. Scope-tarkistus: havaitut ristiriidat ja ratkaisut

Nämä käytiin läpi ennen toteutusta, jotta niitä ei ratkota lennossa keskellä koodausta.

| # | Ristiriita / aukko | Ratkaisu |
|---|---|---|
| R1 | CLAUDE.md: "Käyttöliittymän kieli suomi" vs. uusi vaatimus monikielisyydestä | **i18n alusta asti.** Kaikki UI-tekstit käännösavaimina erillisissä lokaalitiedostoissa (`locales/fi.json`, `locales/en.json`). Suomi on oletuskieli. Koodissa, URL:eissa ja parametreissa vain englantia. CLAUDE.md päivitetty vastaavasti. |
| R2 | Toteutusjärjestyksen vaihe 1 kattaa "sivut 1, 2, 4" — mutta generointinappi asuu sivulla 3 | Vaihe 1 sisältää sivun 3 **minimiversiona**: vain "Generoi uudelleen" + siemenen näyttö. Piirto ja muokkaus tulevat myöhemmissä vaiheissa samaan näkymään. |
| R3 | "Palakirjasto on dataa, ei koodia" vs. erikoisgeometrian "oma piirtopolku" (README §8 taso 3) | Piirtopolku on **SVG-polkudataa JSON-kentässä**, ei koodia. Koodi tulkitsee kolmea palatasoa (parametrinen / yhdistelmä / erikois), mutta yksittäinen pala ei koskaan vaadi kooditiedoston muutosta. |
| R4 | Determinismi ("sama siemen → sama rata") vs. pisteytys "N ehdokasta eri siemenillä, paras valitaan" | Käyttäjän siemen on **pääsiemen**, josta N ehdokassiementä johdetaan deterministisesti (seeded PRNG, esim. splitmix-johdanto). Sama pääsiemen + asetukset → sama voittaja aina. |
| R5 | Vario-budjetti: "kaaret suuremmalla kertoimella" — kerrointa ei ole määritelty | Kerroin on **palakirjaston dataa** (`varioFactor`, oletus kaarille 1.5, suorille 1.0), ei kovakoodattu. Säädettävissä asetuksista kuten taivutusoletuskin. |
| R6 | Jako URL:lla: käsin muokattu rata "pakattuna URL:iin" vs. URL-pituusrajat | Tiivis binäärienkoodaus → base64url. Jos serialisointi ylittää ~2000 merkkiä, näytetään rehellinen ilmoitus ("rata liian suuri linkkijakoon") — Worker+KV-lyhytlinkit ovat myöhempi laajennus, eivät vaiheen 1 scopea. |
| R7 | Vaihe 0 "elerunko puhelimella" edellyttää, että omistaja pääsee testaamaan puhelimella | Cloudflare-deploy pystytetään **jo vaiheessa 0** (muuten puhelintestaus ei onnistu). Infra on vaiheen 0 osa, ei erillinen vaihe. |
| R8 | Palojen nimet näkyvät UI:ssa (osaluettelo, ostoslista) — mutta palakirjasto on kieletöntä dataa | Palakirjassa vain ID:t (`"A1"`, `"E"`, …) ja mitat. Näyttönimet ovat käännösavaimia (`piece.A1.name`) lokaalitiedostoissa. Uusi custom-pala ilman käännöstä → fallback ID:hen. |

**Avoimet kysymykset omistajalle** (eivät estä vaiheita 0–1):

1. Aloituskielet fi + en, muut myöhemmin — riittääkö?
2. Domain-nimi (vaikuttaa vasta julkaisuun, ei koodiin).

---

## 2. Tekniset valinnat

- **TypeScript + Vite + Preact.** Preact (~4 kt) omistaa UI-kromin: sivut, lomakkeet, inventaariolistat, osaluettelot, toimintorivit, palamuutoskortit. **SVG-kartta ja ele-engine ovat Preactin ulkopuolella** — oma imperatiivinen saareke (Pointer Events + CSS-transform suoraan, ei virtuaali-DOM-diffiä elesilmukassa), jolle Preact antaa vain propsit ja callbackit. Muita runtime-riippuvuuksia ei oteta.
- **Vitest** yksikkötesteihin (geometria, budjetti, determinismi, solver-täyttö).
- **Cloudflare Workers static assets** + wrangler; deploy GitHub-integraatiolla.
- **Oma kevyt i18n-moduuli** (~50 riviä): JSON-lokaalit, `t(key, params)`-interpolointi, kielen valinta `?lang=` → localStorage → `navigator.language` → `fi`. Ei i18next-riippuvuutta.

### Hakemistorakenne

```
data/
  pieces/          # palakirjasto (JSON, ei koodia)
  elements/        # elementtikirjasto (makropalat)
  variations/      # autosolverin variaatiokuviot
locales/
  fi.json          # oletuskieli
  en.json
src/
  core/            # geometry, ports, transforms, vario budget, rng
  gen/             # area mask, cell route, element pick, mutations, scoring
  fit/             # drawing cleanup (RDP) + beam-search fit
  edit/            # section selection, end handles, replace by drawing
  render/          # SVG from geometry, PNG export
  ui/              # pages, gesture engine, ghost previews
  i18n/            # loader + t()
docs/
  IMPLEMENTATION_PLAN.md
  PIECE_LIBRARY.md GENERATION.md UI.md DRAWING.md EDITING.md BRANCHING.md
  VARIATIONS.md
```

### UI-linjaukset (sitovat)

1. **Ei komponenttikirjastoa.** Tarvittavat komponentit (napit, stepperit, checkboxit, kortit, alapalkki) tehdään itse; tyylit modernilla vanilla-CSS:llä (custom properties, nesting). Komponenttikirjastot tuovat työpöytäoletuksia ja painoa.
2. **Kartta on sankari.** Sivuilla 3–4 kromi minimiin: koko ruutu karttaa, toimintorivi alalaidassa peukalon ulottuvilla. Epäselvyydet ratkaistaan haamuesikatseluina kartalla, ei dialogeina (README §6).
3. **Sormimitoitus**: kaikki kosketuskohteet ≥ 44 px. Numerosyötöt +/−-steppereinä, ei pieninä tekstikenttinä. Sivunavigointi isoilla välilehdillä alareunassa.
4. **Visuaalinen kieli puulelusta**: vaalea pohja, radat laudanvärisinä (lämmin beige + urat), aksenttivärinä BRIO-punainen. Tumma tila `prefers-color-scheme`-perusteisesti custom propertyillä alusta asti.
5. **Yksi näkymä = yksi tehtävä**: ensikäytössä lineaarinen polku sivut 1→2→3→4; kun localStoragessa on asetukset, palataan suoraan sivulle 3.

### i18n-säännöt (sitovat)

1. Yhtään käyttäjälle näkyvää merkkijonoa ei kirjoiteta koodiin — kaikki `t()`-avaimien kautta.
2. Avaimet englanniksi, pisteillä ryhmiteltynä (`area.title`, `result.partsList`, `piece.A1.name`).
3. Uusi kieli = yksi uusi JSON-tiedosto, ei koodimuutoksia.
4. Yksiköt ja luvut formatoidaan `Intl.NumberFormat`-perusteisesti lokaalin mukaan.
5. `fi.json` on referenssi; CI-tarkistus (myöhemmin) valittaa muiden lokaalien puuttuvista avaimista.

---

## 3. Vaiheet, mallivalinnat ja commitit

Mallijako: **Opus** tekee algoritmisesti kriittisen ja virheherkän työn (geometria, generointi, sovitus), **Sonnet** UI:n, renderöinnin ja infran, **Haiku** mekaanisen työn (lokaalitiedostojen synkronointi, datansyöttö valmiiseen skeemaan, dokumenttipäivitykset). Yksi commit per vaihe (poikkeus vaihe 1, jossa kolme luonnollista osaa) — yhteensä ~8 committia.

### Vaihe 0 — Elerunko + infra *(Sonnet)*

README §10 kohta 0: "jos tämä ei tunnu hyvältä, mikään ei pelasta."

- Vite + TS + Preact + Vitest -pohja, wrangler-konfiguraatio, deploy toimimaan asti.
- Ele-engine: Pointer Events, `pointerId`-seuranta, kaksi sormea navigoi aina, napautus/veto-erottelu (<8 px, <300 ms), piirtotilan stubi (raaka viiva näkyviin, toinen sormi peruu), `touch-action: none` kartalle, zoom/pan CSS-transformilla eleen aikana.
- Kartta–Preact-rajapinta lyödään lukkoon tässä vaiheessa: kartta imperatiivisena saarekkeena, Preact-kromi sen ympärillä (props/callbackit).
- Tyhjä SVG-kartta + i18n-moduuli + `fi.json`/`en.json`-rungot.
- **Valmis kun**: omistaja on testannut eleet omalla puhelimellaan deploysta.
- **Commit**: `Scaffold app shell with gesture engine, i18n and CF deploy`

### Vaihe 1a — Geometriaydin ja paladata *(Opus; datansyöttö skeemaan Haiku)*

- Palaskeema (3 tasoa), porttimalli (45°-lokerot, tappi/kolo), porttisignatuurit, muunnokset (rotaatio, peilaus), jalanjäljet.
- BRIO-peruspalasto `data/pieces/` -hakemistoon README §2:n mitoilla; epäselvät mitat tarkistetaan woodenrailway.infosta, ei arvata.
- Vario-budjettilaskenta kattoineen (2 mm/3° oletus, 3 mm/5° katto, kaarikerroin datasta), kireysprosentti.
- Solver-taulukko datana + segmentintäyttö inventaariorajoittein.
- Seeded PRNG + determinismitestit; geometrian invarianttitestit (suorat eksakteja 18 mm gridissä, porttisuunnat 45°-monikertoja, silmukan sulkeuma ≤ budjetti).
- **Commit**: `Add geometry core, piece library and tolerance budget`

### Vaihe 1b — Generointiputki *(Opus)*

- Aluemaski (suorakaide/L) → solureitti → elementtivalinta signatuurilla ja inventaariopainotuksella → mutaatiot (oikotie, ylikulku, X, lisäsilmukka, mäki; jokainen validoidaan ja hylätään siististi) → saumat ja budjettivalidointi → N ehdokkaan pisteytys pääsiemenestä (R4).
- Elementtikirjaston ensimmäiset ~10 elementtiä (läpikulku, 90°-kulma, U-käännös, T-haara, risteämä).
- Golden-seed-testit: tunnetut siemenet tuottavat pysyvästi saman radan.
- **Commit**: `Add track generation pipeline`

### Vaihe 1c — Sivut 1, 2, 3-minimi, 4 *(Sonnet; en.json-täydennys Haiku)*

- Sivu 1: alue (suorakaide/L, max 4 lukua, pikakoot). Sivu 2: inventaario, skippaus→ostoslista, joustopala-checkbox, localStorage. Sivu 3-minimi: generoi/uudelleen + siemen (R2). Sivu 4: SVG-tulos geometriadatasta, pituus, äärimitat, osaluettelo, PNG/printti, jako-URL (R6).
- Kaikki tekstit lokaaleista; en.json synkassa.
- **Valmis kun**: julkaisukelpoinen sellaisenaan (README:n kriteeri).
- **Commit**: `Add area, inventory, generate and result pages`

### Vaihe 2 — Piirtotila tyhjästä *(Opus-algoritmi, Sonnet-UI-kytkentä samaan committiin)*

- RDP-siivous, keilahakusovitus (~10 ketjua, siksak-sakko, taipuvan korkea kustannus), sulkeuma budjettiin, inventaariorajat ja "vaatisi 2×E lisää" -raportti.
- **Commit**: `Add freehand drawing mode with beam-search fitting`

### Vaihe 3 — Osion korvaus piirtämällä *(Opus)*

- Luonnollisen jakson valinta, liukuvat päätykahvat, sovitus kiinnitetyillä päätyporteilla, purkautuvat palat inventaarioon.
- Toimintorivistä toteutetaan vain **Piirrä tilalle**; "Vaihtoehdot" ja "Poista" ovat vaiheen 5 autosolveria.
- **Commit**: `Add section replacement by drawing`

### Vaihe 4 — Lisäävä piirto + haara-/risteämiskyselyt *(Opus-logiikka, Sonnet-haamuesikatselut)*

- Haara mutkaan -logiikka (jäykät kaaret, liukuvat suorat, haaroittavat kaarivaihdot), haamuesikatselut kartalla, risteämän X/silta-valinta.
- **Commit**: `Add additive drawing with branch and crossing resolution`

### Vaihe 5 — Vaihda/poista + autosolver *(Sonnet, Opus tarkistaa variaatiokirjaston geometrian)*

- Porttisignatuurilistat ("vaihda toiseen"), poiston aukkomerkki, autosolverin 7 variaatiokuviota parametrisena datana, palamuutoskortit.
- **Commit**: `Add swap, delete and autosolver variations`
- **Toteutettu**: kuviot ovat dataa (`data/variations/`) ja niiden vaatimukset mitataan geometriasta, ei kirjoiteta dataan. Kaikki muokkaukset kokoavat radan samasta paikasta (`assemble.ts`), ja upotus-ja-täytä -koneisto on yhteinen vaihteen, risteyksen, sillan ja kuvion kesken. Ks. `docs/VARIATIONS.md`.

### Vaihe 6 — Haarapiirto lattiatestin jälkeen *(Opus)*

Ensimmäinen käyttökerta oikealla radalla nosti esiin kolme asiaa, jotka spesifikaatio lupasi muttei toteutus antanut.

- **Tyhjennä.** Generoitu rata esti oman radan piirtämisen: radan vierestä alkava veto on aina haara. Tyhjä pöytä on nyt oma tilansa, ja generoitu rata jää siemenensä taakse.
- **Yhdistävä haara.** Radalle asti piirretty viiva jäi kiinni vain toisesta päästään. Toinen pää saa nyt oman vaihteensa; palojen liitinsukupuoli ratkaisee kumman pään palat kelpaavat (`L`/`M`/`T` lähtöön, `J`/`P` päätökseen).
- **"Vaihde ei mahdu" siellä missä tilaa on eniten.** Mäkielementti kääntää liitinparillisuuden, joten mäen jälkeiselle suoralle ei mahtunut yhtään vaihdetta. Sukupuolenvaihtaja varataan nyt osuuden päähän samalla tavalla kuin BRIO:ssa itsessään.
- Lisäksi: käyttämätön haaraportti maksaa (kolmisuuntainen vaihde ei enää jätä irrallista kiskonpäätä kevyesti), risteämä tarjotaan myös lyhyemmän haaran rinnalla, haarakohtaa haetaan kauempaa jos osoitettuun kohtaan ei mahdu, ja ratkaisemattomasta ylityksestä tarjotaan tynkä kieltäytymisen sijaan.
- **Commit**: `Fix branch drawing: clear board, connecting branches and gender-changing runs`

### Vaihe 7 — Radan päät ja poisto *(Opus)*

Toinen lattiatesti nosti esiin, että koodi ei tuntenut radan **avoimia päitä** lainkaan — sama puute näkyi kolmena eri vikana.

- **Jatko päästä.** Kiskonpään vieressä veto luki tilanteen haaraksi ja työnsi vaihteen viereen. Nyt avoin pää on haarakohta, joka ei lisää mitään, ja se on oletus pään ympärillä. Radan kaksi päätä jatkuvat eri tavoin: koloportista ketju rakennetaan päätä kohti.
- **Poisto.** Radan päästä poisto ei tuottanut mitään, koska vapaa pää luettiin porttipariksi ja aukko tarjottiin täytettäväksi takaisin. Nyt päästä poisto toteutuu suoraan, ja keskeltä poistetun aukon saa myös jättää auki.
- **Suoristus.** Mutkittelevalle osuudelle ei kelvannut yksikään valmis kuvio, koska kaikki upotetaan suoralle. Yksinkertaisin vaihtoehto — suora — on nyt oma ehdotuksensa.
- **Haarautuminen suoralta.** Osion korvattavuus vaati naapuria valinnan ulkopuolelta, jolloin pelkistä suorista koostuva avoin rata — yksi ainoa luonnollinen jakso — ei kelvannut haarakohdaksi. Puuttuva naapuri on kuitenkin radan avoin pää eikä este: osuuden pituus säilyy, joten kiskonpää pysyy paikallaan. Este on vain valinta, joka sulkeutuu itseensä.
- Lisäksi valinnan mittasuhteet: zoomaus ei enää mene palan mittaan, ja päätykahvat ovat puolet entisestä.
- **Commit**: `Continue from rail ends, make deletion final and offer a straight` ja `Branch from a run whose ends are rail ends`

### Vaihe 8 — Yksi ehto ei riitä kolmelle napille *(Opus)*

Kolmas lattiatesti. Neljä havaintoa, neljä eri syytä.

- **Toimintorivi lukkiutui kokonaan.** Kaikki kolme nappia jakoivat ehdon `replaceable`, joten haaran omaava vaihde harmaannutti myös "Vaihtoehdot" — vaikka palan vaihto ei siirrä mitään. Napit saivat omat ehtonsa: vaihto ei vaadi mitään, piirto vaatii kiinteät päätyportit, poisto vain sen ettei valittuna ole koko rata.
- **Poisto haaran alta.** Keskeltä lähtevä haara esti poiston. Nyt se ei estä: haara jää lattialle irralleen, kuten oikeastikin kävisi. Vaihdossa katkeava liitos pudotetaan kirjanpidosta (`jointHolds`), jottei kartta väitä kiinnitystä jota ei ole.
- **Pitkä suora ilman vaihtoehtoja.** Kaksi syytä: täyttötaulukko kattoi vain 2160 mm, joten sitä pidempää väliä ei voinut täyttää lainkaan, ja loput karsi sivutila. Katto nostettiin, ja tilan puute kerrotaan nyt omana syynään.
- **Kohtisuora haara sai mutkan.** `T` sai risteyksen sakon, vaikka se on yhden haaran vaihde. Sakko rajattiin aitoihin risteyksiin.
- **Commit**: `Give each section action its own condition`

### Vaihe 9 — Pääperiaate kirjattuna ja toteutettuna *(Opus)*

Omistaja tiivisti tavoitteen säännöksi, joka voittaa muut: **jos käyttäjä piirtää jotain johonkin, se on toteutettava jotenkin.** Tekemättä ei jätetä ehdottamatta jotain; käyttäjä suodattaa itse onko ehdotuksessa järkeä. Työkalu tekee mallia junaradasta leikkejä varten, ei tarkista sääntöjä.

- Periaate on nyt README luku 0, ennen ydinideoita — se on ylin sääntö, ei yksityiskohta.
- Keinojen järjestys parhaimmasta huonoimpaan on sekin kirjattu: tee pyydetty → tee osa siitä → tee se toisin → tee se irrallaan.
- **Irrallinen rata** toteuttaa viimeisen portaan: kun mikään ei kiinnity, palat menevät lattialle viivan alle ilman liitosta. Se ei mene päällekkäin muun radan kanssa eikä koskaan syrjäytä kiinnittyvää vaihtoehtoa.
- Periaatteesta seuraa myös, ettei irrallisuutta tarvitse pelätä: poisto saa jättää haaran roikkumaan ja vaihto katkaista liitoksen. Kiellettyä on vain valehteleva kirjanpito.
- **Commit**: `Always answer a stroke with something`

**Kesken:** sama periaate ei vielä päde palan vaihtoon eikä osuuden vaihtoehtoihin — kummankin tyhjä vastaus on yhä mahdollinen. Ne ovat seuraava vaihe.

Jokainen vaihe on itsenäisesti julkaistava, ja rata on joka välivaiheessa ehjä — epäonnistunut mutaatio tai sovitus ei koskaan jätä rikkinäistä tilaa näkyviin.

### Haiku — jatkuvat tehtävät

Lokaalitiedostojen avainsynkronointi, palakirjaston datarivien lisäys valmiiseen skeemaan, dokumenttien pikkupäivitykset, testifiksturien generointi. Ei koskaan geometria- tai algoritmimuutoksia.

---

## 4. Commit-käytännöt

- Commit-viestit englanniksi, imperatiivissa, yksi rivi + tarvittaessa body.
- Yksi commit per vaihe; korjaukset samaan vaiheeseen squashataan ennen pushia (`--force-with-lease` vain omalle feature-branchille).
- Ei committeja, joissa rata/testit ovat rikki.
