# Lisäävä piirto: haarat ja risteämät

Toteuttaa README luvun 5 kohdan "Haara mutkaan" ja luvun 6 risteämiskyselyt siltä
osin kuin toteutusjärjestyksen kohta 4 vaatii: **haaran paikan päättely, haamu-
esikatselut kartalla ja risteämän X/silta-valinta.**

```
veto radan vierestä -> haarakohta -> sovitus haarasta -> risteämä? -> vaihtoehdot
                       branch.ts     beam.ts            crossing.ts   extend.ts
```

Sivulla 3 vedolla on kolme merkitystä, ja ne erottuvat siitä **mistä veto alkaa**:
valittu osio tekee siitä korvauksen (`docs/EDITING.md`), radan vierestä alkava
veto on uusi haara, ja muualta alkava veto on uusi rata (`docs/DRAWING.md`).
Nappausetäisyys on yksi looginen solu (216 mm), sama luku kuin silmukan
sulkeutumistulkinnassa. Vedon saa aloittaa kummasta päästä tahansa: radan
lähempi pää on haaran juuri.

## 1. Haarakohta (`branch.ts`)

Vaihdetta ei voi asettaa mihin tahansa. README luku 5 sanoo miksi: **kaaret ovat
jäykkiä pisteitä, suorat liukuvia ankkurivyöhykkeitä.** Siitä seuraa kaksi tapaa.

### Suora: liukuva ankkurivyöhyke

Vaihde upotetaan suoralle osuudelle ja osuus **täytetään uudelleen sen molemmin
puolin**. Osuuden kokonaispituus säilyy täsmälleen, joten muu rata ei liiku
lainkaan — tämä on koko idean ydin. Upotuskohta valitaan sormea lähimmästä
kohdasta, mutta vain sellaisista, joissa sekä vaihdetta edeltävä että sitä
seuraava väli on täytettävissä (`nearestFillable`-tyylinen haku
täyttötaulukosta). Vaihde liukuu siis vapaasti, mutta napsahtaa palarajoihin.

Osuuden rajaus on sama `naturalSection` kuin osion valinnassa, ja korvattavuuden
ehdot ovat samat: keskeltä ei saa lähteä haaraa, päiden on oltava samalla
tasolla. Sama koneisto palvelee kolmea eri tehtävää, mikä on tarkoituskin.

### Kaari: jäykkä piste

Kaarta ei voi siirtää, joten vaihtoehtoja on kolme (README luku 5):

1. **Suora ennen mutkaa** — upotus edeltävälle osuudelle, mutkan puoleiseen päähän.
2. **Suora mutkan jälkeen** — sama seuraavalle osuudelle.
3. **Kaaren vaihto haaroittavaan palaan.** Ehdokkaat tulevat
   **porttisignatuurista**, ei koodiin kirjoitetusta listasta:
   `library.substitutesFor(id)` antaa saman korvausluokan palat, ja niistä
   otetaan ne joilla on haaraportti. Käytännössä `E1` → `O`/`P`, `A` →
   `L`/`M`/`I`/`J`/`T`/`X`. Kun omistaja lisää palakirjastoon uuden haaroittavan
   palan, se ilmestyy ehdotuksiin ilman koodimuutosta (README luku 8).

Oikea asento etsitään kokeilemalla: vaihdon on päädyttävä **täsmälleen samaan
päätyporttiin** kuin vaihdettavan palan — suunta, taso ja liitin samat, sijainti
alle 0,2 mm:n päässä. Signatuurin täsmäys takaa että sellainen asento on
olemassa, mutta sen etsii geometria eikä usko.

### Mikä haara kelpaa tarjottavaksi

Haaraportti tarjotaan vain jos siihen voi liittää jotain. Kysymys esitetään
suoraan sovitukselle (`fitOptions`): jos yksikään sovituksen palavalikoiman pala
ei mene porttiin kiinni, porttia ei tarjota. Tämä karsii esimerkiksi `J`:n
haaraportit, jotka ovat koloja — ketju kulkee aina kolosta tappiin, joten
kolo-porttiin ei ole mitään mitä liittää.

