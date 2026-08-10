# Lisäävä piirto: haarat ja risteämät

Toteuttaa README luvun 5 kohdan "Haara mutkaan" ja luvun 6 risteämiskyselyt siltä
osin kuin toteutusjärjestyksen kohta 4 vaatii: **haaran paikan päättely, haamu-
esikatselut kartalla ja risteämän X/silta-valinta.**

```
veto radan vierestä -> haarakohta -> sovitus haarasta -> risteämä? -> vaihtoehdot
                       branch.ts     beam.ts            crossing.ts   extend.ts
```

Sivulla 3 vedolla on neljä merkitystä, ja ne erottuvat siitä **mistä veto
alkaa**: valittu osio tekee siitä korvauksen (`docs/EDITING.md`), **radan
avoimen pään vierestä** alkava veto jatkaa rataa, muualta radan vierestä alkava
veto on uusi haara, ja radasta kaukana alkava veto on uusi rata
(`docs/DRAWING.md`). Nappausetäisyys on yksi looginen solu (216 mm), sama luku
kuin silmukan sulkeutumistulkinnassa. Vedon saa aloittaa kummasta päästä
tahansa: radan lähempi pää on haaran juuri.

## 0. Jatko radan päästä

Kiskonpään viereen ei työnnetä vaihdetta. Radan avoimen pään vieressä veto
tarkoittaa lähes aina "jatka tästä", ja niin se myös tulkitaan: jatko on
haarakohta, joka ei lisää vaihdetta eikä muuta rataa mitenkään — se on pelkkä
valmis kehys, josta sovitus jatkaa. Hyvitys tekee siitä selvän voittajan, joten
veto menee läpi ilman kysymystä. Haaran saa yhä aloittamalla vedon pään
ulottumattomista.

Avoin pää on kolmenlainen ja kaikki kolme ovat lattialla sama asia: piirretyn
radan pää, piirretyn haaran vapaa pää ja vaihteen käyttämättä jäänyt
haaraportti (`freeEnds`, `section.ts`).

**Radan kaksi päätä eivät jatku samalla tavalla.** Ketju kulkee kolosta
tappiin, joten tappiportista se jatkuu suoraan eteenpäin, mutta koloportista
ketju on rakennettava lattialta kiskonpäätä kohti ja kiinnitettävä vasta
lopustaan (`backwardOptions`) — sama kiinnitetyn maalin koneisto kuin osion
korvauksessa. Piirretyllä radalla on aina tasan yksi kumpaakin päätä, joten
ilman jälkimmäistä puolet radan päistä ei jatkuisi lainkaan.

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

#### Liitinparillisuus: miksi mäen jälkeiselle suoralle mahtuu vaihde

Täyttösuorat kulkevat aina kolosta tappiin, joten osuus, jonka pää on
"väärässä" parillisuudessa, ei täyty niillä lainkaan. Radalla sellaisia
osuuksia on tasan yhdestä syystä: **mäkielementti kääntää parillisuuden** ja
palauttaa sen `C2`:lla ja `B2`:lla (`data/elements/basic.json`). Mäen jälkeinen
suora alkaa siis sukupuolenvaihtajalla — ja se on usein radan pisin suora.

Ilman erillistä käsittelyä täyttö päätyisi väärään liittimeen ja upotus
hylättäisiin, jolloin käyttäjä saisi "vaihde ei mahdu" juuri siellä missä tilaa
on eniten. Siksi osuuden päät tarkistetaan ennen muuta: jos alkuun tai loppuun
tarvitaan vaihtaja, se varataan ensin ja väli täytetään tavalliseen tapaan.
Ratkaisu on sama kuin BRIO:lla itsellään — juuri tähän `B2` ja `C2` ovat
olemassa.

Osuuden rajaus on sama `naturalSection` kuin osion valinnassa, ja korvattavuuden
ehdot ovat samat: keskeltä ei saa lähteä haaraa, päiden on oltava samalla
tasolla. Sama koneisto palvelee kolmea eri tehtävää, mikä on tarkoituskin.

Osuuden **pää saa olla radan avoin pää**. BRIO-järjestelmässä yhden suoran voi
korvata usealla lyhyemmällä, joten vaihde mahtuu mille tahansa suoralle
osuudelle — myös sellaiselle, joka sattuu olemaan koko rata. Pelkistä suorista
koostuva avoin rata on kokonaisuudessaan yksi luonnollinen jakso, ja aiemmin
sellaiselta ei voinut haaroittaa lainkaan (`docs/EDITING.md`).

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

