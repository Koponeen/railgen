# Osion korvaus piirtämällä

Toteuttaa README luvun 6 siltä osin kuin toteutusjärjestyksen kohta 3 vaatii:
**luonnollisen jakson valinta, liukuvat päätykahvat, sovitus kiinnitetyillä
päätyporteilla ja purkautuvien palojen palautuminen inventaarioon.**
"Vaihtoehdot" (autosolver) ja "Poista" käyttävät samaa valintaa ja samaa
tehtävänantoa; ne on kuvattu erikseen `docs/VARIATIONS.md`:ssä.

```
napautus -> luonnollinen jakso -> päätykahvat -> veto -> sovitus päästä päähän -> uusi rata
            section.ts            section.ts     beam.ts   replace.ts             build.ts
```

Muokkaus käyttää **samaa sovituskoneistoa** kuin tyhjästä piirtäminen
(`docs/DRAWING.md`). Ero on yksi: molemmat päät ovat kiinnitettyjä portteja.

## 1. Luonnollinen jakso (`section.ts`)

Napautus suoralle osuudelle valitsee koko jakson, joka katkeaa **koviin
kohtiin**: kaariin, vaihteisiin, ramppeihin ja sillan kansiin. Kovaa palaa
napautettaessa osio on se yksi pala — kahvoilla sitä voi sitten venyttää.

Ketju kuljetaan porttien kautta, ei taulukkojärjestyksessä: liitoslista kertoo
naapurit, ja se kumpi niistä on ketjussa edellä, päätellään siitä kumpi
naapureista koskettaa palan ulostuloporttia. Sivuhaaran jälkeen taulukkojärjestys
ei enää vastaa ketjun järjestystä, joten porteista lukeminen on ainoa tapa saada
osio oikein päin. Osumatoleranssi on 8 mm, koska sulkeutumisjäännös on jaettu
liitoksille (`relaxClosure`) eivätkä portit siksi osu täsmälleen päällekkäin.

**Osio ei omista paloja.** Se on näkymä rataan: joukko indeksejä ja kaksi
kiinnitettyä kehystä. Kartta korostaa mitä sille annetaan, mutta rajaussäännöt
asuvat täällä, jotta sama logiikka palvelee valintaa, toimintoriviä ja korvausta.

### Milloin osiota ei voi korvata

- **Keskeltä lähtee haara.** Purkaminen jättäisi haaran roikkumaan irralleen.
  Ulos johtavia liitoksia saa siis olla vain osion päissä.
- **Osio kattaa koko radan.** Silloin ei ole päätyportteja, joihin kiinnittyä.
- **Päät ovat eri tasolla** (mäki). Sovitus sijoittaa vain tasaisia paloja.

Kaikissa tapauksissa valinta onnistuu ja näkyy kartalla, mutta "Piirrä tilalle"
on pois käytöstä ja statusrivi kertoo miksi.

## 2. Liukuvat päätykahvat

Kahva napsahtaa **palarajoihin**, ei mihin tahansa kohtaan. Ehdokkaat lasketaan
suoraan: osiota kutistetaan pala kerrallaan ja kasvatetaan ketjua pitkin
enintään 14 palaan; sormea lähin ehdokas voittaa. Nykyinen osio on aina
ehdokkaana, joten kahvan voi vetää takaisin lähtöpaikkaansa.

Kasvattaminen saa mennä **kaarien yli**, ja silloin päätyportin suunta kääntyy —
juuri se tekee ehdotuksista radikaalimpia (README luku 6).

Kahvan koko on vakio *ruudulla*, ei maailmassa: sormi on aina yhtä paksu, vaikka
kartta olisi zoomattu palan mittaan. Maailmasäde jaetaan siis näkymän
skaalalla. Samasta syystä lyhyttä osiota ei zoomata koko ruudun kokoiseksi —
alle 648 mm:n valinta jättäisi kontekstin näkymättä.

## 3. Osuuden tehtävänanto

Sama tieto näytetään käyttäjälle ja syötetään myöhemmin autosolverille:

| Kenttä | Mistä |
|---|---|
| pituus | osion palojen keskilinjasumma |
| taso | alkupään kehyksestä |
| sivuttaistila vasemmalla / oikealla | osion keskilinjan ja lähimmän esteen väli |
| vapautuvat palat | osion palojen lukumäärät |

**Sivuttaistila** mitataan osion keskeltä: päissä naapuripalat ovat määritelmän
mukaan kiinni eivätkä kerro tilasta mitään. Esteitä ovat radan muut palat
*samalta tasoväliltä* (ylikulku ei vie sivutilaa) ja lattia-alueen reuna. Vapaa
tila on keskilinjaväli miinus laudan leveys, koska kaksi puolikasta lautaa
mahtuu aina väliin. Mittaus katkeaa 648 mm:iin: kauempi vapaa lattia ei enää
kerro mitään.

## 4. Sovitus kiinnitetyillä päätyporteilla (`replace.ts`)

Keilahaku saa kaksi uutta ehtoa (`beam.ts`):

- **Aloituskehys on annettu.** Tyhjästä piirrettäessä alkusuunta arvataan
  viivasta ja kolme lähintä 45°-lokeroa kokeillaan; tässä suunta on tiedossa
  eikä sitä saa arvata.
