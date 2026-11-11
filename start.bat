@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   نظام الشكاوى والمقترحات - جامعة اللوتس
echo   يعمل الآن على: http://127.0.0.1:8931
echo   أبقِ هذه النافذة مفتوحة أثناء الاستخدام
echo ================================================

start "LU Server" cmd /c "(python -m http.server 8931 --bind 127.0.0.1 2>nul || py -m http.server 8931 --bind 127.0.0.1)"
timeout /t 2 >nul

start "" "http://127.0.0.1:8931/index.html"
start "" "http://127.0.0.1:8931/admin.html"
