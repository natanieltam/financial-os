@echo off
REM Financial OS restore verification (PRD section 63) - see docs/BACKUP.md
cd /d "%~dp0.."
python scripts\restore_test.py %*
exit /b %ERRORLEVEL%
