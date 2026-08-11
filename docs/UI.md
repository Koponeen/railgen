# Käyttöliittymä

Toteuttaa README luvun 7 sivut 1, 2, 3 ja 4. Puhelin ensin: kaikki ratkaisut on
testattu 390 × 844 px:n ruudulla sormella, ei hiirellä.

## Rakenne

```
App.tsx              sivujen valinta, asetusten tallennus, generoinnin ajastus
pages/AreaPage       sivu 1: alue (suorakaide / L, pikakoot, esikatselu)
pages/InventoryPage  sivu 2: palat, skippaus, joustopala
pages/GeneratePage   sivu 3: kartta + generoi uudelleen + piirto + siemen
pages/ResultPage     sivu 4: kartta, mitat, osaluettelo, PNG, tulostus, jako
TrackMap.tsx         Preact-kääre imperatiiviselle kartalle
mapEngine.ts         kartan tila, eleet ja piirto (Preactin ulkopuolella)
ghosts.ts            kumpaa haamua napautus tarkoitti
drawing.ts           piirretyn radan tila ja virheilmoitukset
components.tsx       stepper, valinta, kytkin, kortti, toimintorivi
```

Preact omistaa kromin; **kartta on imperatiivinen saareke**, jolle Preact antaa vain alueen
ja radan. Preact ei koskaan renderöi kartan sisältöä uudelleen.

## Sitovat linjaukset käytännössä

- **Ei komponenttikirjastoa.** `components.tsx` on koko kirjasto: stepper, valintarivi,
  kytkin, kortti, toimintorivi. Tyylit vanilla-CSS:llä custom propertyillä.
- **Sormimitoitus.** `--tap: 44px` on jokaisen kosketuskohteen minimi. Numerot säädetään
  +/− steppereillä, ei tekstikentillä; ainoa tekstikenttä on siemen, joka on tekstiä.
- **Kartta on sankari.** Sivuilla 3 ja 4 kromi on minimissä ja toimintorivi alalaidassa.
  Pitkällä tulossivulla toimintorivi tarttuu alareunaan (`position: sticky`), jottei se
  karkaa peukalon ulottuvilta.
- **Tumma tila** alusta asti `prefers-color-scheme`-perusteisesti.
- **Yksi näkymä = yksi tehtävä.** Ensikäytössä lineaarinen polku 1 → 2 → 3 → 4; kun
  localStoragessa on asetukset, avataan suoraan sivu 3.

## Piirtotila

Piirtotila on eksplisiittinen ja lyhytikäinen (README luku 7): toimintorivin nappi kytkee
sen päälle, yksi veto sovitetaan (`src/fit/`, ks. DRAWING.md), ja kartta palauttaa tilan
itse katseluun. Preact ei siis omista tilaa yksin — kartta kertoo snapshotissaan milloin
veto päättyi, ja sivu seuraa perässä.

Kaksi sormea navigoi aina ja peruu kesken olevan vedon. Piirretty viiva jää kartalle
haaleana radan alle (`.line.guide`): käyttäjän pitää nähdä sekä se mitä hän piirsi että se
mitä siitä tuli. Piirtotila näkyy myös kartan reunuksessa, ei pelkkänä painettuna nappina
alalaidassa.

Piirretty rata syrjäyttää generoidun, kunnes käyttäjä generoi uudelleen tai muuttaa
asetuksia — molemmat elävät `App.tsx`:ssä rinnakkain, joten paluu on aina auki.

### Tyhjennä

Generoitu rata on hyvä lähtökohta, mutta se on myös este: radan vieressä alkava veto on
aina haara (`docs/BRANCHING.md`), joten omaa rataa ei pääse piirtämään puhtaalta pöydältä
ennen kuin generoitu on tieltä pois. Siksi toimintorivissä on **Tyhjennä**.

Tyhjä pöytä on tila eikä tyhjä tulos: generoitua rataa ei poisteta vaan se jää siemenensä
taakse, ja **Generoi** tuo sen takaisin. Sama malli kuin piirretyllä ja muokatulla radalla
— paluu on aina auki. Tyhjällä pöydällä generointia ei myöskään ajeta turhaan, koska sen
tulosta ei näytettäisi.

Toimintorivi on nyt nelipaikkainen (Piirrä · Tyhjennä · Generoi · Tulos), mikä on
puhelimen leveydellä maksimi: nimet on pidettävä yhden sanan mittaisina, ja siksi
"Generoi uudelleen" lyheni muotoon "Generoi".

## Valinnan mittasuhteet

Kaksi lukua ratkaisee, näkyykö valittu osuus lainkaan sormien alta.

**Zoomauksen minimi.** Valinta zoomaa osuuteen (README luku 7), mutta lyhyttä
osuutta ei kannata suurentaa ruudun kokoiseksi: yhden palan valinta on
nimenomaan se hetki, jolloin ympäristö ratkaisee — "mihin tämä pala liittyy" on
koko kysymys. Zoomattavan alan minimi on viisi loogista solua (1080 mm); kolme
solua vei liian lähelle, jolloin pala täytti ruudun eikä radasta nähnyt mitään.

