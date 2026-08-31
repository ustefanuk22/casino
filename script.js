const API = ''; // same origin when served by server.py
const KEY_TOKEN = 'cv_token';
const KEY_ADMIN_TOKEN = 'cv_admin_token';

let user = null; // {id, email, name, currency, balance}
let userToken = localStorage.getItem(KEY_TOKEN) || '';
let adminToken = localStorage.getItem(KEY_ADMIN_TOKEN) || '';
let isAdmin = false;
let regCur = 'RUB';

let ADDR = {
  RUB:  '2200 7001 2345 6789',
  UAH:  '4149 4991 2345 6789',
  USDT: 'TXyz123DemoUsdtAddressTrc20Example987',
  TON:  'UQBxDemoTonWalletAddressExample123456789'
};
let DEP_INFO = {
  RUB:  { label: 'Карта RUB', hint: 'Переведите на карту. В комментарии укажите свой email.' },
  UAH:  { label: 'Карта UAH', hint: 'Перекажіть на картку. У коментарі вкажіть свій email.' },
  USDT: { label: 'Адрес USDT (TRC-20)', hint: 'Отправьте USDT TRC-20. В memo — ваш email.' },
  TON:  { label: 'Адрес TON', hint: 'Отправьте TON. В комментарии — email аккаунта.' }
};
const DEFAULT_BET = { RUB: 100, UAH: 100, USDT: 10, TON: 5 };
const MIN_BET = { RUB: 10, UAH: 10, USDT: 1, TON: 0.1 };
const SYM = ['🍒','🍋','🔔','⭐','💎','7️⃣','🍀','🍇'];

const $ = id => document.getElementById(id);

/* i18n */
const KEY_LANG = 'cv_lang';
let lang = localStorage.getItem(KEY_LANG) || 'ru';
if (!['ru', 'uk', 'en'].includes(lang)) lang = 'ru';

function t(key) {
  const i18n = window.I18N || {};
  const pack = i18n[lang] || i18n.ru || {};
  if (pack[key] != null) return pack[key];
  if (i18n.ru && i18n.ru[key] != null) return i18n.ru[key];
  return key;
}

function applyI18n() {
  document.documentElement.lang = lang === 'uk' ? 'uk' : lang === 'en' ? 'en' : 'ru';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const val = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.type !== 'button' && el.type !== 'submit') return;
    }
    el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
  const sel = document.getElementById('langSelect');
  if (sel) sel.value = lang;
}

function bindLangSelect() {
  const sel = document.getElementById('langSelect');
  if (!sel) {
    console.warn('langSelect not found');
    return;
  }
  // сброс старых обработчиков
  const fresh = sel.cloneNode(true);
  sel.parentNode.replaceChild(fresh, sel);
  fresh.value = lang;
  fresh.addEventListener('change', function () {
    lang = this.value || 'ru';
    if (!['ru', 'uk', 'en'].includes(lang)) lang = 'ru';
    localStorage.setItem(KEY_LANG, lang);
    applyI18n();
    if (typeof refreshAuthUI === 'function') {
      refreshAuthUI();
      applyI18n();
    }
  });
}

function curSym(c) {
  return { RUB: '₽', UAH: '₴', USDT: 'USDT', TON: 'TON' }[c] || c;
}
function fmt(cur, n) {
  if (cur === 'RUB' || cur === 'UAH') return Math.floor(n).toLocaleString('ru-RU');
  return Number(n).toFixed(2);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.auth === 'user' && userToken) headers.Authorization = 'Bearer ' + userToken;
  if (opts.auth === 'admin' && adminToken) headers.Authorization = 'Bearer ' + adminToken;
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error(data.error || ('Ошибка ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function syncBalance(kind, delta, meta) {
  if (!user || !userToken) return;
  try {
    const data = await api('/api/balance/sync', {
      method: 'POST',
      auth: 'user',
      body: { kind, amount: delta, meta: meta || null }
    });
    user.balance = data.balance;
    setBalUI();
  } catch (e) {
    toast(e.message || 'Ошибка синхронизации', 'err');
    // reload from server
    try {
      const me = await api('/api/me', { auth: 'user' });
      user = me.user;
      setBalUI();
    } catch (_) {}
    throw e;
  }
}

function setBalUI() {
  if (!user) return;
  $('balLabel').textContent = t('balance') + ' · ' + user.currency;
  $('balVal').textContent = fmt(user.currency, user.balance) + ' ' + curSym(user.currency);
}
function setupBets() {
  if (!user) return;
  const def = DEFAULT_BET[user.currency];
  const min = MIN_BET[user.currency];
  const step = (user.currency === 'RUB' || user.currency === 'UAH') ? 1 : 0.01;
  ['betS', 'betM', 'betCF', 'betCr', 'betTw'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.min = min;
    el.step = step;
    el.value = def;
  });
}
function setupDeposit() {
  if (!user) return;
  const c = user.currency;
  $('depCurBadge').textContent = c;
  $('depLabel').textContent = DEP_INFO[c].label;
  $('depHint').textContent = DEP_INFO[c].hint;
  $('addrVal').textContent = ADDR[c];
  $('depEmail').textContent = user.email;
}

function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 2600);
}
function showAuth(tab) {
  applyI18n();
  $('authModal').classList.add('open');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  $('formLogin').style.display = tab === 'login' ? 'block' : 'none';
  $('formReg').style.display = tab === 'reg' ? 'block' : 'none';
  $('authErr').textContent = '';
}
function hideAuth() { $('authModal').classList.remove('open'); }

