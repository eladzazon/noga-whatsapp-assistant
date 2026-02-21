@echo off
SETLOCAL EnableExtensions
title Noga WhatsApp Assistant

:: Set colors (Green on Black)
color 0A

echo.
echo    =============================================
echo       🏠  NOGA WHATSAPP AI HOME ASSISTANT  🏠
echo    =============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js 18 or higher from https://nodejs.org/
    pause
    exit /b
)

:: Check for .env file
if not exist .env (
    echo [!] .env file is missing.
    echo [i] Creating .env from .env.example...
    copy .env.example .env
    echo [!] Please edit the .env file with your API keys before running.
    notepad .env
    echo [i] After editing .env, run this script again.
    pause
    exit /b
)

:: Check for node_modules
if not exist node_modules (
    echo [i] Dependencies not found. Running npm install...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b
    )
)

echo [i] Starting Noga in Development Mode...
echo [i] Dashboard will be available at http://localhost:3000 (check your .env for port)
echo.

:: Use npm run dev which uses node --watch
call npm run dev

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Noga stopped with an error (Code: %ERRORLEVEL%).
    echo [i] If this was a crash, check the logs or ensure your .env is correct.
    pause
)

ENDLOCAL