- **Päätekehys on maali.** Ketju kelpaa vain jos sen suunta, taso ja liitin
  täsmäävät *täsmälleen* ja sijainti on 40 mm:n sisällä. Suuntaa ei voi jakaa
  liitoksille, koska `Placement.rot` on kokonainen 45°:n lokero — väärä lokero
  näkyisi mutkana liitoksessa. Vajaaksi jäävä ketju ei siis kelpaa lainkaan,
  toisin kuin vapaassa piirrossa.

Piirretty viiva ankkuroidaan päistään portteihin, ja sen saa vetää **kummasta
päästä tahansa**: suunta päätellään siitä kumpi pää on lähempänä kumpaa porttia.
Vedon on yletyttävä päästä päähän (vähintään 60 % porttien välimatkasta), koska
muuten ankkurointi venyttäisi osion keskelle raapaistun töherryksen viivaksi,
joka hyppää portilta töherryksen luo ja takaisin.

### Päätyheiton jako

Osiossa on n palaa ja **n+1 liitosta** (molemmat päätyliitokset mukaan lukien).
Jäännös jaetaan siirtämällä palaa i osuudella `(i+1)/(n+1)`, jolloin alkupää
avautuu yhtä paljon kuin loppupää eikä kumpikaan kiinnitetty portti liiku. Sama
malli kuin silmukan sauman `relaxClosure`, nyt kahden kiinteän pään välissä.

Heitto tarkistetaan **osion omaa budjettia** vastaan: se on syntynyt tässä ja sen
on mahduttava tähän. Koko radan kireysprosentti taas laskee yhteen alkuperäisen
sauman ja korvauksen heitot — jokainen korvaus kuluttaa Variota, ja se pitää
näkyä.

### Purkautuvat palat

Korvaukselle käytettävissä oleva kokoelma on **käyttäjän palat miinus se, mikä
on kiinni muualla radalla**. Purettava osio vapauttaa palansa takaisin, joten
tasan rataan riittävällä kokoelmalla voi silti muokata: neljä D:tä palaa
hyllyyn ennen kuin uusi osuus rakennetaan.

Loput menee kuten vapaassa piirrossa: ensin omilla paloilla, ja vasta jos se ei
onnistu, rajattomilla ja puuttuvien listalla.

### Mikä hylätään

Ketju, joka ei ylety päätyportteihin budjetin sisällä, jonka liitos ylittää
turvakaton, tai joka toisi radalle uuden törmäyksen. Törmäyslaskuria verrataan
alkuperäiseen eikä nollaan, koska monitasoisessa radassa se voi olla valmiiksi
nollaa suurempi.

**Alkuperäinen rata jää aina koskemattomaksi.** Epäonnistunut korvaus palauttaa
vain syyn, ja valinta säilyy niin että kahvoja voi venyttää ja yrittää uudelleen
(CLAUDE.md: rata on joka välivaiheessa ehjä).

## Miksi tehtävä on aina ratkaistavissa

Osio itse on kelvollinen vastaus omaan tehtäväänsä: se lähtee alkuportista ja
päättyy loppuporttiin. Sovitus ei siis voi olla mahdoton — jos se epäonnistuu,
syy on piirretyssä muodossa eikä algoritmissa, ja käyttäjälle voi sanoa sen
suoraan.

## Käyttöliittymä

Napautus valitsee osion ja kartta zoomaa siihen; napautus tyhjään palauttaa
kokonäkymän. Toimintorivi vaihtuu osiotilaan: valinnan sulkeva nappi ja README
luvun 6 kolme toimintoa **Vaihtoehdot / Piirrä tilalle / Poista**, jotka kaikki
saavat saman tehtävänannon (`docs/VARIATIONS.md`). Piirtotila on sama
eksplisiittinen ja lyhytikäinen tila kuin vapaassa piirrossa — yksi veto, ja
kaksi sormea peruu ja navigoi. Kahvan päältä alkava veto on aina osion
venytystä, ei kartan siirtoa.

### Poisto: radan keskeltä kysytään, päästä ei

Poisto on kahta eri asiaa sen mukaan mihin se osuu.

**Radan keskeltä** poisto jättää aukon: kaksi avointa päätyporttia ja mitta
niiden välillä. Aukko on kysymys, ja siihen on neljä vastausta — jätä auki,
täytä Solverilla, piirrä tilalle tai kumoa. "Jätä auki" on niistä
lopputulos: avoin rata on rata siinä missä silmukkakin, ja ilman sitä
poistosta ei koskaan tullut valmista — jokainen nappi vain palautti palat
takaisin.

**Radan päästä** poisto toteutuu suoraan. Siellä ei ole aukkoa vaan kiskonpää,
joka siirtyy taaksepäin, eikä siitä ole mitään kysyttävää. Osio tunnistetaan
radan pääksi siitä, että sen toisella puolella ei ole naapuria
(`section.before` tai `section.after` on null). Ilman tätä eroa piirretyn
haaran päätä ei saanut poistettua lainkaan: koodi luki vapaan pään
porttipariksi, valitti aukosta ja tarjosi vain sen täyttämistä takaisin.

Onnistunut korvaus purkaa valinnan (indeksit viittaisivat vanhaan rataan) ja
jättää muokatun radan näkyviin. Ilman valintaa radan vierestä alkava veto ei ole
korvaus vaan uusi haara (`docs/BRANCHING.md`). Muokattu rata syrjäyttää generoidun ja
piirretyn, kunnes käyttäjä generoi uudelleen tai muuttaa asetuksia — kaikki
kolme elävät rinnakkain, joten paluu on aina auki.
