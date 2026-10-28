@echo off
title Setu Companion Daemon
cd /d "%~dp0"
if not exist "config.json" (
    if exist "config.example.json" (
        copy "config.example.json" "config.json" >nul
    )
)
if exist "setu-companion.exe" (
    start "" "setu-companion.exe" %*
) else (
    node "setu-companion.js" %*
)