**Kahvan koko.** Kahva mitoitetaan ruudulla, ei maailmassa, ja sen halkaisija on
sormimitoituksen minimi. Suhdeluku oli aluksi kaksinkertainen, jolloin nuppi oli
halkaisijaltaan ~88 px ja peitti puolet valitusta osuudesta. Osuma-alue on
nuppia reilusti isompi eikä sitä pienennetty, joten pienempi nuppi ei tee
osumisesta vaikeampaa — se vain päästää näkemään mihin osui.

## Haamun napautus: geometria ratkaisee, ei piirtojärjestys

Kartalla oleva kysymys on 2–3 haamua, ja ne ovat **päällekkäin**: vaihtoehdot
lähtevät samasta kohdasta rataa, täyttävät saman osuuden uudelleen ja eroavat
vasta myöhemmin. Osumapolku on sormea varten leveä (90 mm), joten haamujen
osuma-alueet peittävät toisensa laajalti.

Siitä syntyi vika, joka nähtiin lattialla: **nimilappu lupasi `T`:n ja radalle
tuli `L`/`M`.** Napautus ratkaistiin `document.elementFromPoint`illa, joka
palauttaa *päällimmäisen* elementin — eli aina viimeksi piirretyn haamun, ei
sitä johon sormi osoitti. Vaihtoehdon tunnus ja sen rata olivat siis koko ajan
samasta lähteestä; väärä oli se, mikä vaihtoehto ylipäätään valittiin.

Mitattuna: `extendTrack` ei tuota yhtäkään vaihtoehtoa, jonka `junctionId` ei
esiintyisi sen oman radan `added`-listassa — se hypoteesi ei siis pitänyt.

Vastaus mitataan nyt geometriasta (`ghosts.ts`), ja mitataan siitä osasta, jonka
perusteella vaihtoehdot ylipäätään eroavat toisistaan:

1. **Numerolappu voittaa.** Se on tähtäyspiste, ja se piirretään omana
   kerroksenaan kaikkien haamujen päälle — muuten alemman haamun lappu jäisi
   ylemmän osumapolun alle eikä siihen voisi osua lainkaan.
2. **Muuten lähin *erottava* pala.** Jaetut palat (täsmälleen sama sijoitus
   toisessa haamussa) jätetään pois: niiden napautus ei tarkoita yhtä
   vaihtoehtoa toisen sijaan.
3. **Tasapeliä ei arvata.** Jos kaksi haamua on yhtä lähellä tai sormi osui
   jaettuun osaan, kysymys jää auki — napautus ei ollut valinta muttei myöskään
   peruutus. Vasta haamujen ohi osunut napautus peruu kysymyksen.

Vaihtoehdot ovat yhä myös toimintorivin nappeina, joten valinta ei ole koskaan
kiinni tähtäämisestä.

## Pyöritys on esitystason asia

Pystyssä olevalla puhelimella vaakasuuntainen lattia jäisi kapeaksi kaistaleeksi ruudun
keskelle. README luku 7 sanoo pyörityksen olevan vain esitystason asia, joten kartta kääntää
lattian neljänneskierroksen, kun sen ja ruudun suunta eivät täsmää. Pyöritys on oma
`<g id="orient">`-ryhmänsä juuri-SVG:n sisällä:

- se kuuluu kartan CTM:ään, joten eleet ja osumatestit toimivat sellaisenaan,
- se ei sotke näkymän omaa transformia, jota ele-engine kirjoittaa,
- PNG-vienti poistaa sen, koska kuva halutaan lattian omassa suunnassa.

## Tyylit, jotka menevät myös vientiin

Radan piirtotyylit ovat `trackStyles.ts`:ssä merkkijonona, eivät `style.css`:ssä. Ne
injektoidaan sekä elävään SVG:hen että PNG-vientiin, koska irrallinen SVG ei näe sovelluksen
tyylitiedostoa. Näytöllä käytetään tummaa tilaa, viennissä aina vaaleaa — kuva päätyy
paperille tai jaettavaksi.

## Jakolinkki

`share.ts` pakkaa asetukset kenttäpakattuun merkkijonoon ja siitä base64url-muotoon. Siemen
saa sisältää mitä tahansa tekstiä, myös kenttäerottimen ja emojit. Jos linkki ylittäisi 2000
merkkiä, palautetaan `tooLong` ja käyttäjälle näytetään rehellinen ilmoitus — katkaistua
URL:ia ei koskaan tarjota (R6).

Jaossa on siemen + asetukset, mikä mahtuu reilusti rajan alle. Piirrettyä rataa ei vielä
jaeta linkillä: se ei synny siemenestä, joten sen jakaminen vaatii radan oman
serialisoinnin ja siihen tiiviin binäärienkoodauksen (R6).

## Eleet ja kartan kehykset

Ele-engine kirjoittaa näkymän transformin `#world`-elementtiin, mutta mittaa siirtymät sen
**isäntäkehyksestä** (`world.parentNode`), ei juuri-SVG:stä. Ero ratkaisee: kun kartan ja
ruudun välissä on mikä tahansa muunnos — kuten ruudulle sovitettu neljänneskierros — juuri-
SVG:n koordinaatistossa mitattu veto olisi vinossa. Osumatestit käyttävät edelleen
`world`-elementin omaa CTM:ää, koska ne haluavat millimetrit.

## Tunnetut esitystason yksityiskohdat

- **Radan sijainti lattialla vaihtelee.** Pisteytys palkitsee täyttöasteesta muttei
  keskityksestä, joten pieni rata voi asettua lattian laitaan.