Järjestys: **lähin haarakohta voittaa**. Tasapelin ratkaisee palan luonne, ja
sekin datasta: `basic`-vaihde on halvin, risteys kalliimpi (se muuttaa radan
luonnetta) ja harvinainen pala kalliimpi vielä.

## 2. Sovitus haarasta (`extend.ts`)

Haarakohdasta eteenpäin käytetään **samaa keilahakua** kuin muussakin piirrossa,
aloituskehys kiinnitettynä haaraporttiin. Vapaa pää jää vapaaksi: haara ei
sulkeudu mihinkään, joten sauman ongelmaa ei ole.

Käytettävissä oleva kokoelma on käyttäjän palat **miinus se mikä on jo kiinni
radalla**, aivan kuten osion korvauksessa. Vaihde varataan ennen täyttöä: se on
aina se harvinaisempi pala.

Jokainen valmis vaihtoehto tarkistetaan kokonaan ennen kuin sitä tarjotaan:
osuuden päätyheiton on mahduttava Vario-budjettiin, yhdenkään liitoksen ei tule
ylittää turvakattoa, eikä uusia törmäyksiä saa syntyä. Törmäyslaskuria verrataan
alkuperäiseen eikä nollaan, koska monitasoisessa radassa se voi olla valmiiksi
nollaa suurempi.

## 3. Risteämä (`crossing.ts`)

Jos haara leikkaa vanhan radan, se on aito aikomus eikä virhe. Vastauksia on
kaksi, ja kumpikin tarjotaan omana vaihtoehtonaan.

Risteämä paikannetaan vertaamalla keskilinjoja: kynnys on sama kuin
törmäyslaskurilla, ja vierekkäiset kosketukset niputetaan yhdeksi ylitykseksi
(yksi ylitys koskettaa tyypillisesti kahta palaa). Liitoksessa kiinni olevat
palat jätetään pois — haaran ensimmäinen pala lähtee vaihteen portista, ei sen
yli. **Vain yksi risteämä kerrallaan ratkaistaan**: useampi ylitys yhdellä
vedolla on kysymys, johon ei ole yhtä vastausta, ja se sanotaan käyttäjälle
suoraan.

### Tasoristeys

Risteyspala (`H`, `H1`, `H2`, `X`) upotetaan **vanhan radan** suoralle osuudelle
täsmälleen samalla koneistolla kuin vaihde. Ero on ankkurissa: risteyspalan
poikittaisreitin keskikohdan on osuttava siihen kohtaan, jossa piirretty viiva
ylittää radan.

Sen jälkeen haara sovitetaan **kahtena jaksona**: ensimmäinen päättyy risteyksen
porttiin kiinnitettynä maalina (sama `GoalFrame` kuin osion korvauksessa), ja
toinen jatkaa portista eteenpäin vapaana viivan loppuun. Kumpi pala kelpaa,
ratkeaa kahdesta ehdosta:

- **Suunta.** Poikittaisreitin on osuttava viivan kulkusuuntaan 45°-lokeroon
  asti. Sijoituksen kierto on kokonainen lokero eikä sitä voi jakaa liitoksille,
  joten väärä lokero näkyisi mutkana.
- **Liitinsukupuoli.** Haara kulkee koko matkan kolosta tappiin, joten sen on
  tultava risteykseen koloon ja päästävä ulos tapista. Yhdellä asennolla vain
  toinen kulkusuunta kelpaa — ja juuri siksi `H` on peilattava
  (`docs/PIECE_LIBRARY.md`): peilaus valitsee laatikon toisen H-kappaleen, jossa
  sukupuolet ovat toisin päin.

### Silta

