@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
)
echo.
echo Make sure your iPhone is on the same Wi-Fi as this PC.
echo In Safari on the phone, open the "Network:" https address shown below.
echo Safari will warn that the certificate is not trusted: tap Show Details, then visit this website.
echo.
call npm run phone
pause
