@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
for /f "tokens=2 delims==" %%V in ('node sync-version.js') do set "VER=%%V"
if not defined VER echo VERSION ERROR&pause&exit /b 1
node --check frontend\bc-report.user.js >nul || (echo USER SCRIPT ERROR&pause&exit /b 1)
node --check backend\server.js >nul || (echo BACKEND ERROR&pause&exit /b 1)
git add version.json sync-version.js release-version.bat frontend\bc-report.user.js frontend\manifest.json backend\server.js backend\package.json backend\package-lock.json
git diff --cached --quiet || git commit -m "Version !VER!"
git push origin main || (echo GIT PUSH ERROR&pause&exit /b 1)
powershell -NoProfile -Command "$v='!VER!';$u='https://raw.githubusercontent.com/erp-dobrich/bc-report-bot/main/frontend/bc-report.user.js?x='+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds();for($i=0;$i-lt 20;$i++){try{$t=(Invoke-WebRequest -UseBasicParsing $u).Content;if($t-match ('(?m)^//\s*@version\s+'+[regex]::Escape($v)+'\s*$')){exit 0}}catch{};Start-Sleep 2};exit 1" || (echo GITHUB VERSION NOT READY&pause&exit /b 1)
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"BOT_TOKEN=" backend\.env 2^>nul') do set "TOKEN=%%B"
if not defined TOKEN echo BOT_TOKEN MISSING IN backend\.env&pause&exit /b 1
powershell -NoProfile -Command "$h=@{Authorization='Bearer !TOKEN!'};$b=@{latestVersion='!VER!'}|ConvertTo-Json -Compress;Invoke-RestMethod -Method Put -Uri 'https://bot-config.erp-admin.workers.dev/config' -Headers $h -ContentType 'application/json' -Body $b|ConvertTo-Json -Compress" || (echo WORKER UPDATE ERROR&pause&exit /b 1)
echo DONE VERSION !VER!
pause