function refreshAuthUI() {
  if (user) {
    $('authGuest').style.display = 'none';
    $('authUser').style.display = 'flex';
    $('userName').textContent = user.name;
    $('balBox').style.display = 'flex';
    $('btnDep').style.display = 'inline-flex';
    if ($('btnWd')) $('btnWd').style.display = 'inline-flex';
    $('gamesLock').style.display = 'none';
    $('gamesGrid').style.display = 'grid';
    $('gamesHint').textContent = (lang === 'en' ? ('Bets in ' + user.currency) : lang === 'uk' ? ('Ставки в ' + user.currency) : ('Ставки в ' + user.currency + ' · любая сумма'));
    $('depLock').style.display = 'none';
    $('depWrap').style.display = 'block';
    if ($('wdLock')) $('wdLock').style.display = 'none';
    if ($('wdWrap')) $('wdWrap').style.display = 'block';
    if ($('promoLock')) $('promoLock').style.display = 'none';
    if ($('promoWrap')) $('promoWrap').style.display = 'block';
    setBalUI();
    setupBets();
    setupDeposit();
    setupWithdraw();
    loadMyWithdrawals();
  } else {
    $('authGuest').style.display = 'flex';
    $('authUser').style.display = 'none';
    $('balBox').style.display = 'none';
    $('btnDep').style.display = 'none';
    if ($('btnWd')) $('btnWd').style.display = 'none';
    $('gamesLock').style.display = 'block';
    $('gamesGrid').style.display = 'none';
    $('gamesHint').textContent = t('games_hint_guest');
    $('depLock').style.display = 'block';
    $('depWrap').style.display = 'none';
    if ($('wdLock')) $('wdLock').style.display = 'block';
    if ($('wdWrap')) $('wdWrap').style.display = 'none';
    if ($('promoLock')) $('promoLock').style.display = 'block';
    if ($('promoWrap')) $('promoWrap').style.display = 'none';
  }
  applyI18n();
}

function goPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = $('page-' + name);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nav-a').forEach(a => a.classList.toggle('active', a.dataset.page === name));
  if (name === 'admin' && isAdmin) { renderAdmin(); renderAdminWithdrawals(); renderAdminPromos(); }
  if (name === 'withdraw' && user) { setupWithdraw(); loadMyWithdrawals(); }
  if (name === 'promo' && user) loadMyPromos();
  if (name === 'admin' && isAdmin) renderAdminPromos();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); goPage(el.dataset.page); });
});

/* AUTH */
$('btnLogin').onclick = () => showAuth('login');
$('btnReg').onclick = () => showAuth('reg');
$('heroReg').onclick = () => showAuth('reg');
$('lockReg').onclick = () => showAuth('reg');
$('lockLogin').onclick = () => showAuth('login');
$('depReg').onclick = () => showAuth('reg');
$('depLogin').onclick = () => showAuth('login');
$('authClose').onclick = hideAuth;
$('authModal').onclick = e => { if (e.target === $('authModal')) hideAuth(); };
document.querySelectorAll('.tab').forEach(t => { t.onclick = () => showAuth(t.dataset.tab); });
document.querySelectorAll('.reg-cur').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.reg-cur').forEach(c => c.classList.remove('on'));
    b.classList.add('on');
    regCur = b.dataset.cur;
  };
});

$('formLogin').onsubmit = async e => {
  e.preventDefault();
  $('authErr').textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: {
        email: $('loginEmail').value.trim(),
        password: $('loginPass').value
      }
    });
    userToken = data.token;
    localStorage.setItem(KEY_TOKEN, userToken);
    user = data.user;
    hideAuth();
    refreshAuthUI();
    toast('Добро пожаловать, ' + user.name);
    goPage('games');
  } catch (err) {
    $('authErr').textContent = err.message;
  }
};

$('formReg').onsubmit = async e => {
  e.preventDefault();
  $('authErr').textContent = '';
  const pass = $('regPass').value;
  const pass2 = $('regPass2').value;
  if (pass.length < 6) { $('authErr').textContent = 'Пароль минимум 6 символов'; return; }
  if (pass !== pass2) { $('authErr').textContent = 'Пароли не совпадают'; return; }
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: {
        name: $('regName').value.trim(),
        email: $('regEmail').value.trim(),
        password: pass,
        currency: regCur
      }
    });
    userToken = data.token;
    localStorage.setItem(KEY_TOKEN, userToken);
    user = data.user;
    hideAuth();
    refreshAuthUI();
    toast('Аккаунт создан · валюта ' + user.currency);
    goPage('deposit');
  } catch (err) {
    $('authErr').textContent = err.message;
  }
};

$('btnLogout').onclick = async () => {
  try { await api('/api/logout', { method: 'POST', auth: 'user' }); } catch (_) {}
  user = null;
  userToken = '';
  localStorage.removeItem(KEY_TOKEN);
  refreshAuthUI();
  toast('Вы вышли');
  goPage('home');
};
$('btnDep').onclick = () => goPage('deposit');
if ($('btnWd')) $('btnWd').onclick = () => goPage('withdraw');
$('btnCopy').onclick = () => {
  if (!user) return;
  navigator.clipboard.writeText(ADDR[user.currency].replace(/\s/g, ''))
    .then(() => toast('Скопировано'))
    .catch(() => toast('Ошибка', 'err'));
};

