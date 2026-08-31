#!/usr/bin/env python3
"""CryptoVegas — backend SQLite + Telegram-заявки на вывод."""
import os
import json
import sqlite3
import secrets
import hashlib
import threading
import time
import urllib.request
import urllib.parse
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify, send_from_directory, g

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE, "config.json")


def load_config():
    """Читает config.json. Переменные окружения имеют приоритет, если заданы."""
    cfg = {
        "admin_password": "admin123",
        "telegram": {"bot_token": "", "admin_chat_id": ""},
        "server": {"host": "0.0.0.0", "port": 8080},
        "database": {"path": "casino.db"},
        "min_withdraw": {"TON": 1, "USDT": 5, "RUB": 500, "UAH": 200},
        "support_username": "username",
        "win_chance_percent": 48,
        "deposit_details": {
            "RUB": "2200 7001 2345 6789",
            "UAH": "4149 4991 2345 6789",
            "USDT": "TYourUsdtTrc20Address",
            "TON": "UQYourTonAddress",
        },
        "deposit_hints": {
            "RUB": "Переведите на карту. В комментарии укажите свой email.",
            "UAH": "Перекажіть на картку. У коментарі вкажіть свій email.",
            "USDT": "Отправьте USDT TRC-20. В memo — ваш email.",
            "TON": "Отправьте TON. В комментарии — email аккаунта.",
        },
    }
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                file_cfg = json.load(f)
            # deep-ish merge top level
            for k, v in file_cfg.items():
                if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                    cfg[k].update(v)
                else:
                    cfg[k] = v
        except Exception as e:
            print("Ошибка чтения config.json:", e)
    return cfg


CFG = load_config()

# Путь к БД
_db = CFG.get("database", {}).get("path") or "casino.db"
DB_PATH = os.environ.get("CASINO_DB") or (
    _db if os.path.isabs(_db) else os.path.join(BASE, _db)
)

ADMIN_PASS = os.environ.get("ADMIN_PASS") or str(CFG.get("admin_password") or "admin123")

_tg = CFG.get("telegram") or {}
TG_BOT_TOKEN = (os.environ.get("TG_BOT_TOKEN") or str(_tg.get("bot_token") or "")).strip()
TG_ADMIN_CHAT_ID = (os.environ.get("TG_ADMIN_CHAT_ID") or str(_tg.get("admin_chat_id") or "")).strip()
# заглушки из примера не считаем настроенными
if TG_BOT_TOKEN.startswith("ВСТАВЬ"):
    TG_BOT_TOKEN = ""
if TG_ADMIN_CHAT_ID.startswith("ВСТАВЬ"):
    TG_ADMIN_CHAT_ID = ""

MIN_WITHDRAW = {
    "TON": 1.0,
    "USDT": 5.0,
    "RUB": 500.0,
    "UAH": 200.0,
}
for k, v in (CFG.get("min_withdraw") or {}).items():
    try:
        MIN_WITHDRAW[str(k).upper()] = float(v)
    except (TypeError, ValueError):
        pass

DEPOSIT_DETAILS = CFG.get("deposit_details") or {}
DEPOSIT_HINTS = CFG.get("deposit_hints") or {}
_support = str(CFG.get("support_username") or "username").strip().lstrip("@")
SUPPORT_USERNAME = _support or "username"
try:
    WIN_CHANCE_PERCENT = float(CFG.get("win_chance_percent", 48))
except (TypeError, ValueError):
    WIN_CHANCE_PERCENT = 48.0
WIN_CHANCE_PERCENT = max(1.0, min(100.0, WIN_CHANCE_PERCENT))

SERVER_HOST = (CFG.get("server") or {}).get("host") or "0.0.0.0"
SERVER_PORT = int((CFG.get("server") or {}).get("port") or 8080)

