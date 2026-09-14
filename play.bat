@echo off
REM Lance ECLAT sous Windows. Necessite Python 3 (coche "Add to PATH" a l'installation).
cd /d "%~dp0"
where py >nul 2>nul && (py -3 serve.py %* & goto :eof)
where python >nul 2>nul && (python serve.py %* & goto :eof)
echo Python 3 est introuvable. Installez-le depuis https://www.python.org/downloads/
pause
