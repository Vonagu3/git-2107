#!/bin/zsh
# Публикация тренажёра: прогоняет уровни, проставляет новую версию engine.js (чтобы браузеры
# не брали старый кэш), делает коммит и отправляет на GitHub. Запуск: ./publish.sh "что поменял"
set -e
cd "$(dirname "$0")"
node тест.mjs > /dev/null || { echo "Уровни не проходят: node тест.mjs"; exit 1; }
V=$(date +%Y%m%d%H%M%S)
sed -i '' -E "s/engine\.js(\?v=[0-9]+)?\"/engine.js?v=$V\"/" index.html
git add -A
git commit -q -m "${1:-Обновление тренажёра}" || true
git push -q
echo "Опубликовано, версия $V. Сайт обновится в течение минуты: https://www.irtuganov.pro/git-2107/"
