CryptoVegas — запуск

1. Отредактируй config.json
2. pip install flask
3. python3 server.py
4. http://127.0.0.1:8080

Языки: RU / UK / EN (переключатель в шапке)

Промокоды: вкладка «Промокоды» + создание в Админке

Telegram:
  /stats — статистика (пользователи, балансы, выводы, промо)
  /help  — справка
  Заявки на вывод — кнопки Подтвердить / Отклонить

config.json:
  admin_password, telegram.*, support_username,
  win_chance_percent (1-100), min_withdraw, deposit_details


=== Render ===
1. В GitHub все файлы server.py, index.html, styles.css, script.js, i18n.js, config.json
   должны лежать В КОРНЕ репозитория (не во вложенной папке).
2. Render → Web Service:
   Build: pip install -r requirements.txt
   Start: gunicorn server:app --bind 0.0.0.0:$PORT --workers 1 --threads 4
3. Root Directory: пусто (если файлы в корне) ИЛИ имя папки, где лежит server.py