/* ADMIN */
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function renderAdmin() {
  try {
    const data = await api('/api/admin/users', { auth: 'admin' });
    $('userCount').textContent = data.count;
    const body = $('adminBody');
    body.innerHTML = '';
    if (!data.users.length) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--mu);padding:24px">Пользователей нет</td></tr>';
      return;
    }
    data.users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td><b>${u.currency}</b></td>
        <td class="bal-cell">${fmt(u.currency, u.balance)} ${curSym(u.currency)}</td>
        <td>
          <div class="admin-actions">
            <input type="number" step="1" min="1" placeholder="сумма" data-email="${escapeHtml(u.email)}">
            <button class="btn btn-or btn-sm btn-credit">+</button>
          </div>
        </td>`;
      body.appendChild(tr);
    });
    body.querySelectorAll('.btn-credit').forEach(btn => {
      btn.onclick = async () => {
        const input = btn.parentElement.querySelector('input');
        const email = input.dataset.email;
        const amt = parseFloat(input.value);
        if (!amt || amt <= 0) { toast('Введите сумму', 'err'); return; }
        try {
          const res = await api('/api/admin/credit', {
            method: 'POST', auth: 'admin',
            body: { email, amount: amt }
          });
          toast('+' + amt + ' ' + res.currency + ' → ' + email);
          if (user && user.email === email) {
            user.balance = res.balance;
            setBalUI();
          }
          renderAdmin();
        } catch (e) {
          toast(e.message, 'err');
        }
      };
    });
  } catch (e) {
    toast(e.message, 'err');
    isAdmin = false;
    adminToken = '';
    localStorage.removeItem(KEY_ADMIN_TOKEN);
    $('adminGate').style.display = 'block';
    $('adminPanel').style.display = 'none';
  }
}

$('adminEnter').onclick = async () => {
  $('adminErr').textContent = '';
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: { password: $('adminPass').value }
    });
    adminToken = data.token;
    localStorage.setItem(KEY_ADMIN_TOKEN, adminToken);
    isAdmin = true;
    $('adminGate').style.display = 'none';
    $('adminPanel').style.display = 'block';
    renderAdmin();
    toast('Админ-режим');
  } catch (e) {
    $('adminErr').textContent = e.message;
  }
};
$('adminPass').onkeydown = e => { if (e.key === 'Enter') $('adminEnter').click(); };
$('adminRefresh').onclick = () => renderAdmin();
$('adminExit').onclick = async () => {
  try { await api('/api/admin/logout', { method: 'POST', auth: 'admin' }); } catch (_) {}
  isAdmin = false;
  adminToken = '';
  localStorage.removeItem(KEY_ADMIN_TOKEN);
  $('adminGate').style.display = 'block';
  $('adminPanel').style.display = 'none';
  $('adminPass').value = '';
  toast('Вышли из админки');
};
$('quickAdd').onclick = async () => {
  const email = $('quickEmail').value.trim().toLowerCase();
  const amt = parseFloat($('quickAmt').value);
  if (!email) { toast('Укажите email', 'err'); return; }
  if (!amt || amt <= 0) { toast('Укажите сумму', 'err'); return; }
  try {
    const res = await api('/api/admin/credit', {
      method: 'POST', auth: 'admin',
      body: { email, amount: amt }
    });
    toast('+' + amt + ' ' + res.currency + ' → ' + email);
    if (user && user.email === email) {
      user.balance = res.balance;
      setBalUI();
    }
    $('quickAmt').value = '';
    renderAdmin();
  } catch (e) {
    toast(e.message, 'err');
  }
};

function getBet(inputId) {
  const raw = parseFloat($(inputId).value);
  if (isNaN(raw) || raw <= 0) { toast('Введите сумму ставки', 'err'); return null; }
  const min = MIN_BET[user.currency];
  if (raw < min) {
    toast('Минимум ' + fmt(user.currency, min) + ' ' + curSym(user.currency), 'err');
    return null;
  }
  return raw;
}
function needFunds(bet) {
  if (!user) { toast('Войдите в аккаунт', 'err'); return true; }
  if (user.balance < bet) {
    toast('Недостаточно средств', 'err');
    return true;
  }
  return false;
}

/* SLOTS */
$('spin').onclick = async () => {
  const bet = getBet('betS');
  if (bet === null || needFunds(bet)) return;
  $('spin').disabled = true;
  try {
    await syncBalance('bet_slots', -bet);
  } catch (_) { $('spin').disabled = false; return; }

  $('resS').textContent = ''; $('resS').className = 'g-res';
  const reels = [$('r1'), $('r2'), $('r3')];
  reels.forEach(r => r.classList.add('spin'));
  let n = 0;
  const iv = setInterval(async () => {
    reels.forEach(r => r.textContent = SYM[Math.floor(Math.random() * SYM.length)]);
    if (++n > 15) {
      clearInterval(iv);
      reels.forEach(r => r.classList.remove('spin'));
      let s = [0,1,2].map(() => SYM[Math.floor(Math.random() * SYM.length)]);
      if (rollWin()) {
        // гарантируем хотя бы пару
        if (!(s[0] === s[1] || s[1] === s[2] || s[0] === s[2])) {
          s[1] = s[0];
        }
      } else {
        // без совпадений
        s[1] = SYM[(SYM.indexOf(s[0]) + 1) % SYM.length];
        s[2] = SYM[(SYM.indexOf(s[0]) + 2) % SYM.length];
      }
      reels.forEach((r, i) => r.textContent = s[i]);
      let win = 0;
      if (s[0] === s[1] && s[1] === s[2]) {
        win = s[0] === '7️⃣' ? bet * 50 : s[0] === '💎' ? bet * 25 : s[0] === '⭐' ? bet * 15 : bet * 8;
      } else if (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) win = bet * 1.5;
      if (win > 0) {
        try { await syncBalance('win_slots', win); } catch (_) {}
        $('resS').textContent = 'Выигрыш +' + fmt(user.currency, win) + ' ' + curSym(user.currency);
        $('resS').className = 'g-res win';
      } else {
        $('resS').textContent = 'Проигрыш';
        $('resS').className = 'g-res lose';
      }
      $('spin').disabled = false;
    }
  }, 65);
};


function winChance() {
  const p = ratesCache && ratesCache.win_chance_percent;
  const n = Number(p);
  if (!n || n < 1) return 0.48;
  return Math.max(0.01, Math.min(1, n / 100));
}
function rollWin() {
  return Math.random() < winChance();
}

/* COINFLIP */
let cfSide = 'heads';
document.querySelectorAll('[data-cf]').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('[data-cf]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    cfSide = b.dataset.cf;
  };
});
if ($('cfPlay')) $('cfPlay').onclick = async () => {
  const bet = getBet('betCF');
  if (bet === null || needFunds(bet)) return;
  $('cfPlay').disabled = true;
  try { await syncBalance('bet_coinflip', -bet); }
  catch (_) { $('cfPlay').disabled = false; return; }

  $('resCF').textContent = ''; $('resCF').className = 'g-res';
  const coin = $('cfCoin');
  coin.classList.add('flip');
  let n = 0;
  const iv = setInterval(() => {
    coin.textContent = n % 2 ? '👑' : '🦅';
    n++;
    if (n > 12) {
      clearInterval(iv);
      coin.classList.remove('flip');
      const result = rollWin() ? cfSide : (cfSide === 'heads' ? 'tails' : 'heads');
      coin.textContent = result === 'heads' ? '🦅' : '👑';
      if (result === cfSide) {
        const win = bet * 2;
        syncBalance('win_coinflip', win).catch(() => {});
        $('resCF').textContent = (result === 'heads' ? 'Орёл' : 'Решка') + '! +' + fmt(user.currency, win) + ' ' + curSym(user.currency);
        $('resCF').className = 'g-res win';
      } else {
        $('resCF').textContent = (result === 'heads' ? 'Орёл' : 'Решка') + ' — проигрыш';
        $('resCF').className = 'g-res lose';
      }
      $('cfPlay').disabled = false;
    }
  }, 80);
};

/* CRASH — самолётик + автоставка / автовывод */
let crashActive = false;
let crashMult = 1;
let crashBet = 0;
let crashTimer = null;
let crashPoint = 0;
let crashTrail = [];
let crashHistory = [];
let crashBusy = false;
let crashAutoTimer = null;

function pushCrashHistory(mult) {
  crashHistory.unshift(mult);
  if (crashHistory.length > 12) crashHistory.pop();
  const box = $('crashHistory');
  if (!box) return;
  box.innerHTML = crashHistory.map(m => {
    let cls = 'low';
    if (m >= 10) cls = 'mega';
    else if (m >= 3) cls = 'high';
    else if (m >= 1.5) cls = 'mid';
    return '<span class="crash-h-chip ' + cls + '">' + m.toFixed(2) + 'x</span>';
  }).join('');
}

function crashRandomPoint() {
  const wc = winChance();
  if (Math.random() < (0.12 * (1 - wc))) return 1.0;
  const edge = Math.max(0.5, Math.min(0.99, 0.5 + wc * 0.48));
  const p = Math.max(1.01, edge / (1 - Math.random() * edge));
  return Math.min(p, 100);
}

function crashCanvasSize() {
  const canvas = $('crashCanvas');
  const sky = canvas && canvas.parentElement;
  if (!canvas || !sky) return { w: 400, h: 240 };
  const w = sky.clientWidth || 400;
  const h = sky.clientHeight || 240;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h };
}

function crashDrawTrail() {
  const canvas = $('crashCanvas');
  if (!canvas) return;
  const { w, h } = crashCanvasSize();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (crashTrail.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(168,85,247,.9)';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  crashTrail.forEach((p, i) => {
    const x = (p.x / 100) * w;
    const y = (1 - p.y / 100) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(192,132,252,.3)';
  ctx.lineWidth = 6;
  crashTrail.forEach((p, i) => {
    const x = (p.x / 100) * w;
    const y = (1 - p.y / 100) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function crashSetPlane(progress) {
  const plane = $('crashPlane');
  if (!plane) return;
  const p = Math.max(0, Math.min(1, progress));
  const x = 8 + p * 82;
  const y = 10 + Math.pow(p, 1.35) * 72;
  const rot = -18 + p * 12;
  plane.style.left = x + '%';
  plane.style.bottom = y + '%';
  plane.style.transform = 'translate(-50%,50%) rotate(' + rot + 'deg)';
  crashTrail.push({ x, y });
  if (crashTrail.length > 100) crashTrail.shift();
  crashDrawTrail();
}

function crashResetVisual() {
  crashTrail = [];
  const plane = $('crashPlane');
  if (plane) {
    plane.classList.remove('flying', 'crashed');
    plane.style.left = '8%';
    plane.style.bottom = '12%';
    plane.style.transform = 'translate(-50%,50%) rotate(-25deg)';
    plane.style.opacity = '1';
  }
  if ($('crashMult')) {
    $('crashMult').textContent = '1.00×';
    $('crashMult').classList.remove('crashed');
  }
  if ($('crashStatus')) {
    $('crashStatus').textContent = 'Ожидание';
    $('crashStatus').className = 'crash-status';
  }
  crashDrawTrail();
}

function crashExplodeVisual() {
  const plane = $('crashPlane');
  if (plane) {
    plane.classList.remove('flying');
    plane.classList.add('crashed');
  }
  if ($('crashStatus')) {
    $('crashStatus').textContent = 'Crash';
    $('crashStatus').className = 'crash-status dead';
  }
}

function crashSetWaiting(on) {
  const btn = $('crashStart');
  if (!btn) return;
  if (on) {
    btn.textContent = 'ОЖИДАНИЕ';
    btn.classList.add('waiting');
    btn.disabled = true;
  } else {
    btn.textContent = 'СТАВКА';
    btn.classList.remove('waiting');
    btn.disabled = false;
  }
}

function getAutoCashMult() {
  const v = parseFloat(($('crashAutoMult') && $('crashAutoMult').value) || '1.5');
  if (isNaN(v) || v < 1.01) return 1.01;
  return v;
}

async function doCrashCashout(auto) {
  if (!crashActive) return;
  crashActive = false;
  if (crashTimer) clearInterval(crashTimer);
  crashTimer = null;
  const win = crashBet * crashMult;
  const multSnap = crashMult;
  if ($('crashCash')) $('crashCash').disabled = true;
  if ($('crashPlane')) $('crashPlane').classList.remove('flying');
  if ($('crashStatus')) {
    $('crashStatus').textContent = auto ? 'Авто вывод' : 'Забрано';
    $('crashStatus').className = 'crash-status live';
  }
  try { await syncBalance('win_crash', win); } catch (_) {}
  pushCrashHistory(multSnap);
  if ($('resCr')) {
    $('resCr').textContent = (auto ? 'Авто @ ' : 'Забрано @ ') + multSnap.toFixed(2) + '× +' + fmt(user.currency, win) + ' ' + curSym(user.currency);
    $('resCr').className = 'g-res win';
  }
  crashBusy = false;
  crashSetWaiting(false);
  scheduleAutoBet();
}

function scheduleAutoBet() {
  if (crashAutoTimer) clearTimeout(crashAutoTimer);
  const auto = $('crashAutoBet') && $('crashAutoBet').checked;
  if (!auto) return;
  crashAutoTimer = setTimeout(() => {
    if ($('crashAutoBet') && $('crashAutoBet').checked && !crashActive && !crashBusy) {
      startCrashRound();
    }
  }, 900);
}

async function startCrashRound() {
  if (crashActive || crashBusy) return;
  if (!user) { toast(t('need_auth'), 'err'); return; }
  const bet = getBet('betCr');
  if (bet === null || needFunds(bet)) return;

  crashBusy = true;
  crashSetWaiting(true);
  try {
    await syncBalance('bet_crash', -bet);
  } catch (_) {
    crashBusy = false;
    crashSetWaiting(false);
    return;
  }

  crashBet = bet;
  crashActive = true;
  crashMult = 1;
  crashPoint = crashRandomPoint();
  crashResetVisual();
  if ($('crashPlane')) $('crashPlane').classList.add('flying');
  if ($('crashStatus')) {
    $('crashStatus').textContent = 'В полёте';
    $('crashStatus').className = 'crash-status live';
  }
  if ($('resCr')) { $('resCr').textContent = ''; $('resCr').className = 'g-res'; }
  if ($('crashCash')) $('crashCash').disabled = false;

  const autoOutOn = () => $('crashAutoOut') && $('crashAutoOut').checked;
  const start = Date.now();
  if (crashTimer) clearInterval(crashTimer);
  crashTimer = setInterval(() => {
    if (!crashActive) return;
    const t = (Date.now() - start) / 1000;
    crashMult = Math.pow(Math.E, 0.12 * t);

    // авто вывод
    if (autoOutOn() && crashMult >= getAutoCashMult()) {
      crashMult = Math.min(crashMult, getAutoCashMult());
      doCrashCashout(true);
      return;
    }

    if (crashMult >= crashPoint) {
      crashMult = crashPoint;
      crashActive = false;
      clearInterval(crashTimer);
      crashTimer = null;
      if ($('crashMult')) {
        $('crashMult').textContent = crashMult.toFixed(2) + '×';
        $('crashMult').classList.add('crashed');
      }
      crashSetPlane(Math.min(0.95, Math.log(crashMult) / 4));
      crashExplodeVisual();
      if ($('crashCash')) $('crashCash').disabled = true;
      pushCrashHistory(crashMult);
      if ($('resCr')) {
        $('resCr').textContent = 'Crash @ ' + crashMult.toFixed(2) + '×';
        $('resCr').className = 'g-res lose';
      }
      crashBusy = false;
      crashSetWaiting(false);
      scheduleAutoBet();
      return;
    }
    if ($('crashMult')) $('crashMult').textContent = crashMult.toFixed(2) + '×';
    crashSetPlane(Math.min(0.92, Math.log(crashMult) / 4));
  }, 50);
}

if ($('crashMinus')) $('crashMinus').onclick = () => {
  const el = $('betCr');
  if (!el) return;
  const step = user && (user.currency === 'RUB' || user.currency === 'UAH') ? 10 : 1;
  el.value = Math.max(parseFloat(el.min) || 1, (parseFloat(el.value) || 0) - step);
};
if ($('crashPlus')) $('crashPlus').onclick = () => {
  const el = $('betCr');
  if (!el) return;
  const step = user && (user.currency === 'RUB' || user.currency === 'UAH') ? 10 : 1;
  el.value = (parseFloat(el.value) || 0) + step;
};
document.querySelectorAll('.crash-q').forEach(b => {
  b.onclick = () => {
    const el = $('betCr');
    if (!el) return;
    if (b.dataset.set) el.value = b.dataset.set;
    else if (b.dataset.add) el.value = (parseFloat(el.value) || 0) + parseFloat(b.dataset.add);
  };
});

if ($('crashStart')) $('crashStart').onclick = () => startCrashRound();
if ($('crashCash')) $('crashCash').onclick = () => doCrashCashout(false);


/* TOWERS */
const TOWER_LEVELS = 8;
const TOWER_CFG = {
  easy:   { cols: 3, safe: 2 },
  medium: { cols: 3, safe: 1 },
  hard:   { cols: 4, safe: 1 }
};
let towerActive = false;
let towerBet = 0;
let towerLevel = 0;
let towerSafe = []; // per level: set of safe indices
let towerDiff = 'medium';

function towerMultiplier(level, diff) {
  if (level <= 0) return 1;
  const cfg = TOWER_CFG[diff];
  const p = cfg.cols / cfg.safe;
  let m = 1;
  for (let i = 0; i < level; i++) m *= p * 0.97;
  return m;
}

function buildTowerGrid(enableLevel) {
  const grid = $('towerGrid');
  if (!grid) return;
  const cfg = TOWER_CFG[towerDiff] || TOWER_CFG.medium;
  grid.innerHTML = '';
  for (let lvl = 0; lvl < TOWER_LEVELS; lvl++) {
    const row = document.createElement('div');
    row.className = 'tower-row cols-' + cfg.cols + (lvl === enableLevel ? ' active' : '');
    row.dataset.lvl = lvl;
    for (let c = 0; c < cfg.cols; c++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'tower-cell' + (towerActive && lvl === enableLevel ? '' : ' disabled');
      cell.dataset.lvl = lvl;
      cell.dataset.col = c;
      if (!towerActive || lvl !== enableLevel) cell.disabled = true;
      cell.onclick = () => onTowerClick(lvl, c);
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}

function resetTowerUI() {
  towerActive = false;
  towerLevel = 0;
  towerSafe = [];
  if ($('towerLvl')) $('towerLvl').textContent = '0';
  if ($('towerMult')) $('towerMult').textContent = '1.00×';
  if ($('towerCash')) $('towerCash').disabled = true;
  if ($('towerStart')) $('towerStart').disabled = false;
  if ($('towerDiff')) $('towerDiff').disabled = false;
  if ($('betTw')) $('betTw').disabled = false;
  buildTowerGrid(-1);
}

function onTowerClick(lvl, col) {
  if (!towerActive || lvl !== towerLevel) return;
  const cfg = TOWER_CFG[towerDiff];
  let isSafe = towerSafe[lvl] && towerSafe[lvl].has(col);
  if (!isSafe && rollWin()) {
    // спасаем: делаем клетку безопасной
    isSafe = true;
    if (towerSafe[lvl]) towerSafe[lvl].add(col);
  } else if (isSafe && !rollWin()) {
    isSafe = false;
    if (towerSafe[lvl]) towerSafe[lvl].delete(col);
  }
  const row = $('towerGrid').querySelector(`.tower-row[data-lvl="${lvl}"]`);
  if (!row) return;

  if (!isSafe) {
    // bomb
    towerActive = false;
    row.querySelectorAll('.tower-cell').forEach(cell => {
      const c = parseInt(cell.dataset.col, 10);
      cell.disabled = true;
      if (towerSafe[lvl].has(c)) {
        cell.classList.add('open', 'safe');
        cell.textContent = '💎';
      } else {
        cell.classList.add('open', 'bomb');
        cell.textContent = '💀';
      }
    });
    $('resTw').textContent = 'Ловушка! Проигрыш';
    $('resTw').className = 'g-res lose';
    $('towerCash').disabled = true;
    $('towerStart').disabled = false;
    $('towerDiff').disabled = false;
    $('betTw').disabled = false;
    return;
  }

  // safe
  row.querySelectorAll('.tower-cell').forEach(cell => {
    const c = parseInt(cell.dataset.col, 10);
    cell.disabled = true;
    if (c === col) {
      cell.classList.add('open', 'safe');
      cell.textContent = '💎';
    } else {
      cell.classList.add('disabled');
    }
  });
  row.classList.remove('active');
  towerLevel += 1;
  const mult = towerMultiplier(towerLevel, towerDiff);
  $('towerLvl').textContent = String(towerLevel);
  $('towerMult').textContent = mult.toFixed(2) + '×';
  $('towerCash').disabled = false;

  if (towerLevel >= TOWER_LEVELS) {
    cashTower(true);
    return;
  }
  // enable next row
  const next = $('towerGrid').querySelector(`.tower-row[data-lvl="${towerLevel}"]`);
  if (next) {
    next.classList.add('active');
    next.querySelectorAll('.tower-cell').forEach(cell => {
      cell.disabled = false;
      cell.classList.remove('disabled');
    });
  }
}

async function cashTower(auto) {
  if (!towerActive && !auto) return;
  if (towerLevel <= 0 && !auto) return;
  const was = towerActive;
  towerActive = false;
  if (!was && !auto) return;
  const mult = towerMultiplier(towerLevel, towerDiff);
  const win = towerBet * mult;
  try { await syncBalance('win_towers', win); } catch (_) {}
  $('resTw').textContent = (auto ? 'Вершина! ' : '') + 'Забрано +' + fmt(user.currency, win) + ' ' + curSym(user.currency) + ' (' + mult.toFixed(2) + '×)';
  $('resTw').className = 'g-res win';
  $('towerCash').disabled = true;
  $('towerStart').disabled = false;
  $('towerDiff').disabled = false;
  $('betTw').disabled = false;
  // lock cells
  $('towerGrid').querySelectorAll('.tower-cell').forEach(c => { c.disabled = true; c.classList.add('disabled'); });
}

if ($('towerStart')) $('towerStart').onclick = async () => {
  if (!user) { toast('Войдите в аккаунт', 'err'); return; }
  const bet = getBet('betTw');
  if (bet === null || needFunds(bet)) return;
  towerDiff = ($('towerDiff') && $('towerDiff').value) || 'medium';
  $('towerStart').disabled = true;
  try { await syncBalance('bet_towers', -bet); }
  catch (_) { $('towerStart').disabled = false; return; }

  towerBet = bet;
  towerActive = true;
  towerLevel = 0;
  const cfg = TOWER_CFG[towerDiff];
  towerSafe = [];
  for (let lvl = 0; lvl < TOWER_LEVELS; lvl++) {
    const idxs = [...Array(cfg.cols).keys()];
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    towerSafe.push(new Set(idxs.slice(0, cfg.safe)));
  }
  $('resTw').textContent = '';
  $('resTw').className = 'g-res';
  $('towerLvl').textContent = '0';
  $('towerMult').textContent = '1.00×';
  $('towerCash').disabled = true;
  $('towerDiff').disabled = true;
  $('betTw').disabled = true;
  buildTowerGrid(0);
};

if ($('towerCash')) $('towerCash').onclick = () => cashTower(false);


/* MINES */
const MINES_SIZE = 25;
let minesActive = false;
let minesBombs = new Set();
let minesOpened = new Set();
let minesBet = 0;
let minesN = 5;

function minesMultiplier(opened, bombs) {
  if (opened <= 0) return 1;
  let mult = 1;
  const total = MINES_SIZE;
  for (let i = 0; i < opened; i++) {
    const safeLeft = total - bombs - i;
    const cellsLeft = total - i;
    if (safeLeft <= 0 || cellsLeft <= 0) break;
    mult *= (cellsLeft / safeLeft);
  }
  return Math.max(1, mult * 0.97);
}

function buildMinesGrid() {
  const grid = $('minesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < MINES_SIZE; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'mine-cell';
    cell.dataset.i = i;
    cell.textContent = '';
    cell.onclick = () => onMineClick(i);
    grid.appendChild(cell);
  }
}

async function startMines() {
  if (!user) { toast('Войдите в аккаунт', 'err'); return; }
  const bet = getBet('betM');
  if (bet === null || needFunds(bet)) return;
  minesN = parseInt($('minesCount').value, 10) || 5;
  if (minesN < 1 || minesN >= MINES_SIZE) {
    toast('Некорректное число мин', 'err');
    return;
  }
  $('minesStart').disabled = true;
  try {
    await syncBalance('bet_mines', -bet);
  } catch (_) { $('minesStart').disabled = false; return; }

  minesBet = bet;
  minesActive = true;
  minesOpened = new Set();
  minesBombs = new Set();
  const idxs = [...Array(MINES_SIZE).keys()];
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  for (let k = 0; k < minesN; k++) minesBombs.add(idxs[k]);

  buildMinesGrid();
  $('resM').textContent = '';
  $('resM').className = 'g-res';
  $('minesMult').textContent = '1.00×';
  $('minesWin').textContent = '0';
  $('minesCash').disabled = true;
  $('minesCount').disabled = true;
  $('betM').disabled = true;
}

async function onMineClick(i) {
  if (!minesActive || minesOpened.has(i)) return;
  const cell = $('minesGrid').querySelector(`[data-i="${i}"]`);
  if (!cell) return;

  let isBomb = minesBombs.has(i);
  if (isBomb && rollWin()) {
    const closed = [];
    for (let k = 0; k < MINES_SIZE; k++) {
      if (!minesOpened.has(k) && k !== i && !minesBombs.has(k)) closed.push(k);
    }
    if (closed.length) {
      minesBombs.delete(i);
      minesBombs.add(closed[Math.floor(Math.random() * closed.length)]);
      isBomb = false;
    }
  } else if (!isBomb && !rollWin() && minesOpened.size === 0) {
    isBomb = true;
    minesBombs.add(i);
  }
  if (isBomb) {
    minesActive = false;
    cell.classList.add('open', 'bomb');
    cell.textContent = '💣';
    $('minesGrid').querySelectorAll('.mine-cell').forEach((c) => {
      const ii = parseInt(c.dataset.i, 10);
      c.disabled = true;
      if (minesBombs.has(ii) && ii !== i) {
        c.classList.add('open', 'bomb');
        c.textContent = '💣';
      } else if (minesOpened.has(ii)) {
        c.classList.add('open', 'safe');
        c.textContent = '💎';
      } else if (!minesBombs.has(ii)) {
        c.classList.add('reveal-safe');
      }
    });
    $('resM').textContent = 'Мина! Проигрыш';
    $('resM').className = 'g-res lose';
    $('minesCash').disabled = true;
    $('minesStart').disabled = false;
    $('minesCount').disabled = false;
    $('betM').disabled = false;
    return;
  }

  minesOpened.add(i);
  cell.classList.add('open', 'safe');
  cell.textContent = '💎';
  cell.disabled = true;

  const mult = minesMultiplier(minesOpened.size, minesN);
  const win = minesBet * mult;
  $('minesMult').textContent = mult.toFixed(2) + '×';
  $('minesWin').textContent = fmt(user.currency, win) + ' ' + curSym(user.currency);
  $('minesCash').disabled = false;

  const safeTotal = MINES_SIZE - minesN;
  if (minesOpened.size >= safeTotal) {
    await cashMines(true);
  }
}

async function cashMines(auto) {
  if (!minesActive) return;
  const mult = minesMultiplier(minesOpened.size, minesN);
  const win = minesBet * mult;
  minesActive = false;
  try {
    await syncBalance('win_mines', win);
  } catch (_) {}
  $('minesGrid').querySelectorAll('.mine-cell').forEach((c) => {
    const ii = parseInt(c.dataset.i, 10);
    c.disabled = true;
    if (minesBombs.has(ii) && !minesOpened.has(ii)) {
      c.classList.add('reveal-bomb');
      c.textContent = '💣';
    }
  });
  $('resM').textContent = (auto ? 'Все клетки! ' : '') + 'Забрано +' + fmt(user.currency, win) + ' ' + curSym(user.currency);
  $('resM').className = 'g-res win';
  $('minesCash').disabled = true;
  $('minesStart').disabled = false;
  $('minesCount').disabled = false;
  $('betM').disabled = false;
}

if ($('minesStart')) $('minesStart').onclick = startMines;
if ($('minesCash')) $('minesCash').onclick = () => cashMines(false);


/* WITHDRAW */
let ratesCache = null;

async function loadRates() {
  try {
    ratesCache = await api('/api/rates');
  } catch (_) {
    ratesCache = {
      min_withdraw: { TON: 1, USDT: 5, RUB: 500, UAH: 200 },
      win_chance_percent: 48,
      deposit_details: ADDR,
      deposit_hints: {
        RUB: DEP_INFO.RUB.hint,
        UAH: DEP_INFO.UAH.hint,
        USDT: DEP_INFO.USDT.hint,
        TON: DEP_INFO.TON.hint
      }
    };
  }
  if (ratesCache.deposit_details) {
    ADDR = { ...ADDR, ...ratesCache.deposit_details };
  }
  if (ratesCache.deposit_hints) {
    Object.keys(ratesCache.deposit_hints).forEach(c => {
      if (!DEP_INFO[c]) DEP_INFO[c] = { label: c, hint: '' };
      DEP_INFO[c].hint = ratesCache.deposit_hints[c];
      if (c === 'RUB') DEP_INFO[c].label = 'Карта RUB';
      else if (c === 'UAH') DEP_INFO[c].label = 'Карта UAH';
      else if (c === 'USDT') DEP_INFO[c].label = 'Адрес USDT (TRC-20)';
      else if (c === 'TON') DEP_INFO[c].label = 'Адрес TON';
    });
  }
  applySupportLink(ratesCache.support_username);
  return ratesCache;
}

function applySupportLink(username) {
  const u = String(username || 'username').replace(/^@/, '').trim() || 'username';
  const link = $('supportLink');
  const label = $('supportUser');
  if (link) link.href = 'https://t.me/' + u;
  if (label) label.textContent = '@' + u;
}

async function setupWithdraw() {
  if (!user) return;
  const rates = await loadRates();
  const cur = user.currency;
  const min = (rates.min_withdraw && rates.min_withdraw[cur]) || 1;
  $('wdCur').textContent = cur;
  $('wdMin').textContent = fmt(cur, min) + ' ' + curSym(cur);
  const step = (cur === 'RUB' || cur === 'UAH') ? 1 : 0.01;
  $('wdAmount').min = min;
  $('wdAmount').step = step;
  if (!$('wdAmount').value) $('wdAmount').value = min;

  const box = $('wdRates');
  if (box) {
    box.innerHTML = Object.entries(rates.min_withdraw || {}).map(([c, m]) =>
      `<div class="wd-rate-chip">Мин. ${c}: <b>${m}</b></div>`
    ).join('');
  }
  if ($('wdTonHint')) $('wdTonHint').textContent = '';
}

function updateWdTonHint() {
  // курсы убраны — подсказка не нужна
}

if ($('wdAmount')) {
  $('wdAmount').addEventListener('input', updateWdTonHint);
}

if ($('wdSubmit')) {
  $('wdSubmit').onclick = async () => {
    if (!user) { toast('Войдите в аккаунт', 'err'); return; }
    const amount = parseFloat($('wdAmount').value);
    const details = ($('wdDetails').value || '').trim();
    if (!amount || amount <= 0) { toast('Введите сумму', 'err'); return; }
    if (details.length < 5) { toast('Укажите реквизиты', 'err'); return; }
    $('wdSubmit').disabled = true;
    try {
      const res = await api('/api/withdraw', {
        method: 'POST', auth: 'user',
        body: { amount, details }
      });
      user.balance = res.balance;
      setBalUI();
      toast(res.tg_sent ? 'Заявка отправлена в Telegram' : 'Заявка создана (TG не настроен)');
      $('wdDetails').value = '';
      loadMyWithdrawals();
    } catch (e) {
      toast(e.message, 'err');
    }
    $('wdSubmit').disabled = false;
  };
}

async function loadMyWithdrawals() {
  if (!user || !$('wdList')) return;
  try {
    const data = await api('/api/withdraw/my', { auth: 'user' });
    const body = $('wdList');
    if (!data.items.length) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--mu);padding:16px">Заявок пока нет</td></tr>';
      return;
    }
    const st = { pending: 'Ожидает', approved: 'Выплачено', rejected: 'Отклонено' };
    body.innerHTML = data.items.map(w => `
      <tr>
        <td>${w.id}</td>
        <td>${fmt(w.currency, w.amount)} ${curSym(w.currency)}</td>
        <td>—</td>
        <td class="status-${w.status}">${st[w.status] || w.status}</td>
        <td>${(w.created_at || '').replace('T', ' ').slice(0, 16)}</td>
      </tr>
    `).join('');
  } catch (_) {}
}

async function renderAdminWithdrawals() {
  if (!$('wdAdminList')) return;
  try {
    const data = await api('/api/admin/withdrawals?status=all', { auth: 'admin' });
    const body = $('wdAdminList');
    if (!data.items.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--mu);padding:16px">Нет заявок</td></tr>';
      return;
    }
    const st = { pending: 'Ожидает', approved: 'Выплачено', rejected: 'Отклонено' };
    body.innerHTML = data.items.map(w => `
      <tr>
        <td>${w.id}</td>
        <td>${escapeHtml(w.name)}<br><small style="color:var(--mu)">${escapeHtml(w.email)}</small></td>
        <td class="bal-cell">${fmt(w.currency, w.amount)} ${w.currency}</td>
        <td><code style="font-size:.75rem">${escapeHtml(w.details)}</code></td>
        <td class="status-${w.status}">${st[w.status] || w.status}</td>
        <td>${w.status === 'pending' ? `
          <button class="btn btn-or btn-sm" data-ok="${w.id}">✓</button>
          <button class="btn btn-ghost btn-sm" data-no="${w.id}">✕</button>
        ` : '—'}</td>
      </tr>
    `).join('');
    body.querySelectorAll('[data-ok]').forEach(b => {
      b.onclick = async () => {
        try {
          await api('/api/admin/withdrawals/' + b.dataset.ok + '/resolve', {
            method: 'POST', auth: 'admin', body: { approve: true }
          });
          toast('Вывод подтверждён');
          renderAdminWithdrawals();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
    body.querySelectorAll('[data-no]').forEach(b => {
      b.onclick = async () => {
        try {
          await api('/api/admin/withdrawals/' + b.dataset.no + '/resolve', {
            method: 'POST', auth: 'admin', body: { approve: false }
          });
          toast('Вывод отклонён, средства возвращены');
          renderAdminWithdrawals();
          // refresh me if needed
          if (userToken) {
            try {
              const me = await api('/api/me', { auth: 'user' });
              user = me.user; setBalUI();
            } catch (_) {}
          }
        } catch (e) { toast(e.message, 'err'); }
      };
    });
  } catch (e) {
    console.warn(e);
  }
}

if ($('wdAdminRefresh')) $('wdAdminRefresh').onclick = () => renderAdminWithdrawals();



/* PROMO */
async function loadMyPromos() {
  if (!user || !$('promoList')) return;
  try {
    const data = await api('/api/promo/my', { auth: 'user' });
    const body = $('promoList');
    if (!data.items.length) {
      body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--mu);padding:16px">—</td></tr>';
      return;
    }
    body.innerHTML = data.items.map(p => `
      <tr>
        <td><b>${escapeHtml(p.code)}</b></td>
        <td class="bal-cell">+${fmt(p.currency, p.amount)} ${curSym(p.currency)}</td>
        <td>${(p.created_at || '').replace('T',' ').slice(0,16)}</td>
      </tr>`).join('');
  } catch (_) {}
}

if ($('promoApply')) $('promoApply').onclick = async () => {
  if (!user) { toast(t('need_auth'), 'err'); return; }
  const code = ($('promoCode').value || '').trim();
  if (!code) { toast(t('promo_ph'), 'err'); return; }
  $('promoApply').disabled = true;
  try {
    const res = await api('/api/promo/redeem', { method: 'POST', auth: 'user', body: { code } });
    user.balance = res.balance;
    setBalUI();
    toast(t('toast_promo_ok') + ': +' + fmt(res.currency, res.amount) + ' ' + curSym(res.currency));
    $('promoCode').value = '';
    loadMyPromos();
  } catch (e) {
    toast(e.message, 'err');
  }
  $('promoApply').disabled = false;
};

async function renderAdminPromos() {
  if (!$('promoAdminList')) return;
  try {
    const data = await api('/api/admin/promos', { auth: 'admin' });
    const body = $('promoAdminList');
    if (!data.items.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--mu);padding:16px">Нет промокодов</td></tr>';
      return;
    }
    body.innerHTML = data.items.map(p => `
      <tr>
        <td><b>${escapeHtml(p.code)}</b></td>
        <td class="bal-cell">${p.amount}</td>
        <td>${p.currency || 'игрок'}</td>
        <td>${p.used_count}/${p.max_uses}</td>
        <td class="${p.active ? 'status-approved' : 'status-rejected'}">${p.active ? 'ON' : 'OFF'}</td>
        <td><button class="btn btn-ghost btn-sm" data-ptoggle="${p.id}">${p.active ? 'Выкл' : 'Вкл'}</button></td>
      </tr>`).join('');
    body.querySelectorAll('[data-ptoggle]').forEach(b => {
      b.onclick = async () => {
        try {
          await api('/api/admin/promos/' + b.dataset.ptoggle + '/toggle', { method: 'POST', auth: 'admin', body: {} });
          renderAdminPromos();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
  } catch (e) { console.warn(e); }
}

if ($('promoAdminCreate')) $('promoAdminCreate').onclick = async () => {
  const code = ($('promoAdminCode').value || '').trim();
  const amount = parseFloat($('promoAdminAmount').value);
  const currency = $('promoAdminCur').value;
  const max_uses = parseInt($('promoAdminUses').value || '100', 10);
  if (!code || !amount) { toast('Код и сумма', 'err'); return; }
  try {
    await api('/api/admin/promos', {
      method: 'POST', auth: 'admin',
      body: { code, amount, currency, max_uses }
    });
    toast('Промокод создан: ' + code.toUpperCase());
    $('promoAdminCode').value = '';
    $('promoAdminAmount').value = '';
    renderAdminPromos();
  } catch (e) { toast(e.message, 'err'); }
};


/* INIT */
async function init() {
  if (userToken) {
    try {
      const me = await api('/api/me', { auth: 'user' });
      user = me.user;
    } catch (_) {
      userToken = '';
      localStorage.removeItem(KEY_TOKEN);
      user = null;
    }
  }
  if (adminToken) {
    try {
      await api('/api/admin/users', { auth: 'admin' });
      isAdmin = true;
      $('adminGate').style.display = 'none';
      $('adminPanel').style.display = 'block';
    } catch (_) {
      adminToken = '';
      localStorage.removeItem(KEY_ADMIN_TOKEN);
      isAdmin = false;
    }
  }
  bindLangSelect();
  applyI18n();
  refreshAuthUI();
  applyI18n();
  buildMinesGrid();
  if (typeof resetTowerUI === "function") resetTowerUI();
  if (typeof crashResetVisual === "function") crashResetVisual();
  loadRates();
}
// на случай если DOM уже готов
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { bindLangSelect(); applyI18n(); });
} else {
  bindLangSelect();
  applyI18n();
}
init();
