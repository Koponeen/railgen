# BRIO-ratageneraattori

Nettisivulla toimiva generaattori, joka luo satunnaisia BRIO-yhteensopivia puujunaratalayoutteja annetulle lattia-alueelle ja käytettävissä oleville paloille. Suunniteltu **puhelinkäyttöön** ja **olohuonemittakaavaan** (iltapäiväleikki, ei leikkihuoneen jättiradat). Myös IKEA Lillabo -osat huomioidaan.

Tämä dokumentti on projektin suunnitteluspesifikaatio. Toteutusta ei ole vielä aloitettu.

---

## 1. Ydinideat tiivistettynä

1. **Kaikki laskenta selaimessa.** Generointi, sovitus, törmäystarkistus ja piirto ovat kevyttä geometriaa — palvelin ei generoi mitään.
2. **Deterministisyys**: sama siemen + samat asetukset → sama rata. Jakaminen = URL.
3. **Elementtipohjainen kaksitasomalli**: layout koostuu elementeistä (makropaloista), elementit paloista. Vaihtokelpoisuus määritellään *porttisignatuurilla*.
4. **"Runko → toteutus → mutaatiot"**: pohjaksi toimiva silmukka, satunnaisuus tulee elementinvaihdoista ja paikallisista mutaatioista. Rata on joka välivaiheessa ehjä.
5. **Toleranssibudjetti**: sulkeutumista ei tavoitella eksaktisti. BRIO:n Vario-jousto (ja valinnainen taipuva pala) nielee heiton — sama malli kuin BRIO:n omissa seteissä.
6. **Piirretty viiva = vaihtoehtoinen rungon lähde.** Piirtotila, osion korvaus ja autosolver käyttävät samaa sovituskoneistoa.

---

## 2. Palajärjestelmä ja geometria