app = Flask(__name__, static_folder=BASE, static_url_path="")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=30)
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            currency TEXT NOT NULL CHECK(currency IN ('RUB','UAH','USDT','TON')),
            balance REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT PRIMARY KEY,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_after REAL NOT NULL,
            meta TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            currency TEXT NOT NULL,
            amount REAL NOT NULL,
            amount_ton REAL NOT NULL,
            details TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','approved','rejected')),
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            admin_note TEXT
        );
        CREATE TABLE IF NOT EXISTS promo_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE COLLATE NOCASE,
            amount REAL NOT NULL,
            currency TEXT,
            max_uses INTEGER NOT NULL DEFAULT 100,
            used_count INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS promo_redemptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promo_id INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(promo_id, user_id)
        );
        """
    )
    db.commit()
    db.close()


def hash_password(password: str) -> str:
    return hashlib.sha256(("cv_salt_v1" + password).encode("utf-8")).hexdigest()


def now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def user_dict(row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "currency": row["currency"],
        "balance": float(row["balance"]),
    }


def min_withdraw_for(currency: str) -> float:
    return float(MIN_WITHDRAW.get(currency, MIN_WITHDRAW.get("TON", 1.0)))


def require_user(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.startswith("Bearer ") else ""
        if not token:
            return jsonify({"error": "Нужна авторизация"}), 401
        db = get_db()
        row = db.execute(
            """
            SELECT u.* FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            return jsonify({"error": "Сессия недействительна"}), 401
        g.user = row
        g.token = token
        return fn(*args, **kwargs)

    return wrapper


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.startswith("Bearer ") else ""
        if not token:
            return jsonify({"error": "Нужна авторизация админа"}), 401
        db = get_db()
        row = db.execute(
            "SELECT token FROM admin_sessions WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return jsonify({"error": "Админ-сессия недействительна"}), 401
        return fn(*args, **kwargs)

    return wrapper


def add_tx(db, user_id, kind, amount, balance_after, meta=None):
    db.execute(
        """
        INSERT INTO transactions (user_id, kind, amount, balance_after, meta, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, kind, amount, balance_after, meta, now()),
    )


# ---------- Telegram ----------
def tg_api(method: str, payload: dict):
    if not TG_BOT_TOKEN:
        return None
    url = f"https://api.telegram.org/bot{TG_BOT_TOKEN}/{method}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print("TG error:", e)
        return None


def send_withdraw_to_tg(w_id: int, user_row, amount: float, amount_ton: float, details: str):
    if not TG_BOT_TOKEN or not TG_ADMIN_CHAT_ID:
        print("TG не настроен: задай TG_BOT_TOKEN и TG_ADMIN_CHAT_ID")
        return False
    text = (
        f"💸 <b>Заявка на вывод #{w_id}</b>\n\n"
        f"Игрок: {user_row['name']}\n"
        f"Email: <code>{user_row['email']}</code>\n"
        f"Сумма: <b>{amount:g} {user_row['currency']}</b>\n"
        f"Реквизиты:\n<code>{details}</code>\n\n"
        f"Статус: ожидает решения"
    )
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Подтвердить", "callback_data": f"wd_ok:{w_id}"},
                {"text": "❌ Отклонить", "callback_data": f"wd_no:{w_id}"},
            ]
        ]
    }
    res = tg_api(
        "sendMessage",
        {
            "chat_id": TG_ADMIN_CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "reply_markup": keyboard,
        },
    )
    return bool(res and res.get("ok"))


def resolve_withdrawal(w_id: int, approve: bool) -> str:
    """Обработка из TG или API. Возвращает текст ответа."""
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.row_factory = sqlite3.Row
    w = db.execute("SELECT * FROM withdrawals WHERE id = ?", (w_id,)).fetchone()
    if not w:
        db.close()
        return f"Заявка #{w_id} не найдена"
    if w["status"] != "pending":
        db.close()
        return f"Заявка #{w_id} уже обработана: {w['status']}"

    user = db.execute("SELECT * FROM users WHERE id = ?", (w["user_id"],)).fetchone()
    if approve:
        db.execute(
            "UPDATE withdrawals SET status='approved', resolved_at=? WHERE id=?",
            (now(), w_id),
        )
        db.commit()
        db.close()
        return (
            f"✅ Заявка #{w_id} подтверждена\n"
            f"{w['amount']:g} {w['currency']} → {user['email']}\n"
            f"Реквизиты: {w['details']}"
        )
    else:
        # вернуть деньги
        new_bal = float(user["balance"]) + float(w["amount"])
        db.execute("UPDATE users SET balance = ? WHERE id = ?", (new_bal, user["id"]))
        db.execute(
            "UPDATE withdrawals SET status='rejected', resolved_at=? WHERE id=?",
            (now(), w_id),
        )
        db.execute(
            """
            INSERT INTO transactions (user_id, kind, amount, balance_after, meta, created_at)
            VALUES (?, 'withdraw_reject', ?, ?, ?, ?)
            """,
            (user["id"], float(w["amount"]), new_bal, f"wd#{w_id}", now()),
        )
        db.commit()
        db.close()
        return (
            f"❌ Заявка #{w_id} отклонена, средства возвращены\n"
            f"+{w['amount']:g} {w['currency']} → {user['email']}"
        )



def build_stats_text() -> str:
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.row_factory = sqlite3.Row
    users = db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    bal = db.execute(
        "SELECT currency, COALESCE(SUM(balance),0) AS s, COUNT(*) AS c FROM users GROUP BY currency"
    ).fetchall()
    wd_pending = db.execute(
        "SELECT COUNT(*) AS c FROM withdrawals WHERE status='pending'"
    ).fetchone()["c"]
    wd_ok = db.execute(
        "SELECT COUNT(*) AS c FROM withdrawals WHERE status='approved'"
    ).fetchone()["c"]
    wd_no = db.execute(
        "SELECT COUNT(*) AS c FROM withdrawals WHERE status='rejected'"
    ).fetchone()["c"]
    promo_n = db.execute("SELECT COUNT(*) AS c FROM promo_codes WHERE active=1").fetchone()["c"]
    promo_uses = db.execute("SELECT COALESCE(SUM(used_count),0) AS s FROM promo_codes").fetchone()["s"]
    txs = db.execute("SELECT COUNT(*) AS c FROM transactions").fetchone()["c"]
    lines = [
        "📊 <b>Статистика CryptoVegas</b>",
        "",
        f"👥 Пользователей: <b>{users}</b>",
        f"🎟 Активных промо: <b>{promo_n}</b> (активаций: {promo_uses})",
        f"📜 Транзакций: <b>{txs}</b>",
        "",
        "💰 Балансы по валютам:",
    ]
    if not bal:
        lines.append("— нет данных")
    else:
        for r in bal:
            lines.append(f"• {r['currency']}: {float(r['s']):g} (игроков: {r['c']})")
    lines += [
        "",
        "💸 Выводы:",
        f"• ожидают: <b>{wd_pending}</b>",
        f"• выплачено: <b>{wd_ok}</b>",
        f"• отклонено: <b>{wd_no}</b>",
    ]
    db.close()
    return "\n".join(lines)


def tg_poll_loop():
    """Фоновый long-polling для кнопок в Telegram."""
    if not TG_BOT_TOKEN:
        print("TG polling выключен (нет TG_BOT_TOKEN)")
        return
    offset = 0
    print("TG polling запущен")
    while True:
        try:
            url = (
                f"https://api.telegram.org/bot{TG_BOT_TOKEN}/getUpdates"
                f"?timeout=30&offset={offset}"
            )
            with urllib.request.urlopen(url, timeout=35) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if not data.get("ok"):
                time.sleep(3)
                continue
            for upd in data.get("result", []):
                offset = max(offset, upd["update_id"] + 1)
                # text commands from admin
                msg = upd.get("message") or {}
                if msg.get("text") and TG_ADMIN_CHAT_ID:
                    chat_id = str(msg.get("chat", {}).get("id", ""))
                    if chat_id == str(TG_ADMIN_CHAT_ID):
                        text = (msg.get("text") or "").strip()
                        if text.startswith("/stats") or text.startswith("/stat"):
                            tg_api("sendMessage", {"chat_id": chat_id, "text": build_stats_text(), "parse_mode": "HTML"})
                        elif text.startswith("/start") or text.startswith("/help"):
                            tg_api(
                                "sendMessage",
                                {
                                    "chat_id": chat_id,
                                    "text": (
                                        "CryptoVegas бот\n\n"
                                        "/stats — статистика\n"
                                        "Заявки на вывод приходят с кнопками сюда."
                                    ),
                                },
                            )
                cb = upd.get("callback_query")
                if not cb:
                    continue
                chat_id = str(cb.get("message", {}).get("chat", {}).get("id", ""))
                if TG_ADMIN_CHAT_ID and chat_id != str(TG_ADMIN_CHAT_ID):
                    continue
                payload = cb.get("data") or ""
                cq_id = cb.get("id")
                msg = ""
                if payload.startswith("wd_ok:"):
                    wid = int(payload.split(":")[1])
                    msg = resolve_withdrawal(wid, True)
                elif payload.startswith("wd_no:"):
                    wid = int(payload.split(":")[1])
                    msg = resolve_withdrawal(wid, False)
                else:
                    continue
                tg_api("answerCallbackQuery", {"callback_query_id": cq_id, "text": "Готово"})
                tg_api(
                    "editMessageReplyMarkup",
                    {
                        "chat_id": chat_id,
                        "message_id": cb["message"]["message_id"],
                        "reply_markup": {"inline_keyboard": []},
                    },
                )
                tg_api(
                    "sendMessage",
                    {"chat_id": chat_id, "text": msg, "parse_mode": "HTML"},
                )
        except Exception as e:
            print("TG poll error:", e)
            time.sleep(5)


# ---------- static ----------
@app.route("/")
def index():
    return send_from_directory(BASE, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(BASE, path)


# ---------- rates ----------
@app.get("/api/rates")
def rates():
    return jsonify(
        {
            "min_withdraw": MIN_WITHDRAW,
            "deposit_details": DEPOSIT_DETAILS,
            "deposit_hints": DEPOSIT_HINTS,
            "support_username": SUPPORT_USERNAME,
            "win_chance_percent": WIN_CHANCE_PERCENT,
        }
    )


# ---------- auth ----------
@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    currency = (data.get("currency") or "").upper()
    if not name or not email or not password:
        return jsonify({"error": "Заполните все поля"}), 400
    if len(password) < 6:
        return jsonify({"error": "Пароль минимум 6 символов"}), 400
    if currency not in ('RUB', 'UAH', 'USDT', 'TON'):
        return jsonify({"error": "Некорректная валюта"}), 400
    db = get_db()
    if db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify({"error": "Этот email уже зарегистрирован"}), 400
    db.execute(
        """
        INSERT INTO users (email, name, password_hash, currency, balance, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
        """,
        (email, name, hash_password(password), currency, now()),
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    token = secrets.token_hex(24)
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user["id"], now()),
    )
    db.commit()
    return jsonify({"token": token, "user": user_dict(user)})


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or user["password_hash"] != hash_password(password):
        return jsonify({"error": "Неверный email или пароль"}), 401
    token = secrets.token_hex(24)
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user["id"], now()),
    )
    db.commit()
    return jsonify({"token": token, "user": user_dict(user)})


@app.post("/api/logout")
@require_user
def logout():
    db = get_db()
    db.execute("DELETE FROM sessions WHERE token = ?", (g.token,))
    db.commit()
    return jsonify({"ok": True})


@app.get("/api/me")
@require_user
def me():
    return jsonify({"user": user_dict(g.user)})


@app.post("/api/balance/sync")
@require_user
def balance_sync():
    data = request.get_json(silent=True) or {}
    kind = (data.get("kind") or "play").strip()
    amount = float(data.get("amount") or 0)
    db = get_db()
    bal = float(
        db.execute("SELECT balance FROM users WHERE id = ?", (g.user["id"],)).fetchone()[
            "balance"
        ]
    )
    new_bal = bal + amount
    if new_bal < -1e-9:
        return jsonify({"error": "Недостаточно средств", "balance": bal}), 400
    new_bal = max(0.0, new_bal)
    db.execute("UPDATE users SET balance = ? WHERE id = ?", (new_bal, g.user["id"]))
    add_tx(db, g.user["id"], kind, amount, new_bal, data.get("meta"))
    db.commit()
    return jsonify({"balance": new_bal})


# ---------- withdraw ----------
@app.post("/api/withdraw")
@require_user
def withdraw_create():
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Некорректная сумма"}), 400
    details = (data.get("details") or "").strip()
    if amount <= 0:
        return jsonify({"error": "Сумма должна быть > 0"}), 400
    if len(details) < 5:
        return jsonify({"error": "Укажите реквизиты для вывода"}), 400

    currency = g.user["currency"]
    mn = min_withdraw_for(currency)
    if amount + 1e-9 < mn:
        return jsonify(
            {
                "error": f"Минимум {mn:g} {currency}",
                "min": mn,
            }
        ), 400

    db = get_db()
    bal = float(
        db.execute("SELECT balance FROM users WHERE id = ?", (g.user["id"],)).fetchone()[
            "balance"
        ]
    )
    if amount > bal + 1e-9:
        return jsonify({"error": "Недостаточно средств", "balance": bal}), 400

    # amount_ton: для TON = amount, иначе 0 (колонка оставлена для совместимости)
    amount_ton = amount if currency == "TON" else 0.0
    new_bal = bal - amount
    db.execute("UPDATE users SET balance = ? WHERE id = ?", (new_bal, g.user["id"]))
    cur = db.execute(
        """
        INSERT INTO withdrawals (user_id, currency, amount, amount_ton, details, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
        """,
        (g.user["id"], currency, amount, amount_ton, details, now()),
    )
    w_id = cur.lastrowid
    add_tx(db, g.user["id"], "withdraw_hold", -amount, new_bal, f"wd#{w_id}")
    db.commit()

    user_row = db.execute("SELECT * FROM users WHERE id = ?", (g.user["id"],)).fetchone()
    sent = send_withdraw_to_tg(w_id, user_row, amount, amount_ton, details)

    return jsonify(
        {
            "ok": True,
            "id": w_id,
            "balance": new_bal,
            "amount": amount,
            "amount_ton": amount_ton,
            "tg_sent": sent,
            "status": "pending",
        }
    )


@app.get("/api/withdraw/my")
@require_user
def withdraw_my():
    db = get_db()
    rows = db.execute(
        """
        SELECT id, currency, amount, amount_ton, details, status, created_at, resolved_at
        FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50
        """,
        (g.user["id"],),
    ).fetchall()
    items = [
        {
            "id": r["id"],
            "currency": r["currency"],
            "amount": float(r["amount"]),
            "amount_ton": float(r["amount_ton"]),
            "details": r["details"],
            "status": r["status"],
            "created_at": r["created_at"],
            "resolved_at": r["resolved_at"],
        }
        for r in rows
    ]
    return jsonify({"items": items})


@app.get("/api/admin/withdrawals")
@require_admin
def admin_withdrawals():
    status = request.args.get("status", "pending")
    db = get_db()
    if status == "all":
        rows = db.execute(
            """
            SELECT w.*, u.email, u.name FROM withdrawals w
            JOIN users u ON u.id = w.user_id
            ORDER BY w.id DESC LIMIT 100
            """
        ).fetchall()
    else:
        rows = db.execute(
            """
            SELECT w.*, u.email, u.name FROM withdrawals w
            JOIN users u ON u.id = w.user_id
            WHERE w.status = ?
            ORDER BY w.id DESC LIMIT 100
            """,
            (status,),
        ).fetchall()
    items = [
        {
            "id": r["id"],
            "email": r["email"],
            "name": r["name"],
            "currency": r["currency"],
            "amount": float(r["amount"]),
            "amount_ton": float(r["amount_ton"]),
            "details": r["details"],
            "status": r["status"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    return jsonify({"items": items})


@app.post("/api/admin/withdrawals/<int:w_id>/resolve")
@require_admin
def admin_resolve(w_id):
    data = request.get_json(silent=True) or {}
    approve = bool(data.get("approve"))
    msg = resolve_withdrawal(w_id, approve)
    return jsonify({"ok": True, "message": msg})



# ---------- promo ----------
@app.get("/api/promo/my")
@require_user
def promo_my():
    db = get_db()
    rows = db.execute(
        """
        SELECT pr.amount, pr.currency, pr.created_at, p.code
        FROM promo_redemptions pr
        JOIN promo_codes p ON p.id = pr.promo_id
        WHERE pr.user_id = ?
        ORDER BY pr.id DESC LIMIT 50
        """,
        (g.user["id"],),
    ).fetchall()
    return jsonify(
        {
            "items": [
                {
                    "code": r["code"],
                    "amount": float(r["amount"]),
                    "currency": r["currency"],
                    "created_at": r["created_at"],
                }
                for r in rows
            ]
        }
    )


@app.post("/api/promo/redeem")
@require_user
def promo_redeem():
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip().upper()
    if not code:
        return jsonify({"error": "Введите промокод"}), 400
    db = get_db()
    promo = db.execute(
        "SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE", (code,)
    ).fetchone()
    if not promo or not promo["active"]:
        return jsonify({"error": "Промокод не найден или неактивен"}), 404
    if promo["used_count"] >= promo["max_uses"]:
        return jsonify({"error": "Лимит активаций исчерпан"}), 400
    exists = db.execute(
        "SELECT id FROM promo_redemptions WHERE promo_id = ? AND user_id = ?",
        (promo["id"], g.user["id"]),
    ).fetchone()
    if exists:
        return jsonify({"error": "Вы уже активировали этот промокод"}), 400

    currency = (promo["currency"] or g.user["currency"] or "RUB").upper()
    # если промо привязан к валюте — только для аккаунтов этой валюты
    if promo["currency"] and promo["currency"].upper() != g.user["currency"]:
        return jsonify(
            {"error": f"Промокод только для валюты {promo['currency']}"}
        ), 400
    amount = float(promo["amount"])
    if amount <= 0:
        return jsonify({"error": "Некорректный промокод"}), 400

    new_bal = float(g.user["balance"]) + amount
    db.execute("UPDATE users SET balance = ? WHERE id = ?", (new_bal, g.user["id"]))
    db.execute(
        "UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?", (promo["id"],)
    )
    db.execute(
        """
        INSERT INTO promo_redemptions (promo_id, user_id, amount, currency, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (promo["id"], g.user["id"], amount, g.user["currency"], now()),
    )
    add_tx(db, g.user["id"], "promo", amount, new_bal, code)
    db.commit()
    return jsonify(
        {
            "ok": True,
            "amount": amount,
            "currency": g.user["currency"],
            "balance": new_bal,
            "code": code,
        }
    )


@app.get("/api/admin/promos")
@require_admin
def admin_promos():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM promo_codes ORDER BY id DESC LIMIT 100"
    ).fetchall()
    return jsonify(
        {
            "items": [
                {
                    "id": r["id"],
                    "code": r["code"],
                    "amount": float(r["amount"]),
                    "currency": r["currency"],
                    "max_uses": r["max_uses"],
                    "used_count": r["used_count"],
                    "active": bool(r["active"]),
                    "created_at": r["created_at"],
                }
                for r in rows
            ]
        }
    )


@app.post("/api/admin/promos")
@require_admin
def admin_promos_create():
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip().upper()
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Некорректная сумма"}), 400
    currency = (data.get("currency") or "").strip().upper() or None
    if currency in ("", "USER", "ANY", "NULL"):
        currency = None
    if currency and currency not in ("RUB", "UAH", "USDT", "TON"):
        return jsonify({"error": "Некорректная валюта"}), 400
    try:
        max_uses = int(data.get("max_uses") or 100)
    except (TypeError, ValueError):
        max_uses = 100
    max_uses = max(1, max_uses)
    if not code or len(code) < 3:
        return jsonify({"error": "Код минимум 3 символа"}), 400
    if amount <= 0:
        return jsonify({"error": "Сумма должна быть > 0"}), 400
    db = get_db()
    if db.execute("SELECT id FROM promo_codes WHERE code = ? COLLATE NOCASE", (code,)).fetchone():
        return jsonify({"error": "Такой код уже есть"}), 400
    db.execute(
        """
        INSERT INTO promo_codes (code, amount, currency, max_uses, used_count, active, created_at)
        VALUES (?, ?, ?, ?, 0, 1, ?)
        """,
        (code, amount, currency, max_uses, now()),
    )
    db.commit()
    return jsonify({"ok": True, "code": code})


@app.post("/api/admin/promos/<int:pid>/toggle")
@require_admin
def admin_promos_toggle(pid):
    db = get_db()
    row = db.execute("SELECT active FROM promo_codes WHERE id = ?", (pid,)).fetchone()
    if not row:
        return jsonify({"error": "Не найден"}), 404
    new_a = 0 if row["active"] else 1
    db.execute("UPDATE promo_codes SET active = ? WHERE id = ?", (new_a, pid))
    db.commit()
    return jsonify({"ok": True, "active": bool(new_a)})


@app.get("/api/admin/stats")
@require_admin
def admin_stats():
    return jsonify({"text": build_stats_text().replace("<b>", "").replace("</b>", "")})


# ---------- admin ----------
@app.post("/api/admin/login")
def admin_login():
    data = request.get_json(silent=True) or {}
    if (data.get("password") or "") != ADMIN_PASS:
        return jsonify({"error": "Неверный пароль"}), 401
    token = secrets.token_hex(24)
    db = get_db()
    db.execute(
        "INSERT INTO admin_sessions (token, created_at) VALUES (?, ?)", (token, now())
    )
    db.commit()
    return jsonify({"token": token})


@app.post("/api/admin/logout")
@require_admin
def admin_logout():
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip()
    db = get_db()
    db.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
    db.commit()
    return jsonify({"ok": True})


@app.get("/api/admin/users")
@require_admin
def admin_users():
    db = get_db()
    rows = db.execute(
        "SELECT id, email, name, currency, balance, created_at FROM users ORDER BY id DESC"
    ).fetchall()
    users = [
        {
            "id": r["id"],
            "email": r["email"],
            "name": r["name"],
            "currency": r["currency"],
            "balance": float(r["balance"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    return jsonify({"users": users, "count": len(users)})


@app.post("/api/admin/credit")
@require_admin
def admin_credit():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Некорректная сумма"}), 400
    if amount <= 0:
        return jsonify({"error": "Сумма должна быть > 0"}), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user:
        return jsonify({"error": "Пользователь не найден"}), 404
    new_bal = float(user["balance"]) + amount
    db.execute("UPDATE users SET balance = ? WHERE id = ?", (new_bal, user["id"]))
    add_tx(db, user["id"], "admin_credit", amount, new_bal, "admin")
    db.commit()
    return jsonify(
        {
            "ok": True,
            "email": email,
            "currency": user["currency"],
            "balance": new_bal,
            "amount": amount,
        }
    )


if __name__ == "__main__":
    init_db()
    print("Конфиг:", CONFIG_PATH)
    print("DB:", DB_PATH)
    print("Админ-пароль:", ADMIN_PASS)
    print("Мин. вывод по валютам:", MIN_WITHDRAW)
    print("Шанс выигрыша:", WIN_CHANCE_PERCENT, "%")
    if TG_BOT_TOKEN and TG_ADMIN_CHAT_ID:
        t = threading.Thread(target=tg_poll_loop, daemon=True)
        t.start()
        print("Telegram: ON chat_id=", TG_ADMIN_CHAT_ID)
    else:
        print("Telegram: OFF — пропиши bot_token и admin_chat_id в config.json")
    print(f"Открой http://127.0.0.1:{SERVER_PORT}")
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=False)