Haara nostetaan radan yli **mäkielementillä** (`data/elements/`: ramppi ylös,
kansi, ramppi alas). Silta on siis dataa eikä koodia, ja siellä on jo ratkaistu
sekin, että laskeva ramppi kuljetaan yläpäästä sisään — `C2` ottaa käännöksen
vastaan ja `B2` palauttaa parillisuuden. Siltaa ei siis tarvitse mallintaa
uudestaan täällä.

Silta upotetaan **haaran omalle** suoralle osuudelle samalla
upotus-ja-täytä-koneistolla, joten haaran vapaa pää ei liiku. Yksi lisäehto:
risteämän on jäätävä **kannen alle**. Kansi on tasolla 1 eikä siksi törmää
alittavaan rataan, mutta rampit ovat lattialla — ne eivät saa osua siihen.

Siitä seuraa suoraan mitattava vaatimus: haarassa on oltava suoraa sekä
risteämän molemmin puolin, yhteensä vähintään mäkielementin mitta (684 tai
756 mm). Jos vedon suora osuus on lyhyempi tai risteämä on liian lähellä sen
päätä, siltaa ei tarjota. Se ei ole algoritmin puute vaan lattialla mitattava
tosiasia, ja käyttäjälle sanotaan se sellaisenaan.

## 4. Valinta: milloin kysytään ja milloin ei

README luku 5: "Jos yksi voittaa selvästi → automaattinen; muuten
haamuesikatselut kartalla."

- **Automaattinen**, kun vaihtoehtoja on yksi tai paras on selvästi (30 %)
  halvempi kuin seuraava.
- **Kysytään**, kun kärki on tasainen — ja **aina kun risteämä on mukana.**
  Risteämä on aito kysymys ("meneekö tästä yli vai poikki"), eikä kustannusluku
  osaa vastata siihen käyttäjän puolesta.

Vaihtoehtoja tarjotaan enintään kolme, ja niistä karsitaan päällekkäiset: kaksi
lähes samanlaista haamua kartalla ei ole valinta vaan sotku.

## 5. Haamuesikatselu

Haamu piirretään vain **muuttuvista paloista**: ne tunnistetaan vertaamalla
sijoituksia alkuperäiseen rataan, ei indeksejä, koska osuuden uudelleentäyttö
järjestää palataulukon uusiksi. Koskematon pala on täsmälleen siellä missä
ennenkin, joten vertailu on eksakti.

Haamu on samalla kosketuskohde: sen alla on leveä näkymätön osumapolku, ja
napautus valitsee sen vaihtoehdon. Napautus haamun ulkopuolelle peruu
kysymyksen. Vaihtoehdot ovat myös toimintorivin nappeina — kartta on sankari,
mutta sormella pitää osua ilman tähtäilyä.

Numerolappu asetetaan kunkin haaran **omalle ketjulle eri kohtaan**:
vaihtoehdot lähtevät samasta kohdasta ja eroavat vasta myöhemmin, joten
keskikohtaan asetetut laput kasautuisivat päällekkäin eikä alimpaan voisi osua
lainkaan. Lappu ei myöskään käänny kartan mukana — geometria kääntyy ruudulle
sopiakseen, luettava teksti ei.

## 6. Palamuutoskortti

Kortti kertoo **erotuksen, ei kirjanpitoa**. Osuuden uudelleentäyttö purkaa ja
palauttaa samoja suoria, ja "käyttää 1×A1 · vapauttaa 1×A1" ei kerro käyttäjälle
mitään. Sisäinen kirjanpito säilyttää molemmat luvut täysinä — radan pituus
muuttuu täsmälleen niiden erotuksen verran, ja testi tarkistaa sen — mutta
näytölle menee netto.

## Mikä jäi seuraavaan vaiheeseen

Haaran päähän ei aseteta puskuria automaattisesti: "sivuraide puskurilla" on
autosolverin variaatiokuvio (README luku 6) ja kuuluu vaiheeseen 5. Samoin
haaran poisto ja vaihto: tässä vaiheessa haaran saa vain lisätä, ja paluu käy
generoimalla uudelleen — generoitu, piirretty ja muokattu rata elävät rinnakkain
kuten ennenkin.
