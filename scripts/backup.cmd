@echo off
REM Financial OS daily backup (PRD section 62) - see docs/BACKUP.md
cd /d "%~dp0.."
python scripts\backup.py %*
exit /b %ERRORLEVEL%
