@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
for /f "tokens=2 delims==" %%V in ('node sync-version.js') do set "VER=%%V"
if not defined VER echo VERSION ERROR&pause&exit /b 1
node --check frontend\background.js >nul || (echo BACKGROUND ERROR&pause&exit /b 1)
node --check frontend\content.js >nul || (echo CONTENT ERROR&pause&exit /b 1)
node --check frontend\store-status.js >nul || (echo STORE-STATUS ERROR&pause&exit /b 1)
node --check frontend\store-manager.js >nul || (echo STORE-MANAGER ERROR&pause&exit /b 1)
node --check frontend\version-guard.js >nul || (echo VERSION-GUARD ERROR&pause&exit /b 1)
node --check backend\server.js >nul || (echo BACKEND ERROR&pause&exit /b 1)
node --check backend\clients-db.js >nul || (echo CLIENTS-DB ERROR&pause&exit /b 1)
node --check backend\jobs-db.js >nul || (echo JOBS-DB ERROR&pause&exit /b 1)
node --check backend\activity-db.js >nul || (echo ACTIVITY-DB ERROR&pause&exit /b 1)
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"BOT_TOKEN=" backend\.env 2^>nul') do set "TOKEN=%%B"
if not defined TOKEN echo BOT_TOKEN MISSING&pause&exit /b 1
git add version.json sync-version.js release-version.bat activate-version.bat allow-version.bat safe-stop.bat .gitignore frontend backend cloudflare
git diff --cached --quiet || git commit -m "Version !VER!"
git push origin main || (echo GIT PUSH ERROR&pause&exit /b 1)
powershell -NoProfile -Command "$h=@{Authorization='Bearer !TOKEN!'};$b=@{candidateVersion='!VER!'}|ConvertTo-Json -Compress;Invoke-RestMethod -Method Put -Uri 'https://bot-config.erp-admin.workers.dev/config' -Headers $h -ContentType 'application/json' -Body $b|Out-Null" || (echo CANDIDATE UPDATE ERROR&pause&exit /b 1)
echo.
echo READY VERSION !VER!
echo Candidate registered. Stable/allowed versions are unchanged while Store review is pending.
echo GitHub Actions will upload the extension automatically.
pause