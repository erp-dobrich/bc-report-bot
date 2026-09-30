@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
for /f "tokens=2 delims=:, " %%V in ('findstr /i "\"version\"" version.json') do set "VER=%%~V"
set "VER=!VER:"=!"
if not defined VER echo VERSION ERROR&pause&exit /b 1
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"BOT_TOKEN=" backend\.env 2^>nul') do set "TOKEN=%%B"
if not defined TOKEN echo BOT_TOKEN MISSING&pause&exit /b 1
powershell -NoProfile -Command "try{$s=Invoke-RestMethod -Uri 'http://127.0.0.1:9923/status' -TimeoutSec 5;if($s.busy -or $s.draining){Write-Host ('ACTIVE OPERATION - VERSION NOT CHANGED. activeJobs=' + @($s.activeJobs).Count);exit 9}}catch{Write-Host 'LOCAL CONTROL IS NOT AVAILABLE - VERSION NOT CHANGED';exit 8}"
if errorlevel 1 pause&exit /b 1
powershell -NoProfile -Command "$h=@{Authorization='Bearer !TOKEN!'};$b=@{stableVersion='!VER!';latestVersion='!VER!';candidateVersion=$null;allowedVersions=@('!VER!')}|ConvertTo-Json -Compress;Invoke-RestMethod -Method Put -Uri 'https://bot-config.erp-admin.workers.dev/config' -Headers $h -ContentType 'application/json' -Body $b|ConvertTo-Json -Compress" || (echo WORKER UPDATE ERROR&pause&exit /b 1)
echo MANDATORY VERSION !VER!
pause