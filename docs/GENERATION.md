# Generointiputki

Toteuttaa README luvun 4. Kaikki lasketaan selaimessa, ja sama siemen + samat
asetukset tuottavat aina saman radan.

```
aluemaski -> solureitti -> runko -> mutaatiot -> materialisointi -> validointi -> pisteytys
  mask.ts     route.ts     skeleton.ts  mutate.ts    build.ts        build.ts      score.ts
```

`generate.ts` ajaa putken N kertaa pääsiemenestä johdetuilla ehdokassiemenillä ja
palauttaa parhaan (R4).

## 1. Aluemaski (`mask.ts`)

Lattia jaetaan 216 mm:n soluihin. Muoto on suorakaide tai L (suorakaide miinus nurkka).
Solukko keskitetään alueelle, jolloin reunoille jää tasainen marginaali.

## 2. Solureitti (`route.ts`)

"Kehäkierto + satunnaiset sisäänpistot". Kierros aloitetaan satunnaisen suorakaiteen
kehältä ja sitä muokataan työntämällä osa suorasta osuudesta sivuun. Molemmat
operaatiot säilyttävät yksinkertaisen suljetun kierroksen, joten reitti ei voi rikkoutua.

**Osuuden minimipituus on kaksi solua.** 2 × E -kulma vie 202 mm sisään ja 202 mm ulos,
joten yhden solun (216 mm) osuuteen ei mahdu kulmaa kummastakaan päästä.

Kehän koko rajataan inventaarion mukaan: käytettävissä oleva ratapituus asettaa
enimmäiskehän ja kaarten määrä enimmäiskulmamäärän. Ilman tätä iso kehä valittaisiin
ensin ja hylättäisiin vasta materialisoinnissa.

## 3. Runko ja sulkeutuminen (`skeleton.ts`)

Tämä on putken matemaattinen ydin.

Solureitti puretaan **kulmiksi** ja **suoriksi osuuksiksi**. Kulma on elementti, jonka
mitat ovat `along` (siirtymä sisääntulon suunnassa) ja `across` (siirtymä poikittain);
symmetrisellä kulmalla ne ovat yhtä suuret. Kulma "leikkaa" terävän kulmapisteen:
se alkaa `along` ennen kulmapistettä ja päättyy `across` sen jälkeen.

Osuuden pituus on siis

```
run_i = legLen_i - across_i - along_(i+1)
```

Terävä solupolyline sulkeutuu määritelmän mukaan, ja kulmien sisään- ja
ulostulomitat kumoutuvat kierroksen yli. **Ennen pyöristystä rata sulkeutuu siis
täsmälleen** — myös silloin kun kulmien säteet ovat erilaisia.

Ainoa virhe syntyy siitä, että `run_i` on pyöristettävä pituuteen, jonka suorilla voi
täyttää. Pyöristys tehdään **virheen diffuusiolla**: osuudet käydään akseleittain läpi ja
kukin pyöristetään siihen pituuteen, joka vie kumulatiivisen summan lähimmäksi tavoitetta.
Näin virhe ei kasaannu vaan jää viimeisen askeleen suuruiseksi.

Jäännös on tyypillisesti muutamia millejä. Se voi olla suurempi, kun osuus on hyvin lyhyt:
täytettävät pituudet ovat harvassa lähellä nollaa (54 mm:n askel, ei 18 mm:n). Jäännös
menee Vario-budjetin nieltäväksi, ja `evaluateClosure` päättää kelpaako se.

`skeleton.test.ts` tarkistaa, että rungon ilmoittama jäännös vastaa sekä analyyttisesti
laskettua sulkeumaa että materialisoidun radan todellista aukkoa.

## 4. Mutaatiot (`mutate.ts`)

Mutaatiot muokkaavat **runkoa**, eivät valmiita paloja. Jokainen palauttaa uuden rungon
tai syyn, miksi se ei sovellu; kutsuja materialisoi tuloksen ja hylkää sen, jos rata ei
kelpaa. Mutaatio ei koskaan muuta saamaansa runkoa.

