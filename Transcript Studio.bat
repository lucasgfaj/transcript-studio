@echo off
rem Double-click (or copy to the Desktop): starts Transcript Studio inside WSL and opens the browser.
rem Close this window to stop the app.
title Transcript Studio
wsl.exe -d Ubuntu -e bash -lc "~/transcript-studio/dev.sh start"
pause