**T ei ole risteys.** Se sai aluksi saman sakon kuin `X`, koska molemmilla on
`tee`/`star`-tagi — ja siksi kohtisuoraan piirretty haara sai vastaukseksi
mutkan, vaikka juuri `T` tekee sen mitä pyydettiin. `T` on tavallinen yhden
haaran vaihde, jonka haara vain kääntyy 90°; sakon ansaitsevat vain aidot
risteykset (`crossing`) ja käyttämättä jäävät haaraportit. Nyt kohtisuora veto
saa `T`:n kärkeen, ja sovituksen poikkeama ratkaisee lopun.

### Käyttämätön haaraportti maksaa

Kolmisuuntainen vaihde (`I`/`J`) ja tähtiristeys (`X`) kelpaavat haarakohdaksi,
mutta yhtä haaraa varten ne jättävät radalle suunnan, joka ei johda mihinkään.
Lattialla se on irrallinen kiskonpää, ja kartalla se näyttää virheeltä — juuri
siltä miltä se tuntuikin, kun suorasta vedetty uloke tuotti nelisuuntaisen
palan yhdellä irtonaisella haaralla.

Siksi jokainen käyttämättä jäävä haaraportti lisää palan järjestyskustannusta.
Sakko ei sulje mitään pois: jos piirretty viiva vaatii 90°:n haaran, `T` on yhä
ainoa pala joka sen tekee ja voittaa sakostaan huolimatta.

**Puhdas risteys ei ole vaihde.** `H`, `H1` ja `H2` jäävät pois sekä
upotuksesta että kaaren vaihdosta: niiden "haara" on läpimenevä toinen raide,
jonka *molemmat* päät jäisivät ilmaan. Risteämän ratkaisu käyttää ne erikseen
(luku 3).

### Kun osoitettuun kohtaan ei mahdu vaihdetta

README luku 5 vaatii tähän vastauksen: "syy + lähin mahdollinen haarakohta".
Jos nappausetäisyydeltä ei löydy yhtään haarakohtaa, haku toistetaan
kolminkertaisella etäisyydellä. Haara ei silloin ala aivan sormen alta, mutta
haamuesikatselu näyttää mihin se tuli, ja se on parempi vastaus kuin
kieltäytyminen. Vasta jos sekään ei tuota mitään, kerrotaan syy.

## 2. Sovitus haarasta (`extend.ts`)

Haarakohdasta eteenpäin käytetään **samaa keilahakua** kuin muussakin piirrossa,
aloituskehys kiinnitettynä haaraporttiin. Vapaa pää jää vapaaksi: haara ei
sulkeudu mihinkään, joten sauman ongelmaa ei ole.

### Yhdistävä haara: veto, joka palaa radalle

Jos vedon **molemmat päät** ovat nappausetäisyydellä radasta, käyttäjä ei
piirtänyt umpiperää vaan ohituskaiteen. Silloin toinenkin pää tarvitsee oman
vaihteensa, ja ketju sovitetaan sen porttiin **kiinnitettynä maalina** — sama
`GoalFrame` kuin osion korvauksessa. Ilman tätä viiva päättyisi toisen radan
viereen ilman liitosta: kartalla yhtenäisen näköinen, lattialla irrallinen.

Haaran päät eivät ole symmetriset, ja syy on liitinsukupuolessa. Ketju kulkee
koko matkan kolosta tappiin, joten se voi **lähteä** vain tappiportista ja
**päättyä** vain koloporttiin. Palakirjastossa nämä ovat eri paloja: `L`, `M`,
`O1`, `T` ja `I` tarjoavat tappihaaran, kun taas `J`, `P` ja `X`:n pohjoisportti
tarjoavat kolon. Haarakohtien haku tekee siis saman kysymyksen kahteen suuntaan
(`arrival`-lippu), eikä kumpikaan pää saa käyttää toisen listaa.

Päätyheitto jaetaan haaran **omille liitoksille** samalla mallilla kuin osion
korvauksessa, joten kumpikaan vaihde ei liiku.

#### Miksi toinen pää on aina kolmihaarainen — ja mikä sen korjaisi

Saapumispäähän kelpaa vain pala, jonka haaraportti on **kolo**. Suoralle
osuudelle upotettavista vaihteista sellaisia on tasan kaksi: `J`
(kolmisuuntainen) ja `X` (tähtiristeys). Kummallakin jää käyttämätön suunta,
joten radalle asti piirretty haara saa toiseen päähänsä vaihteen, jonka
kolmas suunta roikkuu — vaikka lattialla siihen riittäisi tavallinen `L`/`M`.

