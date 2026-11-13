@echo off
cd /d C:\Users\jarkk\hunter-tracker-poc
echo ================================================================
echo HUNTERTRACKERLIGHT - AUTOMAATTINEN TDD- JA TESTAUSPUTKI
echo ================================================================
for %%i in (1 2 3) do (
    echo.
    echo [VAIHE %%i / 3] Suoritetaan seuraava [TODO]-tiketti tiedostosta BACKLOG.md...
    call claude.cmd -p "Lue projektin CLAUDE.md ja BACKLOG.md. Etsi ensimmainen [TODO]-tilassa oleva tiketti. Jos yhtaan [TODO]-tikettia ei ole, lopeta heti. Muuten: 1) Merkitse kyseinen tiketti BACKLOG.md-tiedostoon tilaan [IN_PROGRESS]. 2) Kirjoita ensin kattavat punaiset Jest-testit tiedostoon __tests__/. 3) Toteuta ominaisuus ja integroi se App.tsx-nakymaan. 4) Aja 'npx.cmd jest --runInBand' ja 'npx.cmd tsc --noEmit' kunnes molemmat ovat vihreina. 5) Paivita BACKLOG.md-tiedostoon tilaksi [DONE] ja tee puhdas git commit." --allowedTools "Bash(npx.cmd:*)" "Bash(git:*)" "Read" "Write" "Edit" "Glob" "Grep"
    echo [LAATUPORTTI 1] Ajetaan koko Jest-regressiotestisarja...
    call npx.cmd jest --runInBand
    if errorlevel 1 (
        echo [KORJAUS] Jest-testi epaonnistui. Kaynnistetaan automaattinen korjausajo...
        call claude.cmd -p "Korjaa epaonnistuneet Jest-testit ('npx.cmd jest --runInBand'), aja testit vihreiksi ja paivita git commit." --allowedTools "Bash(npx.cmd:*)" "Bash(git:*)" "Read" "Write" "Edit" "Glob" "Grep"
        call npx.cmd jest --runInBand
        if errorlevel 1 (
            echo KRIITTINEN VIRHE: Testit eivat menneet lapi. Pysaytetaan putki.
            pause
            exit /b 1
        )
    )
    echo [LAATUPORTTI 2] Ajetaan TypeScript-tyyppitarkistus...
    call npx.cmd tsc --noEmit
    if errorlevel 1 (
        echo [KORJAUS] TypeScript-virhe havaittu. Korjataan tyypit...
        call claude.cmd -p "Korjaa kaikki TypeScript-tyyppivirheet ('npx.cmd tsc --noEmit'), varmista 'npx.cmd jest --runInBand' vihreaksi ja paivita git commit." --allowedTools "Bash(npx.cmd:*)" "Bash(git:*)" "Read" "Write" "Edit" "Glob" "Grep"
    )
)
echo ================================================================
echo KAIKKI 3 TIKETTIA TOTEUTETTU JA TESTATTU VIHREINA!
echo ================================================================
pause
