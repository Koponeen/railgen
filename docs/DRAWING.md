# Piirtotila ja sovitusalgoritmi

Toteuttaa README luvun 5. Piirretty viiva on **vaihtoehtoinen rungon lähde**:
siivouksen ja sovituksen jälkeen alavirta on sama kuin satunnaisgeneroinnissa
(`summariseTrack` kokoaa radan molemmille).

```
raakaveto -> siivous -> kohdeviiva -> keilahaku -> sauma ja inventaario -> rata
             simplify.ts  target.ts    beam.ts        fit.ts               build.ts
```

Sovitus on **täysin deterministinen**: satunnaisuutta ei käytetä lainkaan, joten
sama veto tuottaa aina saman radan. Generoinnin siemenellä ei ole tässä osaa.

## 1. Siivous (`simplify.ts`)

Sormen vapina on kohinaa, ei aikomus.

1. **Harvennus**: alle 5 mm:n askeleet ovat samaa kosketusta.
2. **Ramer–Douglas–Peucker**, toleranssi 14 mm. Toteutus käyttää eksplisiittistä
   pinoa: sahalaitaisessa vedossa jako menee maksimaalisen epätasaisesti, ja
   rekursiivinen versio kaatuisi pinon syvyyteen.

   **Toleranssia ei voi nostaa sormen värinän mittaan.** Se on absoluuttinen
   etäisyys, ja `E`-kaaren nuolikorkeus on 15 mm, `E1`:n 8 mm — sitä suurempi
   toleranssi litistäisi aidotkin kaaret jänteiksi. 14 mm on siis lähellä
   kattoa, ei valinnanvaraa. Kokeiltu: 35 mm (~20° neljänkymmenen sentin
   vedolla) rikkoo piirretyn silmukan sulkeutumisen.

   Se ei silti ole ongelma, koska **sovitus jo hoitaa värinän**: mitattuna
   1,6 metrin veto 40 mm:n siniaaltoisella värinällä sovittuu kahdeksaksi
   suoraksi ja **nollaksi kaareksi** (keskipoikkeama 19 mm). Siksak-sakon
   nostaminen 90:stä 260:een ei muuttanut tulosta lainkaan — värinä ei siis
   tule rataan kaarina, ja suoran ja mutkan raja on jo siellä missä pitääkin.
3. **Suljetun tunnistus**: päät alle loogisen solun (216 mm) päässä toisistaan
   *ja* vetoa vähintään kolme kertaa sen verran. Jälkimmäinen ehto estää lyhyttä
   edestakaista vetoa tulkitsemasta itseään lenkiksi.

Alle 300 mm:n veto hylätään: se on vahinko, ei rata.

## 2. Kohdeviiva (`target.ts`)

Keilahaku kysyy kohdeviivalta kaksi asiaa: kuinka kaukana ehdokaspala on
viivasta ja kuinka pitkälle sitä pitkin päästiin.

**Molemmat kysytään aina ikkunassa nykyisen etenemän ympärillä, ei koko
viivalta.** Ilman ikkunaa itseään lähestyvä piirros hyppäisi: lähin piste voisi
olla aivan toisessa kohdassa rataa, ja sovitus katsoisi edenneensä puoli lenkkiä
yhdellä palalla.

## 3. Keilahaku (`beam.ts`)

Nykyisestä asemasta (sijainti + suunta + liitin) kokeillaan jokaista palaa:
suorat ja kaaret molempiin käsiin. Vaihteet ja risteykset eivät ole mukana —
tyhjästä piirretty rata on yksi ketju. Haarat ja risteämät tulevat lisäävänä
piirtona valmiiseen rataan (`docs/BRANCHING.md`). Haarautumiskerroin on siis ~14 ja keilan leveys 10.

Palan hinta muodostuu neljästä osasta:

| Osa | Miksi |
|---|---|
| poikkeama × palan pituus | pääasia: seuraa piirrettyä viivaa |
| liitoksen hinta (25) | pitkiä paloja suositaan, koska joka liitos kuluttaa Variota |
| siksak-sakko (90) | suunnanvaihdosta sakotetaan (README luku 5) |
| palan käyttökustannus | **taipuvalle korkea**, jottei sitä tuhlata keskelle rataa |

Käyttökustannus johdetaan palan tageista (`flex`, `rare`, `retired`), joten
omistajan lisäämä custom-pala saa oikean hinnan datasta ilman koodimuutosta.

Pala hylätään heti, jos se ajautuu yli 90 mm:n päähän viivasta tai jos se ei
etene vähintään 8 mm — muuten ketju jäisi polkemaan paikallaan.