Mitattuna: saapumisankkureita ovat `J` ja `X`, lähtöankkureita
`O1 P1 L M T I X`.

Syy on liitinsukupuoli, ja **ratkaisu on sama kuin mäen kanssa**: ketju kulkee
kolosta tappiin, mutta yhdellä `C2`:lla se päättyy koloon ja kelpaa `L`:n
tappiporttiin. BRIO ratkaisee saman asian samalla palalla. Sovituksen
palavalikoimassa (`fit/beam.ts`) ei kuitenkaan ole sukupuolenvaihtajia, joten
ketju ei voi päättyä toiseen parillisuuteen kuin mistä se lähti.

#### Mitattu: kumpi variaatio, miten päin

Osuuden liitinparillisuus on kiinteä, joten **jokainen vaihde mahtuu siihen
tasan yhdessä asennossa** — ja haaraportin sukupuoli tulee palasta, ei
asennosta. Suoralle osuudelle upotettuna (`insertIntoRun`):

| Pala | Kulkusuunta joka kelpaa | Haaraportti |
|---|---|---|
| `L`, `M`, `O1`, `P1`, `T` | `in→out` | tappi |
| `I` | `in→out` | kaksi tappia |
| `J` | **`out→in`** | kaksi koloa |
| `X` | `in→out` | pohjoinen kolo, etelä tappi |
| `O`, `P` | — (E1-luokka, ei mahdu suoralle) | |

Taulukko sanoo kaksi asiaa. Ensinnäkin **koneisto valitsee jo oikean variaation
oikein päin**: `J` on `I`:n sukupuolikäännetty pari, ja se menee osuudelle
nimenomaan toisin päin kuljettuna. Sukupuolenvaihtajaa ei tarvita siihen.

Toiseksi rajoite on palavalikoimassa eikä logiikassa: **`L` ja `M` ovat
peilipari, eivät sukupuolipari.** Kummallakin on kolo sisään ja tapit ulos,
joten kumpaankaan ei voi saapua. Suoralle osuudelle mahtuvista vaihteista vain
`J` ja `X` ottavat ketjun vastaan, ja kummallakin jää suunta yli.

Kaksihaarainen vaihde johon voi saapua on olemassa — `P`, `O`:n
sukupuolikäännetty pari — mutta se on E1-kaariluokan pala. Se tarjotaan siis
vain kun haara päättyy kaaren kohdalle, ja silloin se toimii jo nyt.

Kolme tapaa saada yhdistävä haara ilman roikkuvaa suuntaa, järjestyksessä:

1. **Päätä haara kaaren kohdalle** → `P`. Toimii nyt.
2. **Hyväksy `J`** ja käytä sen kolmas suunta sivuraiteena.
3. **Sukupuolenvaihtaja ketjussa** → `L`/`M` kelpaa. Viimeinen keino, ei
   ensimmäinen: oikea variaatio oikein päin on aina parempi vastaus.

Kokeilin lisätä ne valikoimaan kalliina ja vain kiinnitetylle maalille:
saapumisankkureiksi tulivat odotetusti `O1 P1 L M T J I X`, eli tavallinen
kaksihaarainen vaihde kelpasi. Muutos kuitenkin **rikkoi yhdistävän haaran**
kokonaan yhdessä testitapauksessa, eikä syy selvinnyt — ehdokasjoukon kasvu
näyttää syrjäyttävän aiemmin toimineen sovituksen. Muutos on siksi peruttu, ja
tämä on sen kirjattu lähtökohta: ratkaisu tiedetään, mutta se vaatii oman
vaiheensa, jossa saapumispään sovitus mitataan kunnolla.

Yhdistävä haara maksaa kaksi vaihdetta, joten se häviäisi kustannuksissa aina
umpiperälle. Hyvitys pitää sen edellä silloin kun kumpikin kelpaa — mutta
molemmat tarjotaan, koska "umpiperä vai lenkki" on käyttäjän valinta.

Se maksaa myös aikaa: haarakohtahaku tehdään vedon kummastakin päästä, ja
päätyhaku toistuu jokaiselle lähtökohdalle erikseen (rata on eri jokaisen
upotuksen jälkeen). Siksi yhdistävää haaraa yritetään vain muutamasta
halvimmasta lähtökohdasta. Raskain veto — molemmat päät radalla ja ylitys
matkalla — vie kehityskoneella noin 130 ms 70 palan radalla.

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
vedolla on kysymys, johon ei ole yhtä vastausta.

