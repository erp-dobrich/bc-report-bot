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
if exist frontend-upload.zip del /q frontend-upload.zip
powershell -NoProfile -Command "Compress-Archive -Path 'frontend\*' -DestinationPath 'frontend-upload.zip' -Force"
git add version.json sync-version.js release-version.bat activate-version.bat frontend backend
git diff --cached --quiet || git commit -m "Version !VER!"
git push origin main || (echo GIT PUSH ERROR&pause&exit /b 1)
echo.
echo READY VERSION !VER!
echo Upload: frontend-upload.zip
echo After Chrome Web Store publishes it, restart backend and run activate-version.bat
pause