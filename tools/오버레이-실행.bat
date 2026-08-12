@echo off
rem ─────────────────────────────────────────────────────────────────────────
rem  FM24 전술 생성기 — 겹쳐 보기 창 띄우기 (Windows)
rem
rem  주소창·탭 없는 좁은 창으로 띄웁니다. 이 창을 FM 위에 항상 두려면
rem  PowerToys를 설치하고 창을 고른 뒤 Win+Ctrl+T 를 누르세요.
rem  FM은 「창 모드」 또는 「테두리 없는 창 모드」로 두어야 겹쳐 보입니다.
rem
rem  이 파일을 index.html과 같은 폴더에 두고 두 번 누르면 됩니다.
rem ─────────────────────────────────────────────────────────────────────────

setlocal
set "PAGE=file:///%~dp0index.html?overlay=1"
set "PAGE=%PAGE:\=/%"

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not defined BROWSER (
  echo Chrome 또는 Edge를 찾지 못했습니다. index.html을 브라우저로 직접 열고
  echo 오른쪽 위 「겹쳐 보기」를 누르세요.
  pause
  exit /b 1
)

rem 프로필을 따로 쓰면 이미 열려 있는 브라우저 창에 탭으로 붙지 않고 새 창이 뜹니다.
start "" "%BROWSER%" --app="%PAGE%" --window-size=380,900 --user-data-dir="%TEMP%\fm24tactics-overlay"
endlocal