| Mutaatio | Mitä tekee |
|---|---|
| `swap-corner` | Vaihtaa kulman toiseen toteutukseen ja tasapainottaa osuudet uudelleen. |
| `shift-length` | Siirtää 18 mm osuudelta toiselle sulkeutumista rikkomatta. |
| `refill-run` | Arpoo yhden osuuden täytön uudelleen samasta ekvivalenssiluokasta. |
| `hill` | Ramppi ylös, kansi, ramppi alas suoralle osuudelle. |
| `siding` | Sivuraide puskurilla: vaihde + pätkä + puskuri. |
| `shortcut`, `extra-loop` | Uusi reitti takaisin silmukkaan — vaatii reititystä, ei vain palan vaihtoa. |
| `overpass`, `x-crossing` | Toinen reitti silmukan yli tai läpi — sama tilanne. |

`hill` ja `siding` upotetaan suoralle osuudelle. Molempien **pääreitti on yhtä pitkä kuin
korvaamansa suora**, joten silmukan geometria ei muutu lainkaan eikä sulkeutumista tarvitse
laskea uudelleen: mäen ramppi–kansi–ramppi kulkee osuuden suuntaisesti, ja vaihteen suora
sivu on tarkalleen A:n tai A1:n mittainen. Juuri tästä syystä README luvun 2 korvausluokat
ovat olemassa.

Kaksi viimeistä riviä odottavat reititysalgoritmia (README luku 5:n sovituskoneisto,
toteutussuunnitelman vaihe 4). Palat niihin ovat jo kirjastossa.

## 5. Materialisointi ja validointi (`build.ts`)

Runko kuljetaan läpi kohdistimella: kulmaelementti, mahdollinen mäki, sitten osuuden
täyttö Solver-taulukosta inventaarion rajoissa. Jokainen vaihe joko onnistuu kokonaan tai
palauttaa null ja vapauttaa varauksensa.

Rata hyväksytään vain jos:

1. sulkeutumisvirhe mahtuu Vario-budjettiin,
2. yksikään liitos ei ylitä turvakattoa,
3. rata ei törmää itseensä, ja
4. rata pysyy alueen sisällä.

Törmäystarkistus näytteistää keskilinjat ja vertaa niitä pareittain. Vain tasoväliltään
limittäiset palat voivat törmätä — ylikulku on nimenomaan sallittu.

## Liittimen sukupuoli on suljetun silmukan invariantti

Tavallinen BRIO-pala on kolo → tappi. Suljetussa silmukassa jokainen liitos menee oikein
päin **täsmälleen silloin**, kun yhtään tällaista palaa ei kuljeta väärinpäin: yksikin
väärinpäin kuljettu pala rikkoo kaksi liitosta, eikä toinen väärinpäin kuljettu korjaa sitä.

Mäki tarvitsee laskevan rampin, joka on nimenomaan väärinpäin kuljettu ramppi. Ratkaisu ei
ole asetus vaan pala: BRIO myy **sukupuolivariantteja** (B/C, B1/C1, B2/C2) juuri tähän.
Mäki on siis

```
N ylös → kansi → C2 (kaksi koloa) → N alas → B2 (kaksi tappia)
```

C2 ottaa käännöksen vastaan kannen päässä ja B2 palauttaa parillisuuden alas tultaessa.
Rata on koko matkan tiukasti sukupuolioikea, eikä "salli kääntö/adapterit" -asetusta tarvita.
Lähde sanoo B2/C2:sta suoraan: *"arguably the single most useful track pieces because they
can solve both gender alignment and track gap issues"*.

Sukupuolivariantteja **ei käytetä yleisenä täytteenä** (`library.fillerStraights()` jättää ne
pois) — muuten täyttö rikkoisi parillisuuden umpimähkään.

## Naapuruus kirjataan, ei päätellä

Sivuraiteen jälkeen palojen taulukkojärjestys ei enää vastaa ketjun järjestystä: haaran
palat ovat vaihteen ja seuraavan pääraiteen palan välissä. Siksi materialisointi kirjaa
liitokset erikseen (`Track.joints`), ja törmäystarkistus ohittaa nimenomaan ne parit.
Sauma on mukana listassa, koska se ei sulkeudu täsmälleen eikä sitä voi päätellä porttien
osumisesta.

## Pisteytys (`score.ts`)

Painotettu summa: täyttöaste 30, inventaarion käyttöaste 25, palatyyppien monipuolisuus 15,
muodon kiinnostavuus 15, tasoerikoisuudet 15, kireysprosentti −20. Tasapelit ratkaistaan
ehdokassiemenellä, jotta voittaja on aina sama.
