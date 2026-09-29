@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
for /f "tokens=2 delims=:, " %%V in ('findstr /i "\"version\"" version.json') do set "VER=%%~V"
set "VER=!VER:"=!"
if not defined VER echo VERSION ERROR&pause&exit /b 1
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"BOT_TOKEN=" backend\.env 2^>nul') do set "TOKEN=%%B"
if not defined TOKEN echo BOT_TOKEN MISSING&pause&exit /b 1
powershell -NoProfile -Command "$h=@{Authorization='Bearer !TOKEN!'};$b=@{latestVersion='!VER!'}|ConvertTo-Json -Compress;Invoke-RestMethod -Method Put -Uri 'https://bot-config.erp-admin.workers.dev/config' -Headers $h -ContentType 'application/json' -Body $b|ConvertTo-Json -Compress" || (echo WORKER UPDATE ERROR&pause&exit /b 1)
echo ACTIVE VERSION !VER!
pause