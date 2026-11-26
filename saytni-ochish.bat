@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ========================================================
echo        Ilm+ tizimi (Mustaqil izlanuvchilar monitoringi)
echo ========================================================
echo.
where node > nul 2>&1
if errorlevel 1 (
  echo [XATO] Node.js o'rnatilmagan. https://nodejs.org saytidan LTS versiyasini o'rnating.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Kerakli paketlar o'rnatilmoqda...
  call npm install || goto :error
)
echo Frontend yig'ilmoqda...
call npm run build || goto :error
echo.
echo Brauzer ochilmoqda: http://localhost:5000
echo Admin login: OTKTF. Parol birinchi ishga tushirishda quyida chiqadi
echo (nusxasi: backend\data\ADMIN_PAROL.txt).
echo.
start "" http://localhost:5000
call npm start
pause
exit /b 0

:error
echo.
echo [XATO] Jarayon muvaffaqiyatsiz tugadi. Yuqoridagi xabarni o'qing.
pause
exit /b 1
