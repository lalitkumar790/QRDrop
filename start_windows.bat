@echo off
setlocal
cd /d "%~dp0"
echo QRDrop setup...
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m pip install -r requirements.txt
  if errorlevel 1 goto error
  py -3 server.py --open-browser
) else (
  python -m pip install -r requirements.txt
  if errorlevel 1 goto error
  python server.py --open-browser
)
goto end
:error
echo.
echo Could not install dependencies. Install Python 3.10+ and try again.
pause
:end
endlocal
