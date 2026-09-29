#!/bin/zsh
# Публикация тренажёра: прогоняет уровни, проставляет новую версию js/css (чтобы браузеры
# не брали старый кэш), делает коммит и отправляет на GitHub. Запуск: ./publish.sh "что поменял"
set -e
cd "$(dirname "$0")"
node тест.mjs > /dev/null || { echo "Уровни не проходят: node тест.mjs"; exit 1; }
V=$(date +%Y%m%d%H%M%S)
for f in *.html; do
  sed -i '' -E "s/(engine\.js|teacher\.js|live\.js|quiz\.js|quiz\.css)(\?v=[0-9]+)?\"/\1?v=$V\"/g" "$f"
done
git add -A
git commit -q -m "${1:-Обновление тренажёра}" || true
git push -q
echo "Опубликовано, версия $V. Сайт обновится в течение минуты: https://www.irtuganov.pro/git-2107/"
