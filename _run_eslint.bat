@echo off
cd /d "C:\Users\JoJo\job work\omsons\frontend"
node_modules\.bin\eslint.cmd src/components/reports/DealerCategoryReport.tsx
exit /b %ERRORLEVEL%