Lähde: [woodenrailway.info Track Guide](https://woodenrailway.info/track/brio-track-guide) ja [Track Math](https://woodenrailway.info/track/track-math).

### Mitat

- Suorat: A2 = 54 mm, A1 = 108 mm, A = 144 mm, D = 216 mm (harvinainen A3 = 72 mm).
- Kaaret: aina 45° (1/8 ympyrää). E: sisäsäde 182 mm (keskilinja ~202 mm). E1: sisäsäde 90 mm (keskilinja ~110 mm).
- Lauta 40 mm leveä, urat 26 mm keskietäisyydellä. Tasoero (N-ramppi): 64 mm / 216 mm matkalla.
- Liittimet sukupuolitettuja (tappi/kolo). Asetus "salli kääntö/adapterit" löysää rajoitetta.

### Grid

- **Mikrogrid 18 mm**: kaikki suorapituudet ovat 18 mm:n monikertoja (54=3u, 72=4u, 108=6u, 144=8u, 216=12u). Suorat ovat gridissä eksakteja.
- Kaaret eivät osu gridiin (45° → √2-murtoluvut). Tämä on järjestelmän perusominaisuus, ei virhe — ks. Vario.
- **Loginen solu 216 mm** (= D). 2×E-kulma vie ~202×202 mm eli mahtuu soluun ~14 mm:n heitolla. E1-kulma (~110×110) mahtuu puoleen soluun.
- **Sovituspituus 432 mm**: 1 D = 2 A1 = 4 A2 ja 2 D = 3 A → 432 mm on lyhin matka, jonka voi täyttää kummalla pituusperheellä tahansa.

### Vario-järjestelmä ja toleranssibudjetti

- Jokainen liitos venyy ~2–3 mm ja taipuu muutaman asteen. Kaaret joustavat selvästi suoria enemmän; lyhyet suorat osuudet joustavat vähiten.
- BRIO:n omatkin setit (esim. 33125-kahdeksikko) eivät sulkeudu CAD-tarkasti — Vario tekee niistä toimivia.
- **Budjetti per silmukka** = liitosmäärä × venymä (oletus 2 mm) + liitosmäärä × taivutus (oletus 3°, säädettävä), kaaret suuremmalla kertoimella.
- **Turvakatto per liitos** (~3 mm / ~5°): budjetin pitää paitsi riittää myös jakautua, muuten liitokseen syntyy juna­n suistava terävä kulma. Loppuvirhe jaetaan sauman lähiliitoksille ja katot tarkistetaan.
- Radalle voidaan näyttää **"kireysprosentti"** = kulutettu jousto / budjetti.

### Taipuva pala (checkbox)

- Käyttäjän oma, 3D-tulostettu pala joka kääntyy vapaasti 0–45°. Virallista BRIO-joustopalaa ei ole — Vario on BRIO:n virallinen joustomekanismi.
- Sivun 2 checkbox "Joustopala käytössä" + lukumäärä. Parametrit (pituushaarukka, maksimitaivutus) ovat palakirjaston dataa, eivät kovakoodattuja.
- Joustopala = *keskitettyä* toleranssia, Vario = *hajautettua*. Sama virhebudjettimatematiikka, checkbox muuttaa vain budjetin kokoa.
- Skippaustilassa (rajattomat peruspalat) joustopala oletuksena POIS, koska ostoslistalla saa olla vain kaupasta saatavia paloja.
- Sulkemisvaiheessa varataan yksi taipuva per suljettava sauma etukäteen.
- Ilman joustopalaa osa muodoista ei sulkeudu → rehellinen virheilmoitus ("jää 23 mm vajaaksi"), ei suistavaa rataa.

### Korvausluokat (BRIO:n sisäänrakennetut)

Vaihde voidaan laittaa peruspituisen suoran paikalle ja päinvastoin:

| Luokka | Palat |
|---|---|
| 216 mm (D) | D, T-risteys, X-tähtiristeys, K, **N-ramppi** |
| 144 mm (A) | A, L/M-kaarrevaihteet, I/J, F1/G1, H2, Q |
| 108 mm (A1) | A1, O1/P1, H-risti |
| E-kaari | E, H3-kaariristeys (=2×E) |
| E1-kaari | E1, O/P (=2×E1) |
| Sillat | kannet 144 (=A), 216 (=D), 324 (=A1+D), 360 (=A+D) |

Lisäksi "venytettävät kulmat": E–A2–E, E–A1–E jne. (viistosuora kaarien välissä venyttää sädettä).

---

## 3. Elementtiarkkitehtuuri

**Elementti** = makropala, jolla on:

- **Portit**: liitospisteet reunalla (sijainti, suunta 45°-lokeroissa, liitintyyppi). *Kaksi elementtiä ovat vaihtokelpoisia, jos porttisignatuuri on sama.*
- **Jalanjälki**: tilavaraus soluina/mm + tasotieto.
- **Palakustannus**: multiset inventaariosta.
- **Muunnosmetadata**: peilaus, sallitut rotaatiot, **venymäakseli** (suorien pituusyhdistelmien vaihto + taipuvan portaaton jousto → "täyttää välin 25–40 cm").
- **Tunnettu virhe**: elementin heittokontribuutio silmukan toleranssibudjettiin (esim. 2×E-kulman ~14 mm).

Porttikuri: porttien sijainnit solun reunalla vakioidaan (esim. solusivun keskellä, kohtisuoraan) — muuten vaihtokelpoisuus rikkoutuu.

Risteyselementtien ylimääräiset portit ovat lisäreittien kiinnityspisteitä. Risteämä-signatuurilla on kaksi toteutusta: **X-pala samassa tasossa** tai **silta tasolla 2** (ramppi–kansi–ramppi) — tasoasetus ja inventaario ratkaisevat.

Elementtikirjaston koko: ~10–20 elementtiä + muutama reittistrategia. Signatuurit: läpikulku, 90°-kulma, U-käännös, T-haara, risteämä.

---

## 4. Generointiputki

1. **Aluemaski**: alue jaetaan soluihin (216 mm), muoto = solumaski (suorakaide tai L = suorakaide miinus nurkka).
2. **Solureitti**: arvotaan suljettu silmukka solukossa (kehäkierto + satunnaiset sisäänpistot). Solun rooli määräytyy siitä, mistä sivuista reitti kulkee.
3. **Elementin valinta per solu**: roolin signatuuria vastaava elementti arvotaan, painotettuna jäljellä olevalla inventaariolla.
4. **Lisäreitit/mutaatiot**: risteyselementtien vapaista porteista reititetään uusia reittejä takaisin silmukkaan. Käytetyn solun ylitys → risteämä-elementti (X tai ylikulku). Mutaatiotyypit: oikotie, ylikulku, X-risteys, lisäsilmukka, mäki. Jokainen mutaatio validoidaan itsenäisesti ja hylätään siististi jos ei mahdu — runko pysyy aina ehjänä.
5. **Saumat**: taipuvat + Vario-budjetti nielevät heiton. Budjettilaskuri validoi silmukat.
6. **Pisteytys**: N ehdokasta eri siemenillä, paras valitaan (inventaarion käyttöaste, täyttöaste, risteysten/ylikulkujen määrä, sakko tylsyydestä, kireysprosentti).

Törmäystarkistus: elementit omistavat solunsa → tarkistettavaa vain solun sisällä (kerran käsin) ja tasojen välillä (alituskorkeus 64 mm × tasoero).

3+ tasoa: ylikulku voi kohdistua jo kohotettuun osuuteen; ylemmät tasot aina lyhyempiä (tukipalojen määrä kasvaa nopeasti). Tuet joko inventaariopalana tai raportoituna ("tarvitset 6 tukea").

**Segmenttien täyttö**: Track Solver -taulukko ([lähde](https://woodenrailway.info/layout/tracksolver.html)) datana; satunnaistettu valinta ekvivalenssien sisällä inventaariorajoittein. Kolmannen osapuolen pala: vähennä pituus välistä, katso loput taulukosta.

---

## 5. Piirtotila ja sovitusalgoritmi

Piirretty viiva = vaihtoehtoinen rungon lähde. Sama alavirta kuin satunnaisgeneroinnissa.

1. **Siivous**: harvennus + silotus (Ramer–Douglas–Peucker), skaalaus alueen millimetreihin.
2. **Sovitus keilahaulla**: nykyisestä asemasta (sijainti+suunta) kokeillaan jokaista palaa (suorat, kaaret L/R kahdella säteellä, taipuva), mitataan poikkeama piirretystä viivasta, pidetään ~10 parasta ketjua. Haarautumiskerroin < 10 → reaaliaikainen.
3. **Sulkeutuminen**: suljettu viiva → taipuva/Vario-budjetti viimeiseen saumaan.
4. **Inventaario**: sovitus inventaarion rajoissa tai raportti "vaatisi 2×E lisää".

Säätökohteet: siksak-sakko (suunnanvaihdoista sakotetaan), 45°-lokerointi, taipuvalle korkea käyttökustannus (ei tuhlata keskelle rataa). Piirretty viiva on *aikomus, ei komento* — sormen vapina absorboituu suunnitellusti.

**Haara mutkaan** (piirto osuu kaarelle): kaaret ovat jäykkiä pisteitä, suorat liukuvia ankkurivyöhykkeitä (vaihde voi asettua suoralle mihin kohtaan vain uudelleentäytöllä). Ehdokkaat: suora ennen mutkaa, suora mutkan jälkeen, kaaren vaihto haaroittavaan (H3/O/P/I/J, pakkosuunta). Jos yksi voittaa selvästi → automaattinen; muuten **haamuesikatselut kartalla** (2–3 vaihtoehtoa, napautus valitsee). Jos mikään ei kelpaa → syy + lähin mahdollinen haarakohta. Nappausetäisyys ~1 solu.

---

## 6. Muokkaus ja autosolver

**Osion valinta**: napautus suoralle osuudelle valitsee koko *luonnollisen jakson* (katkeaa koviin kohtiin: kaaret, vaihteet, rampit). Päätykahvat liukuvat rataa pitkin, napsahtavat palarajoihin. Toimintorivi: **Vaihtoehdot / Piirrä tilalle / Poista** — kaikki kolme saavat samat päätyportit.

**Osuuden tehtävänanto**: päätyportit, pituus (18 mm gridissä), sivuttaistila (käytävä molemmin puolin), taso, inventaario + purkamisesta vapautuvat palat. Näytetään käyttäjällekin ("82 cm, sivutilaa 25 cm vasemmalla").

**Autosolverin variaatiokuviokirjasto** (parametrisia, vaatimukset: minimipituus, sivutila, palat):

- Sivuraide puskurilla (vaihde + pätkä + puskuri)
- Ohituskaide (L – rinnakkaissuora – M)
- S-kiemura (pelkkiä kaaria, sivutilaa molemmin puolin)
- Pullistuma (puolikaari ulos ja takaisin)
- Mäki (N ylös – kansi – N alas; ≥ ~650 mm, ei sivutilaa)
- Viisto venytys (kaari–viistosuora–kaari)
- T/X-risteys + haara

Pisteytys: monipuolisuus (uusi elementtityyppi = bonus), inventaario, joustobudjetti. Esitys: 2–4 haamuesikatselua + palamuutoskortti ("käyttää 1×L, 1×M · vapauttaa 1×D"). Valinnan venytys mutkien yli muuttaa päätysuuntia → radikaalimpia ehdotuksia.

**Palan napautus** → "vaihda toiseen" -lista saman porttisignatuurin toteutuksista. **Poisto** jättää aukkomerkin: täytä automaattisesti (Solver) / piirrä tilalle / kumoa.

**Yhtenäinen kuvio**: kaikki epäselvyydet (haaran paikka, risteämän tyyppi, autosolver) ratkaistaan haamuesikatseluilla kartalla, ei dialogeilla.

---

## 7. Käyttöliittymä

### Sivut

1. **Alue**: suorakaide (leveys × syvyys) tai L (suorakaide + leikattu nurkka), max 4 lukua. Pyöritys on vain esitystason asia. Pikakoot ("matto 2×1,5 m").
2. **Palat**: lukumäärät per tyyppi. Skippaus = rajattomat peruspalat → tulos on ostoslista. Admin-määriteltävät esiasetukset (settikohtaiset). Joustopala-checkbox. Tallennus localStorageen.
3. **Generoi/piirrä/muokkaa**: satunnaisgenerointi tai piirto; muokkaus (osion korvaus, lisäävä piirto, vaihto, poisto); risteämiskyselyt; juokseva osaluettelo (punainen kun inventaario ylittyy).
4. **Tulos**: selkeä kuva koko radasta, radan pituus (keskilinjasumma), äärimitat (jalanjälkien bbox + marginaali), lopullinen osaluettelo, printti (kuva + lista samalle arkille), jako. Monitasoisille tasovalitsin (myöhemmin).

### Eleet (puhelin ensin)

- **Universaali sääntö: kaksi sormea navigoi aina** (nipistys = zoom, veto = pan), tilasta riippumatta.
- Katselutila (oletus): 1 sormi panoroi, napautus valitsee. Piirtotila (eksplisiittinen, lyhytikäinen): 1 sormi piirtää.
- Napautus vs veto: < ~8 px ja < ~300 ms = napautus.
- Toinen sormi kesken piirron → viiva perutaan, siirrytään navigointiin (= myös kämmenentunnistus).

### Tekniikka

- **Pointer Events** (`pointerId`-seuranta, `pointerType` kynälle bonus). Ei touch/mouse-tuplakoodia.
- **`touch-action: none`** kartalle — ottaa selaimen oletuseleet pois. Muu sivu normaalisti.
- **SVG, geometriadatasta piirretty** (ei kuvatiedostoja): yksi totuuden lähde, taipuva pala mahdollinen, terävä joka zoomilla, DOM-interaktiivisuus ilmaiseksi. PNG vain vientimuotona (SVG → canvas).
- Zoom/pan: juuri-`<g>` translate+scale; eleen aikana CSS-transform (GPU), lopullinen tila eleen päättyessä.
- Piirto: `getCoalescedEvents()`; raaka viiva heti näkyviin, sovitus adaptiivisesti (nopea laite: live, hidas: sormen noustessa).
- Osumat: näkymätön tuplapolku (`stroke: transparent; stroke-width: ~30px`); kohteet ≥ 44 px; toimintorivi alalaitaan.
- Valinta → automaattinen zoomaus osuuteen + paluu kokonäkymään.
- **Elerunko rakennetaan ja testataan puhelimella ensimmäisenä**, ennen generaattorin kytkemistä.
- Kumoa/tee uudelleen: tilasnapshotit (data pientä).

---

## 8. Admin: custom-palat

Palakirjasto = JSON repossa + esikatselusivu. `git push` julkaisee; git antaa versiohistorian. Kolme vaikeustasoa:

1. **Parametriset**: `{tyyppi: "suora", pituus: 72}` — portit, jalanjälki ja piirto johdetaan automaattisesti.
2. **Yhdistelmät**: lista primitiiveistä + liitoskohdat (vaihteet: "L = A + E").
3. **Erikoisgeometria**: portit käsin, oma piirtopolku.

**Korvausluokkiin liittyminen automaattista** porttisignatuurin kautta — generointikoodiin ei kosketa. Validointi: porttisuunnat 45°-monikertoja (tai "vaatii varioa" -lippu), liittimet, jalanjälki. Käyttötapaukset: A3 (72 mm), IKEA Lillabo -osat, 3D-tulostetut erikoisosat, taipuva pala.

---

## 9. Infra (Cloudflare, 0 €/kk)

- **Hosting**: Cloudflare Workers static assets (SPA), deploy GitHubista.
- **Tila**: inventaario ja asetukset localStorageen. Ei käyttäjätilejä.
- **Jako**: seed + asetukset URL:iin; käsin muokattu rata serialisoituna pakattuna URL:iin. Tarvittaessa Worker + KV -lyhytlinkit.
- **Domain**: Cloudflare Registrar (~10 €/v). **Analytiikka**: CF Web Analytics (evästeetön).
- Myöhemmin ehkä: D1 (yhteisögalleria: seed+asetukset+nimi), Turnstile (spam).

---

## 10. Toteutusjärjestys

0. **Elerunko puhelimella** (zoom/pan/piirto/valinta tyhjällä kartalla) — jos tämä ei tunnu hyvältä, mikään ei pelasta.
1. **Ydin**: satunnaisgenerointi + sivut 1, 2, 4. Julkaisukelpoinen sellaisenaan.
2. Piirtotila tyhjästä.
3. Osion korvaus piirtämällä (sama sovitus, kiinnitetyt päät).
4. Lisäävä piirto + risteämis-/haarakyselyt.
5. Vaihda/poista + autosolver-variaatiot (kevyitä signatuurikoneiston päälle).

Jokainen vaihe on itsenäisesti julkaistava.

---

## Lähteet

- [BRIO Track Guide](https://woodenrailway.info/track/brio-track-guide) — mitat, palataulukko, Vario
- [Track Math](https://woodenrailway.info/track/track-math) — ekvivalenssit, sillat, venytetyt kulmat
- [Track Distance Solver](https://woodenrailway.info/layout/tracksolver.html) — 18 mm grid, täyttötaulukko
- [Basic Loops](https://woodenrailway.info/layout/guide/basicloop.html) — L–A1–M ym. liitäntämitoitukset
- Sivuston risteysohjeet (Sidings-sivut) hyviä elementtikirjaston pohjaksi; layout-oppaat mitoitettu liian isoille radoille.
