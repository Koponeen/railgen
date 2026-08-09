# Käyttöliittymä

Toteuttaa README luvun 7 sivut 1, 2, 3-minimi ja 4. Puhelin ensin: kaikki ratkaisut on
testattu 390 × 844 px:n ruudulla sormella, ei hiirellä.

## Rakenne

```
App.tsx              sivujen valinta, asetusten tallennus, generoinnin ajastus
pages/AreaPage       sivu 1: alue (suorakaide / L, pikakoot, esikatselu)
pages/InventoryPage  sivu 2: palat, skippaus, joustopala
pages/GeneratePage   sivu 3 minimi: kartta + generoi uudelleen + siemen
pages/ResultPage     sivu 4: kartta, mitat, osaluettelo, PNG, tulostus, jako
TrackMap.tsx         Preact-kääre imperatiiviselle kartalle
mapEngine.ts         kartan tila, eleet ja piirto (Preactin ulkopuolella)
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

Vaiheessa 1c jaetaan siemen + asetukset, mikä mahtuu reilusti rajan alle. Käsin muokatun
radan serialisointi tulee vaiheessa 2, ja silloin tiiviimpi binäärienkoodaus voi olla
tarpeen.

## Tunnetut esitystason yksityiskohdat

- **Sauma näkyy pienenä lovena.** Rata ei sulkeudu geometrisesti täsmälleen, vaan
  Vario-jousto nielee heiton (README luku 2). Piirto näyttää palat nimellisgeometriassaan,
  joten jäännös näkyy yhtenä kapeana rakona. Kireysprosentti kertoo saman luvun numerona.
  Jäännöksen jakaminen liitoksille myös piirrossa on luonteva parannus siinä vaiheessa, kun
  palojen sijainteja muutenkin hienosäädetään (vaihe 2).
- **Radan sijainti lattialla vaihtelee.** Pisteytys palkitsee täyttöasteesta muttei
  keskityksestä, joten pieni rata voi asettua lattian laitaan.
