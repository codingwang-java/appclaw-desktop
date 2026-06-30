@echo off
echo Killing AppClaw processes...
taskkill /f /im AppClaw.exe 2>nul
timeout /t 2 /nobreak >nul

echo Removing corrupted database...
del /f /q "%USERPROFILE%\.appclaw\workspaces\default\memory.db" 2>nul

echo.
echo Done! You can now start AppClaw.
pause