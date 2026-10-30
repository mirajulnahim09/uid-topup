@echo off
cd /d "%~dp0"
echo ==== UID TopUp dev fix ==== > fix-dev.log
echo [0/5] stopping old dev server on port 3000 >> fix-dev.log
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /PID %%p /F >> fix-dev.log 2>&1
echo [1/5] starting Docker dev database (port 5434) >> fix-dev.log
call npm run dev:db:up >> fix-dev.log 2>&1 || goto :err
echo [2/5] applying new schema to LOCAL dev DB only >> fix-dev.log
set "DATABASE_URL=postgresql://dev:dev@localhost:5434/uidtopup_dev"
set "DIRECT_URL=postgresql://dev:dev@localhost:5434/uidtopup_dev"
call npx prisma db push --skip-generate >> fix-dev.log 2>&1 || goto :err
set DATABASE_URL=
set DIRECT_URL=
echo [3/5] prisma generate >> fix-dev.log
call npx prisma generate >> fix-dev.log 2>&1 || goto :err
echo [4/5] clearing .next cache >> fix-dev.log
if exist .next rmdir /s /q .next
echo [5/5] starting dev server - OK >> fix-dev.log
call npm run dev
goto :eof
:err
echo FAILED >> fix-dev.log
type fix-dev.log
pause
