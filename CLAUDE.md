# CLAUDE.md – HunterTracker POC

Projektin pysyvät säännöt. Lähde: Stompy-projekti `huntertracker_poc` (`working_rules`, `extended_mvp_architecture_spec`). Katso myös `AGENTS.md` (Expo-ohjeet).

## Session aloitus
- Lue ensin Stompysta `working_rules` ja avoimet tiketit (`huntertracker_poc`).

## Työskentelysäännöt
1. **Yksi tiketti kerrallaan.** Älä aloita seuraavaa ennen kuin edellinen on valmis ja hyväksytty. Siirrä tiketti `in_progress`-tilaan aloittaessa ja `done`-tilaan vasta todisteen jälkeen.
2. **Kerro ennen koodaamista** selkokielellä, mitä aiot tehdä ja miksi.
3. **Tiukka TDD:**
   - Kirjoita ensin Jest-testi (`__tests__/*.test.ts`).
   - Aja se ja näytä, että se epäonnistuu (**punainen**).
   - Kirjoita vasta sitten toteutus ja näytä testien menevän läpi (**vihreä**).
   - Logiikka puhtaisiin funktioihin `src/utils/`-kansioon, jotta se on testattavissa ilman natiivimoduuleja.
4. **Ei "valmis"-ilmoitusta ilman todistetta** (testitulos tai toimiva sovellus puhelimella).
5. **Älä poista tai kirjoita uusiksi toimivaa koodia**, jota ei pyydetty muuttamaan.
6. **Älä koskaan kovakoodaa API-avaimia, salasanoja tai salaisuuksia.** Käytä ympäristömuuttujia (esim. `process.env.EXPO_PUBLIC_MML_API_KEY` / `.env`, joka ei kuulu versionhallintaan).
7. Jos olet epävarma tai jumissa kahden yrityksen jälkeen: pysähdy ja kerro suoraan. Älä arvaile.
8. Tiketin päätteeksi vastaa: *Mitä rakennettiin? Miten tiedämme, että se toimii? Mitä tästä tulisi ymmärtää?*
9. Tallenna jokainen päätös Stompyyn (`lock_context`), jotta seuraava sessio jatkuu saumattomasti.

## Windows-komennot (cmd-muoto)
Käytä aina `.cmd`-päätteisiä komentoja (PowerShellin suoritusrajoitukset):
```
npx.cmd jest                       # aja kaikki testit
npx.cmd jest __tests__/x.test.ts   # aja yksi testitiedosto
npx.cmd tsc --noEmit               # tyyppitarkistus
npx.cmd expo install <paketti>     # asenna Expo-yhteensopiva versio (ei npm install)
npx.cmd expo start                 # kehityspalvelin
npm.cmd install                    # riippuvuuksien asennus
```

## Huomioita
- `App.tsx` ja osa `src/utils/*.ts`-tiedostoista on tallennettu Windows-1252-koodauksella (ääkköset). Säilytä koodaus muokatessa.
- Arkkitehtuuri tukee profiileja `HUNTER` / `SAR` / `TACTICAL` (ks. Stompy `extended_mvp_architecture_spec`).

## Testiajo (GitHub Actions) ja merge
- `.github/workflows/ci.yml` (`ci / test`) ajaa jokaisessa PR:ssä ja main-pushissa: `npm ci`, `npx jest --ci`, `npx tsc --noEmit`. Ei salaisuuksia.
- Stompy `working_rules` sääntö 11: turva-PR:t (tagi `turva` tai turvallisuuslogiikka) mergeää aina käyttäjä. Muun PR:n automaatio saa mergetä (squash), kun `ci / test` on vihreä, PR on mergeattavissa eikä avoimia kommentteja ole.
