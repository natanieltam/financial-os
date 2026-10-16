@echo off
REM Financial OS - production server launcher (PRD section64). Run from repo root.
REM Logs to logs\production.log; Node keeps serving until stopped/crashed (schedule
REM with Task Scheduler ONSTART + retry - see docs/DEPLOYMENT.md).
cd /d "%~dp0.."
if not exist ".output\server\index.mjs" (
  echo Build not found - run: npm run build
  exit /b 1
)
if not exist ".env" (
  echo Missing .env - copy .env.example and fill SESSION_SECRET + DATABASE_URL
  exit /b 1
)
set NODE_ENV=production
if not exist "logs" mkdir "logs"
echo Starting Financial OS production server...
node .output\server\index.mjs >> logs\production.log 2>&1
