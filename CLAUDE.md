# BRIO-ratageneraattori — projektikonteksti

## Mikä tämä on

Selaimessa toimiva BRIO-puujunaratojen layoutgeneraattori. **Koko suunnitteluspesifikaatio on README.md:ssä — lue se ennen mitään toteutustyötä.** README on syntynyt pitkästä suunnittelukeskustelusta ja on projektin totuuden lähde.

## Kovat reunaehdot (älä riko näitä)

- **Puhelin ensin.** Ensisijainen käyttölaite on puhelin, kohde olohuoneen lattia. Kaikki UI-ratkaisut testataan sormella, ei hiirellä.
- **Kaikki laskenta selaimessa.** Ei palvelinpuolen generointia. Hosting: Cloudflare Workers static assets, tila localStorageen, jako URL:n kautta. Ei käyttäjätilejä.
- **Deterministisyys**: sama siemen + asetukset → sama rata.
- **SVG piirretään geometriadatasta** (yksi totuuden lähde). Ei kuva-asseteja paloille. PNG vain vientinä.
- **Palakirjasto on dataa (JSON), ei koodia.** Uusi pala = datan lisäys; korvausluokkiin liittyminen porttisignatuurilla automaattisesti.
- **Toleranssibudjetti, ei eksakti sulkeutuminen.** BRIO-geometria ei sulkeudu matemaattisesti (45°/√2) — Vario-jousto ja valinnainen taipuva pala on mallinnettu README:n luvussa 2.
- **Rata on joka välivaiheessa ehjä** (runko → toteutus → mutaatiot; epäonnistunut mutaatio hylätään siististi).

## Avainluvut

- Mikrogrid 18 mm, loginen solu 216 mm, perhesovitus 432 mm.
- Suorat 54/108/144/216 mm; kaaret 45°, keskilinjasäteet ~202 mm (E) ja ~110 mm (E1); tasoero 64 mm.
- Vario-oletus: 2 mm + 3° per liitos, katto ~3 mm/~5° per liitos.

## Työskentelykäytännöt

- **Monikielisyys (i18n) alusta asti**: kaikki UI-tekstit käännösavaimina erillisissä lokaalitiedostoissa (`locales/fi.json`, `locales/en.json`, …). Suomi on oletuskieli ja `fi.json` referenssi. Uusi kieli = uusi JSON-tiedosto, ei koodimuutoksia. Yhtään käyttäjälle näkyvää merkkijonoa ei kovakoodata.
- Dokumentaation kieli: **suomi**. Koodin tunnisteet, kommentit, tiedostonimet, URL:t ja parametrit englanniksi. Commit-viestit englanniksi.
- Toteutussuunnitelma vaiheineen ja mallivalintoineen: `docs/IMPLEMENTATION_PLAN.md`. Scope-ristiriitojen ratkaisut on kirjattu sinne (luku 1) — älä ratkaise samoja asioita uudelleen lennossa.
- Toteutusjärjestys README:n luvussa 10 — vaihe 0 on elerunko puhelimella. Älä hyppää edelle.
- Lähdedata (mitat, ekvivalenssit, Solver-taulukko) perustuu woodenrailway.info-sivustoon; linkit README:n lopussa. Jos mitat epäilyttävät, tarkista lähteestä äläkä arvaa.
- Omistaja lisää custom-paloja (mm. 3D-tulostettu taipuva pala, IKEA Lillabo -osat) admin-palakirjaston kautta.
