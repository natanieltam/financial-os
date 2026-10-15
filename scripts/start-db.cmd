@echo off
rem Start local PostgreSQL with a real Windows TEMP (git-bash TEMP=/tmp crashes PG backends).
set TEMP=C:\Users\Fabulous\AppData\Local\Temp
set TMP=C:\Users\Fabulous\AppData\Local\Temp
"%LOCALAPPDATA%\pgsql16\pg16\pgsql\bin\pg_ctl.exe" start -D "%LOCALAPPDATA%\pgsql16\data" -l "%LOCALAPPDATA%\pgsql16\pg.log" -w -t 60
