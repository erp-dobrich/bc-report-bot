@echo off
setlocal EnableExtensions
powershell -NoProfile -Command "try{$r=Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:9923/shutdown' -TimeoutSec 5;$r|ConvertTo-Json -Compress}catch{Write-Host $_.Exception.Message;exit 1}"
if errorlevel 1 pause&exit /b 1
echo SAFE STOP REQUESTED. Backend will close after active operations finish.
pause