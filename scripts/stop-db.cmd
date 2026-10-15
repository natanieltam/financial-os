@echo off
"%LOCALAPPDATA%\pgsql16\pg16\pgsql\bin\pg_ctl.exe" stop -D "%LOCALAPPDATA%\pgsql16\data" -m fast -w -t 60
