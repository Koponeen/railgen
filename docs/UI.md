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