Risteämä tarjotaan **myös silloin kun rataa ennen pysähtyvä haara jo kelpasi.**
Keilahaku palauttaa monta ketjua, ja jos pisin niistä leikkaa radan, lyhyempi
kelpaava ei ole vastaus kysymykseen "yli vai poikki" — se on vain hiljainen
tapa jättää puolet vedosta huomiotta. Molemmat menevät siis kartalle
vaihtoehdoiksi.

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

### Irrallinen rata: viimeinen keino

README luku 0: piirretty on toteutettava jotenkin. Kun mikään ei kiinnity — ei
haarakohtaa, ei jatkoa, ei risteystä, ei tynkää — palat menevät silti lattialle
viivan alle **ilman liitosta**. Irrallinen rata on lattialla arkipäivää, ja sen
saa kiinni piirtämällä sen päästä (luku 0 tässä dokumentissa) tai poistettua
valitsemalla.

Kaksi ehtoa pitää sen rehellisenä:

- **Se ei mene päällekkäin muun radan kanssa.** Kaksi lautaa samassa kohdassa ei
  ole vastaus vaan sotku, joten irrallinen rata aloitetaan vasta siitä mistä
  lattia on vapaa. Veto alkaa radan vierestä — siitähän se tulkittiin haaraksi —
  joten sen alku katkaistaan. Katkaisu tehdään murtoviivaa pitkin eikä pisteitä
  suodattamalla: siivottu veto on vain muutama piste, ja alkupisteen
  poistaminen veisi koko viivan.
- **Se häviää kaikelle muulle.** Kustannus on niin suuri, ettei se koskaan
  syrjäytä kiinnittyvää vaihtoehtoa.

### Tynkä: kun kumpikaan vastaus ei mahdu

Jos ylitykselle ei löydy risteystä eikä siltaa — esimerkiksi kokoelmasta
puuttuvat molemmat — koko vetoa ei heitetä pois. Viivasta toteutetaan se osa,
joka on toteutettavissa: haara pysähtyy ennen rataa, ja käyttäjä näkee kartalta
mihin asti. Vajaa vastaus on rehellinen ja parempi kuin kieltäytyminen, ja
nimilappu kertoo suoraan mistä on kyse ("Haara ennen rataa").

Vasta jos tynkäkään ei mahdu, kerrotaan syy.

## 4. Valinta: milloin kysytään ja milloin ei

README luku 5: "Jos yksi voittaa selvästi → automaattinen; muuten
haamuesikatselut kartalla."

- **Automaattinen**, kun vaihtoehtoja on yksi tai paras on selvästi (30 %)
  halvempi kuin seuraava.
- **Kysytään**, kun kärki on tasainen — ja **aina kun risteämä on mukana.**
  Risteämä on aito kysymys ("meneekö tästä yli vai poikki"), eikä kustannusluku
  osaa vastata siihen käyttäjän puolesta.

Vaihtoehtoja tarjotaan enintään kolme, ja niistä karsitaan päällekkäiset: kaksi
lähes samanlaista haamua kartalla ei ole valinta vaan sotku. Päällekkäisyys
mitataan koko vastauksesta — haarapala, haarakohdan laji, haaran laji
(umpiperä / yhdistävä / tynkä) ja risteämän ratkaisu — koska sama vaihde eri
lopputuloksella on eri vastaus eikä kaksoiskappale.

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
autosolverin variaatiokuvio (README luku 6), ja se tuli vaiheessa 5
(`docs/VARIATIONS.md`). Sama koskee haaran poistoa ja palan vaihtoa: piirretyn
haaran saa nyt myös purkaa valitsemalla sen osioksi. Paluu käy yhä myös
generoimalla uudelleen — generoitu, piirretty ja muokattu rata elävät
rinnakkain kuten ennenkin.

Yhä auki:

- **Useampi ylitys yhdellä vedolla** ratkeaa yhä vain tynkänä: ensimmäinen
  risteämä ratkaistaan tai ei kumpaakaan. Ketjutettu ratkaisu vaatisi
  ylityskohtaisen kysymyksen, eli monivaiheisen haamukyselyn.
- **Osion korvaus parillisuuden vaihtavalle osuudelle** ei onnistu:
  keilahaun palavalikoimassa ei ole sukupuolenvaihtajia, joten piirretty
  korvaus ei voi päätyä "väärään" liittimeen. Vaihteen upotus osaa sen nyt,
  osion korvaus ei vielä.