**Eri pitkälle ehtineet ketjut vertautuvat** arviolla jäljellä olevasta matkasta
(`remainingCostPerMm`). Sama arvio maksaa myös loppuun jäävän matkan, muuten
ketju kannattaisi aina lopettaa heti toleranssin sisällä ja viimeinen pala jäisi
lyhyeksi.

**Aloitussuunta** ei osu 45°:n lokeroon, joten lähimmän lisäksi kokeillaan
molempia naapureita: pelkkä pyöristys voi olla 22,5° pielessä, mikä näkyy heti
ensimmäisessä mutkassa.

## 4. Sauma ja inventaario (`fit.ts`)

### Suuntaheitto painaa enemmän kuin kireys

Sauman virhettä on kaksi lajia, ja ne ovat eriarvoisia:

- **Pituusheiton** `relaxClosure` jakaa liitoksille niin, että silmukka
  sulkeutuu myös kuvassa (sama malli kuin generoinnissa, ks. GENERATION.md).
- **Suuntaheittoa se ei voi jakaa**, koska sijoituksen kierto on kokonainen
  45°:n lokero — `Placement.rot` on lokeroindeksi, ei liukuluku. Jäljelle jäävä
  suuntaero näkyisi mutkana sauman kohdalla.

Siksi valmiista ketjuista valitaan ensin pienimmän suuntaheiton mukaan ja vasta
sitten kireyden mukaan. Keilan kärki on täynnä lähes identtisiä ketjuja, joten
ehdokkaita palautetaan 16: se löysää saumaa selvästi eikä hidasta hakua.

### Inventaario kahdessa vaiheessa

1. Sovitetaan **käyttäjän omilla paloilla**. Jos onnistuu, tämä voittaa aina.
2. Muuten sovitetaan **rajattomilla** ja raportoidaan puuttuvat palat
   (`track.shortages`, "vaatisi 2×E lisää").

Näin oman kokoelman rajoissa pysyvä rata voittaa aina, mutta käyttäjä saa silti
rehellisen vastauksen sen sijaan että sovitus vain epäonnistuisi.

### Mikä hylätään

Silmukka, joka ei sulkeudu budjettiin tai jonka liitos ylittää turvakaton, sekä
itseensä osuva rata. Risteävä piirto on aito aikomus, ja sen ratkaisu (X-pala
tai silta) on olemassa — mutta vain lisäävälle piirrolle, jossa ylitettävä rata
on jo tiedossa (`docs/BRANCHING.md`). Yhdellä vedolla piirretyn radan
itseleikkaus hylätään yhä, koska rikkinäistä rataa ei näytetä (CLAUDE.md: rata
on joka välivaiheessa ehjä). Käyttäjä pääsee samaan lopputulokseen piirtämällä
ensin risteämättömän radan ja lisäämällä risteävän osuuden haarana.

Alueen ylitystä **ei** hylätä, toisin kuin generoinnissa: käyttäjä piirsi viivan
itse siihen mihin piirsi, ja `track.fitsArea` kertoo asian ilman että työ
heitetään pois.

## Mitä sovitus maksaa

Ellipsi ei ole BRIO-geometriaa: siinä ei ole 45°:n lokeroita eikä
gridipituuksia. Juuri sen käyttäjä kuitenkin piirtää. Vapaalla kädellä piirretty
soikio asettuu paloiksi noin **19 mm:n keskimääräisellä poikkeamalla** eli noin
puolen laudanleveyden tarkkuudella, ja sovitus vie puhelinluokan laitteella
kymmeniä millisekunteja. Poikkeama on 45°-lokeroinnin rehellinen hinta, ei virhe.

## Taipuva pala

Taipuva pala on toistaiseksi **vain budjettia**, kuten muuallakin koodissa
(`FlexSettings` kasvattaa sulkeutumisbudjettia). Sitä ei sijoiteta radalle
palana, koska sen geometria on venyvä eikä `ResolvedPiece` voi esittää
venyvää keskilinjaa. Keilahaussa on silti valmiina korkea käyttökustannus
`flex`-tagille, joten kun omistaja lisää 3D-tulostetun palansa
palakirjastoon, sovitus osaa jo säästää sen sauman lähelle.

## Käyttöliittymä

Piirtotila on **eksplisiittinen ja lyhytikäinen** (README luku 7): nappi
alalaidassa kytkee sen päälle, yksi veto sovitetaan, ja kartta palauttaa tilan
itse katseluun. Kaksi sormea navigoi aina ja peruu kesken olevan vedon (= myös
kämmenentunnistus). Piirretty viiva jää kartalle haaleana radan alle: käyttäjän
pitää nähdä sekä se mitä hän piirsi että se mitä siitä tuli.

Piirretty rata syrjäyttää generoidun, kunnes käyttäjä generoi uudelleen tai
muuttaa asetuksia — molemmat elävät rinnakkain, joten paluu on aina auki.
