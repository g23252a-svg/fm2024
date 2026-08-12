#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────
#  FM24 전술 생성기 — 겹쳐 보기 창 띄우기 (macOS / Linux)
#
#  주소창 없는 좁은 창으로 띄웁니다. FM 위에 항상 두려면
#    macOS : Rectangle / BetterTouchTool 등의 "Always on Top"
#    Linux : 창 제목 표시줄 우클릭 → "항상 위에"
#  를 쓰면 됩니다. FM은 창 모드로 두세요.
#
#  사용법:  sh tools/overlay.sh
# ──────────────────────────────────────────────────────────────────────────
set -eu

DIR=$(cd "$(dirname "$0")/.." && pwd)
PAGE="file://$DIR/index.html?overlay=1"
ARGS="--app=$PAGE --window-size=380,900 --user-data-dir=${TMPDIR:-/tmp}/fm24tactics-overlay"

for CAND in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)" \
  "$(command -v microsoft-edge || true)"
do
  [ -n "$CAND" ] && [ -x "$CAND" ] || continue
  exec "$CAND" $ARGS
done

echo "Chrome/Chromium/Edge를 찾지 못했습니다."
echo "index.html을 브라우저로 열고 오른쪽 위 「겹쳐 보기」를 누르세요."
exit 1
