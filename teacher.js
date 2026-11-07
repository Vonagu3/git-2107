/* Страница руководителя: вход через Supabase Auth (проект Otbor_2107), ученики и чек-лист в Supabase.
   Таблицы и права — Урок_2_git/supabase_git_teacher.sql (читать и писать может только email руководителя). */
(function () {
  "use strict";
  if (location.protocol === "http:" && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    location.replace("https://" + location.host + location.pathname);
    return;
  }
  // Публичные адрес и anon-ключ: сами по себе к данным не пускают (см. политики в SQL).
  const URL0 = "https://hpmidxaovjlcjlitqjvl.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwbWlkeGFvdmpsY2psaXRxanZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTI3OTYsImV4cCI6MjEwNDg4ODc5Nn0.UKlF5r7JHroaNgS8wXbRkjNPjGJ2hKufxyR-tlKAWmI";
  const IDLE_MS = 30 * 60 * 1000;
  const S = window.GitSim;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));


  const REPO = S.PRAKTIKA_URL;
  $("lRepo").href = REPO;
  $("lCollab").href = REPO + "/settings/access";
  $("lBranches").href = REPO + "/branches";
  $("lPulls").href = REPO + "/pulls";
  $("lIssues").href = REPO + "/issues";

  // ---------- сессия (только в пределах вкладки) ----------
  const SKEY = "git2107_teacher_session";
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(SKEY) || "null"); } catch (e) {}
  function setSession(s) {
    session = s;
    try { s ? sessionStorage.setItem(SKEY, JSON.stringify(s)) : sessionStorage.removeItem(SKEY); } catch (e) {}
  }
  async function auth(path, body) {
    const r = await fetch(URL0 + "/auth/v1/" + path, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "HTTP " + r.status);
    return j;
  }
  function keep(j, email) {
    setSession({ access_token: j.access_token, refresh_token: j.refresh_token, exp: Date.now() + (j.expires_in - 60) * 1000, email: email, seen: Date.now() });
  }
  async function token() {
    if (!session) throw new Error("no session");
    if (Date.now() - (session.seen || 0) > IDLE_MS) { logout("Сессия завершена после 30 минут бездействия."); throw new Error("idle"); }
    if (Date.now() >= session.exp) {
      const j = await auth("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      keep(j, session.email);
    }
    return session.access_token;
  }
  async function rest(path, opt) {
    opt = opt || {};
    const t = await token();
    const r = await fetch(URL0 + "/rest/v1/" + path, Object.assign({}, opt, {
      headers: Object.assign({ apikey: ANON, Authorization: "Bearer " + t, "Content-Type": "application/json" }, opt.headers || {}),
    }));
    if (r.status === 401) { logout("Сессия истекла, войдите снова."); throw new Error("401"); }
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    return r.status === 204 ? null : r.json();
  }
  ["click", "keydown"].forEach((ev) => document.addEventListener(ev, () => {
    if (session) { session.seen = Date.now(); setSession(session); }
  }));
  setInterval(() => { if (session && Date.now() - (session.seen || 0) > IDLE_MS) logout("Сессия завершена после 30 минут бездействия."); }, 60000);

  function showLogin(m) {
    $("app").hidden = true;
    $("login").hidden = false;
    $("msg").textContent = m || "";
  }
  function logout(m) {
    setSession(null);
    $("pupils").innerHTML = "";
    $("prep").innerHTML = "";
    showLogin(m);
  }
  $("logout").onclick = () => logout("");
  $("lform").onsubmit = async (e) => {
    e.preventDefault();
    $("msg").textContent = "Вхожу…";
    try {
      const email = $("email").value.trim();
      keep(await auth("token?grant_type=password", { email: email, password: $("password").value }), email);
      $("password").value = "";
      await start();
    } catch (er) {
      $("msg").textContent = /invalid/i.test(er.message) ? "Неверный email или пароль." : "Не вышло: " + er.message;
    }
  };

  // ---------- ученики ----------
  let pupils = [];
  let events = [];          // уровни и проверки
  let answers = [];         // ответы текущего опроса
  const SITE = "https://www.irtuganov.pro/git-2107/";
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  function status(t) { $("status").textContent = t; }
  const byKey = () => { const m = {}; pupils.forEach((p) => { if (p.key) m[p.key] = p; }); return m; };
  const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? "только что" : m < 60 ? m + " мин назад" : new Date(t).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

  function progressOf(key) {
    const lv = new Set(), last = { level: null, check: null, pair: null };
    events.forEach((e) => {
      if (e.key !== key) return;
      if (e.kind === "level") { lv.add(e.payload.id); last.level = e.created_at; }
      // проверка практики в парах (шаблон praktika-shablon) приходит тем же видом check с пометкой t: "pair"
      if (e.kind === "check") { if (e.payload.t === "pair") last.pair = e; else last.check = e; }
    });
    return { levels: lv.size, levelAt: last.level, check: last.check, pair: last.pair };
  }
  function progHtml(p) {
    if (!p.key) return ["<span class='muted'>нет ключа</span>", "", ""];
    const g = progressOf(p.key);
    const tr = g.levels ? "<b>" + g.levels + "</b>/" + S.LEVELS.length + "<small>" + ago(g.levelAt) + "</small>" : "<span class='muted'>—</span>";
    let ch = "<span class='muted'>—</span>";
    if (g.check) {
      const c = g.check.payload;
      const okN = (c.ok || []).length;
      ch = (c.fail ? "✔ " + okN + " · <span class='bad'>✘ " + c.fail + "</span>" : "<span class='ok'>✔ все " + okN + "</span>") +
        "<small>" + (c.fail && c.msg ? esc(c.msg) + " · " : "") + ago(g.check.created_at) + "</small>";
    }
    let pr = "<span class='muted'>—</span>";
    if (g.pair) {
      const c = g.pair.payload, N = 7;
      pr = (c.repo ? esc(c.repo) + " · " : "") + (c.fail ? "<b>" + (c.ok || []).length + "</b>/" + N + " · <span class='bad'>✘ " + c.fail + "</span>" : "<span class='ok'>✔ все " + N + "</span>") +
        "<small>" + (c.fail && c.msg ? esc(c.msg) + " · " : "") + ago(g.pair.created_at) + "</small>";
    }
    return [tr, ch, pr];
  }

  function renderPupils() {
    const byTeam = {};
    pupils.forEach((p) => { (byTeam[p.team || "—"] = byTeam[p.team || "—"] || []).push(p); });
    let h = "<tr><th>Ученик</th><th>Ключ</th><th>Логин GitHub</th><th>Тренажёр</th><th>проверить.py</th><th>Практика в парах</th><th>Заметка</th><th></th></tr>";
    Object.keys(byTeam).sort().forEach((team) => {
      h += "<tr class='team-h'><td colspan='8'>Команда " + esc(team) + " · " + byTeam[team].length + " чел.</td></tr>";
      byTeam[team].forEach((p) => {
        const pr = progHtml(p);
        h += "<tr data-id='" + p.id + "'><td>" + esc(p.name) + (p.klass ? "<div class='muted' style='font-size:12px'>" + esc(p.klass) + "</div>" : "") + "</td>" +
          "<td class='keycell'>" + (p.key ? esc(p.key) + " <button class='btn mini' data-link title='Скопировать личную ссылку'>копировать</button><br><a href='" + esc(linkOf(p)) + "' target='_blank' rel='noopener'>" + esc(linkOf(p).replace(/^https?:\/\//, "")) + "</a>" : "—") + "</td>" +
          "<td><input type='text' data-k='github' value='" + esc(p.github) + "' placeholder='логин'></td>" +
          "<td class='prog'>" + pr[0] + "</td><td class='prog'>" + pr[1] + "</td><td class='prog'>" + pr[2] + "</td>" +
          "<td><input type='text' data-k='note' value='" + esc(p.note) + "'></td>" +
          "<td><button class='btn mini' data-del>удалить</button></td></tr>";
      });
    });
    const noKey = pupils.filter((p) => !p.key).length;
    $("pupils").innerHTML = h + (noKey ? "<tr><td colspan='8'><button class='btn' id='genKeys'>Выдать ключи (" + noKey + ")</button></td></tr>" : "");
    $("pupils").querySelectorAll("input").forEach((inp) => {
      inp.onchange = () => save(+inp.closest("tr").dataset.id, inp.dataset.k, inp.value);
    });
    $("pupils").querySelectorAll("[data-link]").forEach((b) => (b.onclick = async () => {
      const p = pupils.find((x) => x.id === +b.closest("tr").dataset.id);
      const link = linkOf(p);
      try { await navigator.clipboard.writeText(link); status("Скопировано: " + link); } catch (e) { prompt("Личная ссылка для " + p.name, link); }
    }));
    $("pupils").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      const id = +b.closest("tr").dataset.id;
      const p = pupils.find((x) => x.id === id);
      if (!confirm("Удалить " + p.name + " из списка? Его ключ перестанет работать.")) return;
      await rest("git_pupils?id=eq." + id, { method: "DELETE" });
      pupils = pupils.filter((x) => x.id !== id);
      renderPupils(); renderFlow(); renderLive();
      status("Удалено.");
    }));
    if ($("genKeys")) $("genKeys").onclick = genKeys;
    renderMsgs();
  }
  function linkOf(p) { return SITE + "?k=" + p.key; }
  function firstName(p) { const w = p.name.trim().split(/\s+/); return w.length > 1 ? w[1] : w[0]; }
  function messageOf(p) {
    return "Привет, " + firstName(p) + "! Это твоя личная ссылка на git-тренажёр — по ней я вижу твои ответы и пройденные уровни:\n" +
      linkOf(p) + "\n\n" +
      "Не пересылай её другим. Открой ссылку и проверь, что вверху написано «✓ руководитель видит ваши ответы».\n\n" +
      "В ответ пришли, пожалуйста, свой логин на GitHub (если аккаунта нет — заведи по вкладке «Подключение к GitHub», шаг 2) " +
      "и напиши, установлены ли у тебя Git, Python и VS Code.\n\n" +
      "На занятии пригодится твой ключ: " + p.key;
  }
  let sentMarks = [];
  function renderMsgs() {
    const list = pupils.filter((p) => p.key);
    if (!list.length) { $("msgs").innerHTML = "<div class='card muted'>Сначала выдайте ключи.</div>"; return; }
    $("msgs").innerHTML = list.map((p) =>
      "<div class='card msg" + (sentMarks.includes(p.key) ? " sent" : "") + "' data-key='" + esc(p.key) + "'>" +
      "<div class='who'>" + esc(p.name) + "<span class='muted' style='font-weight:400'>команда " + esc(p.team || "—") + "</span></div>" +
      "<pre>" + esc(messageOf(p)) + "</pre>" +
      "<div class='acts'><button class='btn primary' data-copy>Скопировать</button>" +
      "<label class='muted' style='font-size:13px'><input type='checkbox' data-sent" + (sentMarks.includes(p.key) ? " checked" : "") + "> отправлено</label></div></div>"
    ).join("");
    $("msgs").querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
      const p = pupils.find((x) => x.key === b.closest(".msg").dataset.key);
      try { await navigator.clipboard.writeText(messageOf(p)); b.textContent = "Скопировано ✓"; setTimeout(() => (b.textContent = "Скопировать"), 1500); }
      catch (e) { prompt("Сообщение для " + p.name, messageOf(p)); }
    }));
    $("msgs").querySelectorAll("[data-sent]").forEach((cb) => (cb.onchange = async () => {
      const k = cb.closest(".msg").dataset.key;
      sentMarks = sentMarks.filter((x) => x !== k);
      if (cb.checked) sentMarks.push(k);
      cb.closest(".msg").classList.toggle("sent", cb.checked);
      try {
        await rest("git_teacher_kv?on_conflict=key", { method: "POST", body: JSON.stringify({ key: "sent", value: sentMarks, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
      } catch (e) { alert("Не сохранилось: " + e.message); }
    }));
  }
  function newKey() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const r = crypto.getRandomValues(new Uint32Array(6));
    return Array.from(r, (x) => A[x % A.length]).join("");
  }
  async function genKeys() {
    for (const p of pupils.filter((x) => !x.key)) {
      const k = newKey();
      await rest("git_pupils?id=eq." + p.id, { method: "PATCH", body: JSON.stringify({ key: k, updated_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
      p.key = k;
    }
    renderPupils(); renderLive();
    status("Ключи выданы. Кнопка «ссылка» копирует личную ссылку ученика.");
  }
  async function save(id, key, value) {
    const body = {};
    body[key] = value.trim() || null;
    body.updated_at = new Date().toISOString();
    try {
      await rest("git_pupils?id=eq." + id, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });
      pupils.find((x) => x.id === id)[key] = body[key];
      status("Сохранено " + new Date().toLocaleTimeString("ru-RU"));
    } catch (e) { status("Не сохранилось: " + e.message); }
  }
  $("add").onclick = async () => {
    const name = $("newName").value.trim();
    if (!name) return;
    const row = { name: name, team: $("newTeam").value.trim() || null, klass: $("newKlass").value.trim() || null, sort: pupils.length + 1 };
    const res = await rest("git_pupils", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" } });
    pupils.push(res[0]);
    $("newName").value = "";
    renderPupils(); renderFlow();
    status("Добавлен " + name + ". Не забудьте выдать ключ.");
  };
  // Проверка кода с карточки — для тех, кто без ключа.
  function checkCode() {
    const w = norm($("cName").value).split(" ");
    const c = $("cCode").value.trim().toUpperCase();
    if (!c || $("cN").value === "") { $("cRes").innerHTML = ""; return; }
    const ok = [w.join(" "), w.slice().reverse().join(" ")].some((v) => S.progressCode(v, +$("cN").value) === c);
    $("cRes").innerHTML = ok ? "<span class='ok'>✔ верный</span>" : "<span class='bad'>✘ не совпадает</span>";
  }
  ["cName", "cN", "cCode"].forEach((id) => ($(id).oninput = checkCode));

  // ---------- опрос в прямом эфире ----------
  const QZ = GitQuiz.QUIZ;
  let quiz = { session: null, q: 0, revealed: false };
  async function setQuiz(patch) {
    Object.assign(quiz, patch);
    renderLive();
    await rest("git_quiz?id=eq.1", { method: "PATCH", body: JSON.stringify(Object.assign({}, quiz, { updated_at: new Date().toISOString() })), headers: { Prefer: "return=minimal" } });
    await loadAnswers();
  }
  function currentAnswers() {
    const last = {};
    answers.forEach((e) => { if (e.payload.q === quiz.q) last[e.key] = e.payload.a; });
    return last;
  }
  function renderLive() {
    const box = $("live");
    if (!quiz.session) {
      box.innerHTML = "<div class='live-top'><div><b>Опрос «Как устроен Git»</b> — " + QZ.length + " вопросов. Ученики отвечают на вкладке «Урок» тренажёра со своим ключом.</div>" +
        "<button class='btn primary' id='qStart'>Начать опрос</button></div>";
      $("qStart").onclick = () => setQuiz({ session: Math.random().toString(36).slice(2, 10), q: 0, revealed: false });
      return;
    }
    const q = QZ[quiz.q];
    const ans = currentAnswers();
    const keyed = pupils.filter((p) => p.key);
    const n = Object.keys(ans).filter((k) => byKey()[k]).length;
    const counts = GitQuiz.optionsOf(q).map((_, i) => Object.values(ans).filter((a) => a === i).length);
    const showMode = document.body.classList.contains("show");
    let h = "<div class='live-top'><span class='big-count'>Ответили " + n + " из " + keyed.length + "</span><div class='live-ctl'>" +
      "<button class='btn' id='qPrev'" + (quiz.q === 0 ? " disabled" : "") + ">← Назад</button>" +
      (quiz.revealed ? "" : "<button class='btn primary' id='qReveal'>Показать ответ</button>") +
      "<button class='btn" + (quiz.revealed ? " primary" : "") + "' id='qNext'" + (quiz.q >= QZ.length - 1 ? " disabled" : "") + ">Дальше →</button>" +
      "<button class='btn' id='qShow'>" + (showMode ? "Обычный режим" : "Режим показа") + "</button>" +
      "<button class='btn' id='qStop'>Завершить</button></div></div>";
    h += GitQuiz.render(q, { index: quiz.q, total: QZ.length, revealed: quiz.revealed, counts: counts, showCounts: quiz.revealed, clickable: false });
    if (!showMode) h += "<div class='answered'>" + keyed.map((p) => "<span class='" + (p.key in ans ? "y" : "") + "'>" + esc(p.name.split(" ").slice(-1)[0]) + (quiz.revealed && p.key in ans && q.correct !== null ? (ans[p.key] === q.correct ? " ✔" : " ✘") : "") + "</span>").join("") + "</div>";
    box.innerHTML = h;
    $("qPrev").onclick = () => setQuiz({ q: quiz.q - 1, revealed: false });
    $("qNext").onclick = () => setQuiz({ q: quiz.q + 1, revealed: false });
    if ($("qReveal")) $("qReveal").onclick = () => setQuiz({ revealed: true });
    $("qShow").onclick = () => { document.body.classList.toggle("show"); if (document.body.classList.contains("show")) showTab("pupils"); renderLive(); };
    $("qStop").onclick = () => { if (confirm("Завершить опрос? У учеников появится «Опрос ещё не начался».")) { document.body.classList.remove("show"); setQuiz({ session: null, q: 0, revealed: false }); } };
  }
  async function loadAnswers() {
    if (!quiz.session) { answers = []; return; }
    answers = await rest("git_events?select=key,payload,created_at&kind=eq.answer&payload->>s=eq." + encodeURIComponent(quiz.session) + "&order=created_at.asc");
    renderLive();
  }

  // ---------- вкладки: общая «Ученики и опрос» + по одной на каждое занятие ----------
  const TABS = ["pupils", "l8", "l11", "l12", "l13", "l14"];
  function showTab(t) {
    if (!TABS.includes(t)) t = TABS[TABS.length - 1];
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("on", s.id === "tab-" + t));
    try { localStorage.setItem("git2107_teacher_tab", t); } catch (e) {}
  }
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { showTab(b.dataset.tab); history.replaceState(null, "", "#" + b.dataset.tab); }));
  {
    const h = location.hash.replace("#", "");
    const sec = h && document.getElementById(h) && document.getElementById(h).closest(".tab");
    let saved = null;
    try { saved = localStorage.getItem("git2107_teacher_tab"); } catch (e) {}
    showTab(TABS.includes(h) ? h : sec ? sec.id.replace("tab-", "") : saved || TABS[TABS.length - 1]);
  }

  // ---------- чек-листы подготовки (git_teacher_kv, ключ prep<номер занятия>) ----------
  const PREP8 = [
    "На GitHub создан публичный пустой репозиторий Vonagu3/istoriya-igra, в него отправлено: git remote add origin https://github.com/Vonagu3/istoriya-igra.git · git push -u origin --all. На GitHub 4 ветки, 20 коммитов в main.",
    "(По желанию) Vonagu3/istoriya-demo на GitHub — чтобы показать отказ git push после rebase и --force-with-lease. Без него — словами.",
    "Папка ~/Desktop/2107/Git/Vonagu3/istoriya-demo чистая и на main. Испорчена после репетиции — rm -rf и пересоздать: python3 ~/Desktop/2107/MAX/Урок_8/создать_репозиторий.py ~/Desktop/2107/Git/Vonagu3/istoriya-demo",
    "У себя git config --global core.editor \"code --wait\" — для показа rebase -i в VS Code, а не в Vim.",
    "Ответы детектива (в блоке практики) — не показывать на экране до конца практики.",
    "Демонстрировать окно, а не весь экран; эту страницу — только в «Режиме показа».",
  ];
  const PREP11 = [
    "Демо-проект sql-demo в Supabase — от аккаунта KruzhokProg (вход через GitHub KruzhokProg), НЕ на Otbor_2107: там настоящие данные учеников. Пароль базы сохранён. Таблиц pitomcy и geroi в нём нет (после репетиции — drop table, см. блок «Итог»).",
    "supabase.com открывается с того интернета, откуда ведёте занятие.",
    "Ученикам в чат группы в Telegram за день: «На занятии начинаем базы данных. Нужен вход в GitHub в браузере (логин и пароль под рукой) — через него зарегистрируемся в Supabase. Ничего ставить не нужно. И вспомните вопрос с прошлого занятия: чего Excel не умеет?»",
    "Открыты вкладки: эта страница, Урок_10/Питомцы_excel_vs_baza.xlsx (лист «Так бывает в Excel»), sql-demo → SQL Editor, Урок_10/geroi.sql.",
    "Лист «Для учителя» в Excel и ответы практики — не показывать на экране. Демонстрировать окно, а не весь экран.",
  ];
  const PREP12 = [
    "Домашка к 12 проверена по чату: у кого есть zaprosy.sql и скриншот своей таблицы, у кого нет. Кто без таблицы — в практике 2 сначала создаёт её.",
    "Ученикам в чат за день: «Завтра считаем героев. Откройте Supabase → sql-praktika: если проект Paused — нажмите Restore заранее. Домашку — в чат до занятия».",
    "sql-demo открывается, таблиц pitomcy и geroi в нём нет (питомцев создаём скриптом в блоке 25–40, героев — в практике 0).",
    "Открыты вкладки: эта страница, sql-demo → SQL Editor, вкладка «Подсчёты» у учеников (#sql2).",
    "Ответы (оранжевые блоки) не показывать на экране. Демонстрировать окно, а не весь экран.",
  ];
  const PREPS = { 8: PREP8, 11: PREP11, 12: PREP12 };  // PREPS[13] добавляется ниже, рядом с занятием 13
  const prepDone = {};
  function renderPrep(l) {
    const box = $("prep-" + l), done = prepDone[l] || (prepDone[l] = []);
    box.innerHTML = PREPS[l].map((t, i) => "<li><label><input type='checkbox' data-p='" + i + "'" + (done.includes(i) ? " checked" : "") + "><span>" + esc(t) + "</span></label></li>").join("");
    box.querySelectorAll("input").forEach((cb) => (cb.onchange = async () => {
      const i = +cb.dataset.p, k = done.indexOf(i);
      if (cb.checked && k < 0) done.push(i);
      if (!cb.checked && k >= 0) done.splice(k, 1);
      try {
        await rest("git_teacher_kv?on_conflict=key", { method: "POST", body: JSON.stringify({ key: "prep" + l, value: done, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
      } catch (e) { alert("Не сохранилось: " + e.message); }
    }));
  }

  // ---------- ход занятия: команды копируются кликом (терминал, SQL Editor или чат группы в Telegram) ----------
  const copied = new Set();
  const C = (...cmds) => ({ cmd: cmds });
  const DEMO = "~/Desktop/2107/Git/Vonagu3/istoriya-demo";
  const IGRA = "https://github.com/Vonagu3/istoriya-igra";
  const FLOW8 = [
    ["0–15", "разбор", "Разбор командной домашки", [
      { note: "Владелец каждой команды показывает экран: доска (сколько из 9 в Done) → Pull requests → Closed (9 слитых, у каждого Approve) → Insights → Network (два merge-коммита «Решил конфликт»). Каждому один вопрос: «Где застряли дольше всего?» Одну остановку разобрать, не больше 3 минут. Не доделали — к занятию 9." },
      { note: "Переход: «В вашем репозитории уже десятки коммитов. Сегодня учимся в них разбираться: кто что поменял и зачем, и как перенести коммит из ветки в ветку»." }]],
    ["15–22", "показ", "История файла · папка istoriya-demo", [
      C("cd " + DEMO, "code .", "git log --oneline --graph --all"),
      { note: "«Это программа-копилка, её писали четверо, 20 коммитов. Сбоку ветки — понадобятся во второй половине». Выход из log — <code>q</code>." },
      C("git log --oneline README.md", "git log -p README.md", "git show 83f1651", "git show --stat b0611b4"),
      { note: "Показать <code>-</code> и <code>+</code>: «минус — было, плюс — стало: цель сменилась с наушников на велосипед». Хеш — из <code>git log --oneline</code>, хватит 7 символов." },
      { note: "Вопрос классу: «Кто написал функцию <code>trati</code>?» Листать долго:" },
      C('git log -S "def trati" --oneline'),
      { note: "Один коммит «Посчитал траты». «<code>-S</code> ищет коммиты, где слово появилось или исчезло. Кавычки — если в слове пробел»." }]],
    ["22–30", "показ", "git blame · терминал, GitHub, VS Code", [
      { note: "Вопрос: «Кто и когда написал строку „Цель: накопить на велосипед“?» <code>blame</code> подписывает каждую строку файла." },
      C("git blame README.md"),
      { note: "Разобрать одну строку слева направо: хеш → автор → дата → номер строки → текст. <code>^</code> перед хешем — строка с самого первого коммита. Выход — <code>q</code>." },
      C("git blame -L 5,5 README.md", "git show 83f1651", "git blame -L 5,5 README.md 83f1651~1"),
      { note: "«blame говорит кто и когда, а зачем — в самом коммите». Последняя команда — что было в строке до Ани: наушники. «<code>~1</code> — коммит перед этим, так идём назад по следам». <code>~1</code>, а не <code>^</code>: в cmd на Windows <code>^</code> ломает команду." },
      { note: "<b>GitHub</b>: открыть README в " + "<a href='" + IGRA + "' target='_blank' rel='noopener'>istoriya-igra</a>" + " → кнопка <b>Blame</b>; значок «View blame prior to this change» — шаг назад, как <code>~1</code>; рядом <b>History</b>. Только README — <code>kopilka.py</code> не открывать, там ответы детектива. <b>VS Code</b>: автор строки под курсором в строке состояния или <code>Cmd+Shift+P</code> → «Git: Toggle Git Blame Editor Decoration»; всегда есть Explorer → панель <b>Timeline</b>." },
      { warn: "Сказать: «Blame — не чтобы ругать, а чтобы знать, у кого спросить. Нашли странную строку → blame → пишете автору»." }]],
    ["30–37", "показ", "cherry-pick: один коммит из ветки", [
      { note: "«Вика в ветке <code>ispravlenie</code> начала черновик и попутно исправила опечатку „капилка“. Ветка не готова, а исправление нужно в main сейчас»." },
      C("git log --oneline -3 ispravlenie", "git checkout main", "git cherry-pick ХЕШ", "git log --oneline -3"),
      { note: "ХЕШ — верхний, «Исправил опечатку в README». В README «копилка», <code>velosiped.md</code> нет — черновик не приехал." },
      { ol: ["Это <b>копия</b>: в main новый хеш, в ветке Вики остался старый.",
        "Родственник патча: патч — недописанные правки между людьми, <code>cherry-pick</code> — готовый коммит между ветками.",
        "Конфликт — как обычно, потом <code>git add</code> и <code>git cherry-pick --continue</code>; передумали — <code>--abort</code>.",
        "В их репозиториях main защищён: ветка от main → <code>cherry-pick</code> → PR."] },
      C("git reset --hard HEAD~1"),
      { note: "Вернуть main демо перед rebase." }]],
    ["37–44", "показ", "rebase main: без конфликта", [
      C("до:      main   A─B─C─D─E\n                   \\\nветка               X─Y\n\ngit rebase main\n\nпосле:   main   A─B─C─D─E\n                         \\\nветка                     X'─Y'"),
      { note: "Рисунок — в чат. «До сих пор вы обновляли ветку через <code>git pull origin main</code> — получался merge-коммит. rebase снимает ваши коммиты, обновляет основу и кладёт их сверху. История прямая»." },
      C("git log --oneline --graph main moya-vetka", "git checkout moya-vetka", "git rebase main", "git log --oneline --graph -6"),
      { note: "«Идеи» сверху, хеши <b>новые</b>: «X' — не X, коммиты переписаны»." }]],
    ["44–50", "показ", "rebase с конфликтом", [
      C("git checkout konflikt", "git rebase main"),
      { warn: "<code>CONFLICT</code> в README. «При rebase всё наоборот: сверху (HEAD, Current) — main, снизу (Incoming) — ваш коммит. Читайте текст, а не кнопки»." },
      { note: "Оставить <code>Цель: накопить на велосипед и чехол.</code>, метки убрать, сохранить." },
      C("git add README.md", "git rebase --continue"),
      { note: "Откроется сообщение — закрыть вкладку (Vim: <kbd>Esc</kbd>, <code>:wq</code>, <kbd>Enter</kbd>). «Конфликт может быть на каждом вашем коммите по очереди: решили → add → continue. Запутались — <code>git rebase --abort</code>»." }]],
    ["50–55", "показ", "push после rebase · правило · rebase -i", [
      { note: "Если <code>istoriya-demo</code> есть на GitHub — показать, иначе словами: обычный push откажет <code>rejected (non-fast-forward)</code> — на GitHub старые X, Y, у меня новые." },
      C("git push", "git push --force-with-lease"),
      C("REBASE — ТОЛЬКО В СВОЕЙ ВЕТКЕ, В КОТОРОЙ НЕ РАБОТАЕТ НИКТО ДРУГОЙ.\nmain и общие ветки — никогда.\nПосле rebase: git push --force-with-lease (не просто --force)."),
      { ol: ["В main не выйдет: правило main запрещает force push (занятие 6).",
        "<code>--force-with-lease</code> откажет, если в ветке на GitHub появилось чужое.",
        "После force push Approve в PR сбрасывается — это нормально."] },
      { note: "<b>rebase -i — только смотрим.</b> Во второй и третьей строке <code>pick</code> → <code>squash</code>, сохранить, закрыть; сообщение «Идеи для копилки». «Если откроется сами — <code>git rebase --abort</code>»." },
      C("git checkout moya-vetka", "git rebase -i main", "git log --oneline -3")]],
    ["55–60", "перерыв", "Перерыв", [
      { note: "После занятия демо вернуть: удалить папку и пересоздать скриптом (чек-лист, п. 3)." }]],
    ["60–105", "практика", "Практика: каждый сам", [
      { note: "Весь материал показан. Ученики открывают свою страницу → вкладка <b>Практика</b> → «Практика на занятии 8». Push не делают. Ответы детектива — в личку." },
      C(SITE + "#lesson"),
      C("ПРАКТИКА · 45 минут · каждый сам · push НЕ делаем\nПодробно, с галочками: " + SITE + "#lesson\n0. git clone " + IGRA + ".git (на рабочем столе, не в своём проекте)\nА. Детектив — 5 вопросов, ответы мне в личку\nБ. cherry-pick опечатки из ветки ispravlenie\nВ. rebase: moya-vetka, потом konflikt\nУборка: git checkout main · git reset --hard origin/main"),
      { note: "Тайминг: клон 3, детектив 12, cherry-pick 10, rebase 20. Не успевают — rebase с конфликтом сделать вместе на экране." },
      { warn: "<b>Ответы детектива:</b> 1) Вика, <code>ab4aff3</code> «Самая большая трата»; 2) Гоша, <code>5b3f231</code> «Упростил подсчёт недель» (строка 20); 3) <code>ostalos</code>, старую строку написал Боря, <code>9588117</code> «Посчитал недели до цели» — <code>git blame -L 20,20 kopilka.py 5b3f231~1</code> или <code>git show 5b3f231</code>; 4) <code>kopilka.py</code> и <code>operacii.txt</code> (<code>19adab4</code>); 5) 5 коммитов.<br><b>Cherry-pick:</b> хеш в ветке <code>4fc8b46</code>." },
      { ready: "Все написали «готово»" }]],
    ["105–115", "итог", "Ответы и итог", [
      { note: "Пройти ответы детектива: на вопросы 2 и 3 показать <code>git blame kopilka.py</code> и <code>git show 5b3f231</code> в istoriya-igra. Домашка: доделать командную к занятию 8; по желанию — в следующем PR обновить ветку через <code>git rebase main</code> + <code>git push --force-with-lease</code>." },
      C("ЗАНЯТИЕ 8 · ЗАПОМНИТЬ\ngit log -p файл             что менялось в файле\ngit log -S \"слово\"          в каком коммите слово появилось\ngit blame файл              кто последним менял каждую строку\ngit blame -L 5,5 файл       только строка 5 (+ ХЕШ~1 — что было до этого коммита)\ngit cherry-pick ХЕШ         копия одного коммита в текущую ветку\ngit rebase main             моя ветка поверх свежего main\n   конфликт: решить · git add · git rebase --continue · запутался: --abort\n   потом: git push --force-with-lease — ТОЛЬКО в своей ветке")]],
  ];
  const GEROI = SITE + "files/geroi.sql";
  const FLOW11 = [
    ["0–8", "разговор", "Чего Excel не решит — ответы ребят", [
      { note: "Вопрос, на котором остановились на занятии 10. Каждый пишет в чат 1–2 проблемы, потом каждый озвучивает одну. Записывать в две колонки: «Excel не умеет» → «что нужно вместо». Не подсказывать: что не назовут — найдут сами на листе с питомцами." },
      C("ВОПРОС С ПРОШЛОГО ЗАНЯТИЯ\nВаш бот хранит напоминания пользователей. Почему не в Excel-файле?\nНапишите 1–2 проблемы, которые Excel не решит."),
      { warn: "<b>Шпаргалка, сверять с ответами:</b> нет типов («два» в числовой колонке); нет ключа (две строки «Барсик» — один кот или два?); один файл — один хозяин, бот, приложение и сайт не могут писать одновременно; из кода нужен запрос по сети, а не файл; нет прав «каждый видит только свои» (в базе — RLS); тормозит на миллионах строк (в базе — индексы); телефон хозяина в 10 строках — меняешь в 10 местах (связи, JOIN); затёр файл — данных нет. Плюс: Excel сам «угадывает» — протянули 1, 2, 4 → получили 5,33 (линейный тренд), чего в данных не было." }]],
    ["8–15", "все", "Supabase: регистрация и проект sql-praktika", [
      { note: "Проект создаётся 1–3 минуты — поэтому сейчас, до показа. Пройти путь на экране от KruzhokProg до формы New project и закрыть её." },
      C("1. Откройте supabase.com → Start your project (или Sign in).\n2. Continue with GitHub → Authorize.\n3. Если спросит про организацию: имя — ваш ник, тип Personal, план Free.\n4. New project:\n   • Name: sql-praktika\n   • Database Password: кнопка Generate → СКОПИРУЙТЕ и сохраните в заметки\n   • Region: Европа (Central EU / Frankfurt)\n   • Create new project\n5. Проект создаётся 1–3 минуты. Не закрывайте вкладку, смотрим показ."),
      { note: "Пока создаётся: «Supabase — база PostgreSQL в облаке плюс панель. Бот на Python, приложение на Kotlin и сайт будут читать и писать в одну базу». Бесплатный проект засыпает через неделю без дела → кнопка Restore, данные целы. Пароль сегодня не нужен — понадобится для Python, его можно сбросить." }]],
    ["15–23", "показ", "Excel против базы · питомцы", [
      { note: "<code>Питомцы_excel_vs_baza.xlsx</code>, лист <b>«Так бывает в Excel»</b>. Вопрос: «Сколько собак? Какой средний возраст?» Формулы внизу: собак 1, возраст 4,2. Ребята сами ищут, почему — и сверяют со своим списком из начала." },
      { warn: "<b>8 проблем (лист «Для учителя»):</b> 1) возраст «два», «7 лет» — текст в числах, AVERAGE молча пропускает; 2) средний 4,2 — посчитано 5 строк из 7, правильно 4,5; 3) «Собака», «собака » с пробелом, «пёс» — одно и то же по-разному; 4) собак насчитано 1, а их 3; 5) Барсик дважды — один кот или два? → <code>id</code>; 6) пусто и «?» — оба «не знаем» → <code>NULL</code>; 7) телефон Ани дважды и в разном виде → таблица хозяев, связь (занятие 12); 8) файл у одного человека → базу пишут бот, приложение, сайт одновременно." },
      { note: "Лист <b>«Так в базе (pitomcy)»</b>: <code>id</code>, латинские названия, строка типов, <code>NULL</code> — формулы дают 3 и 4,5. «Это та же pitomcy, которую сейчас создадим в Supabase». Телефона нет нарочно — «он про хозяина, а не про питомца», только упомянуть." },
      C("EXCEL → БАЗА ДАННЫХ\nлист                      → таблица (table)\nстрока                    → строка, запись (row)\nстолбец с заголовком      → столбец, поле (column)\nв ячейку что угодно       → у столбца тип: text, int, boolean, date\nстроки путаются           → первичный ключ id, не повторяется\nоткрывает один человек    → пишут бот, приложение и сайт сразу\nищем глазами и фильтрами  → спрашиваем на языке SQL\nпусто, «?», «-»           → NULL — «неизвестно», не 0 и не ''"),
      { note: "SQL читается почти как английский: <code>select imya from geroi where uroven &gt; 50</code>. Названия — латиницей, маленькими, через <code>_</code>, как ветки в git. Значения в кавычках — на любом языке." }]],
    ["23–30", "показ", "Таблица мышкой · Table Editor · sql-demo", [
      { ol: ["Table Editor → <b>Create a new table</b>. Name <code>pitomcy</code>. RLS оставить включённым: «замок от внешнего мира, разберём с ботом; мы в панели — администраторы».",
        "<code>id</code> и <code>created_at</code> Supabase добавил сам — у <code>id</code> значок ключа.",
        "Add column: <code>klichka</code> text (убрать Is Nullable), <code>vid</code> text, <code>vozrast</code> int4, <code>hozyain</code> text → Save.",
        "Insert row ×3: Барсик, кот, 3, Аня · Рекс, собака, 5, Миша · Кеша, попугай, 2, хозяин пусто. <code>id</code> 1, 2, 3 — сами.",
        "В <code>vozrast</code> написать <code>три</code> — не сохранит. «Вот он, тип. Excel бы проглотил»."] },
      { note: "«Мышкой удобно, пока строк три. Когда тысяча, а вопрос — „все собаки старше 4 лет без хозяина“ — нужен SQL». Эту фразу — после практики 0." }]],
    ["30–37", "практика", "Практика 0: каждый сам создаёт pitomcy мышкой", [
      { note: "У учеников всё по шагам — вкладка <b>Базы данных</b>, ссылку в чат:" },
      C(SITE + "#sql"),
      { note: "Сразу после показа, пока свежо. Каждый в своём <code>sql-praktika</code> повторяет то, что видел. Заодно видно, у кого проект так и не создался — им помочь сейчас." },
      C("ПРАКТИКА 0 · 7 минут · каждый в своём проекте sql-praktika\n1. Table Editor → Create a new table → Name: pitomcy. RLS не трогать.\n2. id и created_at уже есть. Add column:\n   klichka — text — снять галочку Is Nullable (кличка обязательна)\n   vid — text\n   vozrast — int4\n   hozyain — text\n   → Save\n3. Insert → Insert row — 3 питомца (можно своих). У одного хозяин — пусто.\n4. Попробуйте в vozrast написать «три». Что сделает Supabase?\n5. Готово — скриншот таблицы в чат."),
      { warn: "Проверка по скриншотам: 4 своих столбца + <code>id</code>, <code>created_at</code>; 3 строки с <code>id</code> 1, 2, 3; у одной <code>hozyain</code> — NULL. «три» в <code>vozrast</code> не сохранится — тип. Не создаётся строка — пустая <code>klichka</code> (обязательна)." },
      { ready: "Скриншоты pitomcy у всех в чате" }]],
    ["37–52", "показ", "SQL Editor: SELECT, WHERE, ORDER BY, INSERT, UPDATE, DELETE", [
      { warn: "Сразу: в окне несколько запросов → выполнятся все, а виден результат <b>только последнего</b>. Нужен один — выделить его и Run (<code>Ctrl+Enter</code> / <code>Cmd+Enter</code>)." },
      C("select * from pitomcy;", "select klichka, vid from pitomcy;"),
      C("insert into pitomcy (klichka, vid, vozrast, hozyain) values\n  ('Мурка', 'кошка', 7, 'Аня'),\n  ('Шарик', 'собака', 1, NULL),\n  ('Граф', 'собака', 9, 'Петя');"),
      { note: "Текст — в <b>одинарных</b> кавычках, числа без кавычек, <code>id</code> не пишем. Теперь 6 строк." },
      C("select * from pitomcy where vid = 'собака';", "select * from pitomcy where vid = 'собака' and vozrast > 4;", "select * from pitomcy where vid in ('кот', 'кошка');", "select * from pitomcy where klichka like 'Ш%';"),
      { note: "<code>= &lt;&gt; &gt; &lt; &gt;= &lt;=</code>; <code>and</code> — оба, <code>or</code> — хотя бы одно; <code>in (…)</code> — одно из списка; <code>%</code> — любые символы." },
      C("select * from pitomcy where hozyain = NULL;", "select * from pitomcy where hozyain is null;"),
      { warn: "<b>Ловушка 1.</b> <code>= NULL</code> — пусто: «неизвестно» не равно ничему. Только <code>is null</code> / <code>is not null</code>. Спросить: почему <code>where hozyain &lt;&gt; 'Аня'</code> не покажет Кешу?" },
      C("select * from pitomcy order by vozrast desc limit 2;", "select * from pitomcy order by vid, vozrast desc;"),
      C("select … from … where … order by … limit …"),
      C("update pitomcy set hozyain = 'Илья' where klichka = 'Шарик';", "update pitomcy set vozrast = vozrast + 1 where id = 1;", "delete from pitomcy where id = 5;"),
      { note: "«Менять лучше по <code>id</code> — кличка может повториться»." },
      C("update pitomcy set hozyain = 'Никто';"),
      { warn: "<b>Ловушка 2.</b> Run → Supabase переспросит → <b>Cancel</b>. «Без <code>where</code> изменятся ВСЕ строки, <code>delete</code> удалит всех. Отмены, как <code>git revert</code>, нет. Правило: сначала <code>select … where …</code>, смотрим строки, потом меняем на <code>update</code>/<code>delete</code> с тем же <code>where</code>»." },
      { note: "Комментарий: <code>-- задание 3</code> — до конца строки не выполняется." }]],
    ["52–55", "показ", "geroi.sql и как устроена практика", [
      { note: "Новый запрос → вставить весь <code>geroi.sql</code> → Run → <code>vsego_geroev 30</code>. Пройти по <code>create table</code>: <code>generated always as identity primary key</code> — номер ставит база; <code>not null</code> — обязательно; <code>check (uroven between 1 and 100)</code> — уровень 500 не запишется; <code>default 0</code>; <code>drop table if exists</code> — <b>сломали героев → запустите скрипт заново</b>." },
      { warn: "Сказать: «pitomcy вы сделали мышкой. Вот так та же работа выглядит в SQL — <code>create table</code>. Сегодня героев берём готовыми, чтобы у всех были одинаковые 30 строк и сходились ответы. Дома вы напишете такой же <code>create table</code> для своего проекта»." },
      C(GEROI),
      { note: "Ссылку — в чат (открывается как текст: Ctrl+A, Ctrl+C). Или отправить файл <code>Урок_10/geroi.sql</code>. В каждом задании написано, сколько строк должно выйти, — это самопроверка." }]],
    ["55–60", "перерыв", "Перерыв", [{ note: "Кто не успел создать проект — доделать в перерыв." }]],
    ["60–95", "практика", "Практика 1: запросы к героям · каждый в своём sql-praktika", [
      C("ПРАКТИКА · БАЗЫ ДАННЫХ · занятие 11\n\n0. Supabase → проект sql-praktika → SQL Editor → New query.\n   Вставить ВЕСЬ текст geroi.sql → Run. Внизу: vsego_geroev 30.\n   " + GEROI + "\n   Каждое задание — новый запрос или выделить нужную строку и Run.\n   Сломали таблицу — запустите geroi.sql заново.\n\nТаблица geroi: id, imya, klass, uroven, zoloto, gildiya, v_seti, data_registracii\nКлассы: воин, маг, лучник, лекарь.\nГильдии: Стальные волки, Звёздный круг, Ночные тени, Белые крылья (или пусто).\n\n 1. Все герои, все столбцы.                                → 30 строк\n 2. Только имя и уровень всех героев.                      → 30 строк, 2 столбца\n 3. Все маги.                                              → 8 строк\n 4. Герои с уровнем больше 50.                             → 16 строк\n 5. Маги с уровнем больше 50.                              → 5 строк\n 6. Лучники и лекари (через or и через in).                → 13 строк\n 7. Герои без гильдии.                                     → 8 строк\n    (а что выйдет с  where gildiya = NULL ? почему?)\n 8. Герои, чьё имя начинается на «А».                      → 3 строки\n 9. 5 самых богатых героев (имя и золото).                 → первый — Ультра, 9999\n10. Все герои: по классу, внутри — от высокого уровня.     → первые: Йети, Гром, Ястреб\n11. Зарегистрировались в 2026 году или позже\n    (дата пишется так: '2026-01-01').                      → 7 строк\n12. Кто из «Стальных волков» сейчас в сети? (v_seti = true) → 4 строки\n\nГотово — пишите в чат «Практика 1 готова»."),
      { note: "Частые ошибки: <code>column \"маг\" does not exist</code> — текст без кавычек; <code>syntax error at or near …</code> — смотреть слово и слово перед ним (запятая, двойные кавычки); 0 строк без ошибки — <code>'Маг'</code> вместо <code>'маг'</code> или лишний пробел. Задания 13–16 перенесены в домашку (Д8–Д11). Не успевают — и 9–12 туда же." },
      { warn: "<b>Ответы</b> (13–16 — для проверки домашки Д8–Д11): 5) Белла, Жасмин, Нокс, Руна, Ультра · 7) <code>is null</code>, <code>= NULL</code> → 0 · 8) Аргон, Астра, Ангел · 9) <code>order by zoloto desc limit 5</code>: Ультра 9999, Йети 7800, Гром 5100, Нокс 4600, Ястреб 4200 · 10) <code>order by klass, uroven desc</code> · 11) <code>data_registracii &gt;= '2026-01-01'</code> · 12) Аргон, Йети, Сокол, Цезарь · 13) <code>between 20 and 30 order by uroven</code>: Зорро, Юла, Мира · 14) 30 − 6 = 24, но 8 без гильдии не попали — про них неизвестно; все 24: <code>… or gildiya is null</code> · 15) <code>imya ilike '%р%'</code>; <code>like</code> различает Р и р · 16) <code>order by data_registracii desc limit 1</code>. Все — <code>Урок_10/Ответы.md</code>." },
      { ready: "Все написали «Практика 1 готова»" }]],
    ["95–105", "практика", "Практика 2: свой герой + контроль", [
      C("ПРАКТИКА 2 · свой герой\n\n13. Добавьте СВОЕГО героя: имя — ваш ник, класс, уровень (1–100!), золото, гильдия.\n    id и дату не пишите.                                   → 31 герой\n    Найдите себя через where imya = '…'.\n    Попробуйте добавить героя с уровнем 500 — что ответит база?\n14. Узнайте id своего героя. +500 золота (zoloto = zoloto + 500) и v_seti = true.\n    ТОЛЬКО ему — по id. Сначала select с тем же where, потом update.\n15. Ваш герой перешёл в «Белые крылья» — измените.\n16. Удалите своего героя. Сначала select с тем же where!  → снова 30\n\nКОНТРОЛЬ — выполните и пришлите СКРИНШОТ результата в чат:\n    select klass, imya, uroven from geroi\n    where uroven > 60 and gildiya is not null\n    order by uroven desc limit 5;"),
      { warn: "<b>Контроль:</b> Ультра 99, Йети 95, Гром 88, Нокс 82, Ястреб 80. Другое — таблица испорчена (<code>update</code> без <code>where</code>): запустить <code>geroi.sql</code> заново. Уровень 500 → <code>violates check constraint</code>: «база сама защищает данные — Excel бы записал». Удалил и вставил снова — id 32, 33: номера не переиспользуются." },
      { ready: "Скриншоты контроля у всех в чате" }]],
    ["105–112", "бонус", "Бонус для быстрых / помощь отстающим", [
      C("БОНУС\nБ1. Сколько всего героев?               select count(*) from geroi;\nБ2. Сколько золота у всех вместе?       select sum(zoloto) from geroi;\nБ3. Какие классы бывают (без повторов)? select distinct klass from geroi;\nБ4. Золото на один уровень — у кого больше?\n    select imya, zoloto / uroven as na_uroven from geroi\n    order by na_uroven desc limit 3;\nБ5. Таблица для ВАШЕГО проекта: 3–5 столбцов с типами, create table, 5 строк."),
      { note: "Ответы: Б1 30 · Б2 66409 · Б3 4 · Б4 Ультра 101, Йети 82, Гром 57. <code>count</code>, <code>sum</code> — тема занятия 12, сейчас только попробовать." }]],
    ["112–120", "итог", "Итог и домашка", [
      C("ЗАПОМНИТЬ · БАЗЫ ДАННЫХ · занятие 11\n• Таблица = строки (записи) × столбцы (поля). У столбца есть тип: text, int, boolean, date.\n• id — первичный ключ: уникальный номер строки, ставится сам.\n• Порядок в запросе: select … from … where … order by … limit …\n• Текст — в 'одинарных' кавычках, числа — без кавычек.\n• Пусто = NULL. Проверка: is null / is not null. «= NULL» не работает никогда.\n• UPDATE и DELETE — только с where. Сначала select с тем же where, потом меняем.\n• Несколько запросов в окне → видно только последний. Выделить нужный → Run.\n• Сломали таблицу героев — запустите geroi.sql заново."),
      C("ДОМАШНЕЕ ЗАДАНИЕ К ЗАНЯТИЮ 12 · каждый сам · ~40 минут\nSupabase → sql-praktika → SQL Editor. Если таблица героев менялась —\nсначала запустите geroi.sql заново.\n\nЧАСТЬ 1. Запросы (для каждого — сам запрос и проверка):\n Д1. Воины из «Стальных волков», от богатого к бедному.        → 4, первый Йети\n Д2. Герои НЕ в сети с уровнем меньше 30.                       → 3 строки\n Д3. 3 самых слабых героя (по уровню).                          → Пиксель, Ёрш, Эхо\n Д4. Герои, зарегистрированные в 2025 году. Сколько строк?     → 17 строк\n Д5. Маги и лекари без гильдии.                                 → 4 строки\n Д6. Герои, чьё имя заканчивается на «а».                       → 9 строк\n Д7. Герои с золотом от 1000 до 2000 включительно.              → 7 строк\n Д8. Уровень от 20 до 30 включительно, по уровню\n     (подсказка: between 20 and 30).                            → Зорро, Юла, Мира\n Д9. Герои НЕ из «Ночных теней». Сколько строк выйдет?\n     Сначала угадайте, потом проверьте через <>.                → 16 строк. Почему не 24?\n Д10. В имени есть буква «р», любая (ilike вместо like).        → 15 строк\n Д11. Самый новый (по дате регистрации) герой.                  → Пиксель\n Все 11 запросов сохраните в один файл zaprosy.sql\n (подпишите: -- Д1, -- Д2 …) и пришлите в чат.\n\nЧАСТЬ 2. Таблица для ВАШЕГО проекта.\n Придумайте одну таблицу, которая нужна вашему проекту\n (например, напоминания, пользователи, ответы бота).\n • Создайте её через create table по образцу geroi.sql:\n   id как в образце, 3–6 своих столбцов, у каждого тип (text, int, boolean, date),\n   хотя бы один not null и хотя бы один default.\n • Добавьте 5 строк через insert.\n • Скриншот select * from ваша_таблица; — в чат.\n Названия таблицы и столбцов — латиницей, маленькими буквами, через _.\n\nГОТОВО, КОГДА: в чате ваш zaprosy.sql (11 запросов) и скриншот своей таблицы.\nЗастряли больше чем на 5 минут — пишите в чат группы: какой запрос и какую ошибку видите."),
      { note: "Если в практике не успели 9–12 — дописать их в часть 1 (Д12…). После занятия очистить демо (проект <code>sql-demo</code> не удалять):" },
      C("drop table if exists pitomcy;\ndrop table if exists geroi;")]],
  ];
  const PITOMCY = "drop table if exists pitomcy;\ncreate table pitomcy (\n  id bigint generated always as identity primary key,\n  klichka text not null, vid text, vozrast int, hozyain text\n);\ninsert into pitomcy (klichka, vid, vozrast, hozyain) values\n  ('Барсик', 'кот', 3, 'Аня'), ('Рекс', 'собака', 5, 'Миша'), ('Кеша', 'попугай', 2, NULL),\n  ('Мурка', 'кошка', 7, 'Аня'), ('Шарик', 'собака', 1, NULL), ('Граф', 'собака', 9, 'Петя');\nselect * from pitomcy;";
  const FLOW12 = [
    ["0–10", "разбор", "Домашка к занятию 12", [
      { note: "Пока все подключаются — у кого проект «Paused», жмут Restore. По чату: кто прислал <code>zaprosy.sql</code> и скриншот своей таблицы. Разбираем не всё, а три вещи (полный разбор с запросами для показа — вкладка «Занятие 11» → «Разбор практики 1 и домашки»):" },
      { ol: ["<b>Д4</b> «сколько в 2025» — как считали? Глазами по строкам → «а если строк 10 000? Сегодня база посчитает сама».",
        "<b>Д9</b> — почему 16, а не 24? Ещё раз <code>NULL</code>: 8 без гильдии не равны и не «не равны» «Ночным теням» — про них неизвестно.",
        "<b>Своя таблица</b> — 1–2 человека показывают свой <code>create table</code>: какие типы, где <code>not null</code>, <code>default</code>. Ошибки — сразу вслух, без оценок."] },
      { warn: "<b>Ответы Д1–Д11:</b> Д1 Йети первый, 4 строки · Д2 3 · Д3 Пиксель, Ёрш, Эхо · Д4 17 · Д5 4 · Д6 9 · Д7 7 · Д8 Зорро, Юла, Мира · Д9 16 (+8 с <code>or gildiya is null</code> = 24) · Д10 15 · Д11 Пиксель. Запросы — <code>Урок_10/Ответы.md</code> (13–16)." }]],
    ["10–25", "все вместе", "Практика 0: жизнь одной строки (повтор практики 2)", [
      { note: "Прошлый раз не поняли — значит, сейчас <b>в ногу</b>: вы говорите шаг и делаете его на экране в <code>sql-demo</code>, все делают у себя, пишут в чат «готово», только потом следующий. После каждого шага <code>count(*)</code>: 30 → 31 → 31 → 30 — так появляется первое слово сегодняшней темы. У учеников то же самое — вкладка <b>Подсчёты</b>:" },
      C(SITE + "#sql2"),
      C("ПРАКТИКА 0 · все вместе, по шагам · в своём sql-praktika\nШаг сделали — пишете в чат «готово». Ждём всех.\n\n1. Запустить geroi.sql заново → vsego_geroev 30\n   select count(*) from geroi;                         → 30\n2. Добавить своего героя (вместо Ник — ваш ник):\n   insert into geroi (imya, klass, uroven, zoloto, gildiya)\n   values ('Ник', 'маг', 42, 100, NULL);\n   select count(*) from geroi;                         → 31\n3. Найти себя, запомнить id:\n   select * from geroi where imya = 'Ник';            → id (обычно 31)\n4. Изменить ТОЛЬКО себя — по id:\n   select * from geroi where id = 31;\n   update geroi set zoloto = zoloto + 500, v_seti = true where id = 31;\n   select * from geroi where id = 31;\n   update geroi set gildiya = 'Белые крылья' where id = 31;\n   select count(*) from geroi;                         → всё ещё 31\n5. Удалить себя:\n   select * from geroi where id = 31;\n   delete from geroi where id = 31;\n   select count(*) from geroi;                         → снова 30"),
      C(GEROI),
      { note: "Проговорить на каждом шаге: <code>insert</code> — новая строка, <code>id</code> база ставит сама; <code>update</code> и <code>delete</code> — что именно менять, решает <code>where</code>; сначала <code>select</code> с тем же <code>where</code>, потом меняем. Спросить: «Почему по <code>id</code>, а не по имени?» — имя может повториться (два ученика выбрали одинаковый ник)." },
      { warn: "Частое: <code>id</code> не 31 (удалял и вставлял снова — 32, 33; номера не переиспользуются); <code>update</code> изменил 0 строк — не тот <code>id</code>; изменились все — нет <code>where</code> → <code>geroi.sql</code> заново. Уровень 500 → <code>violates check constraint</code>." },
      { ready: "У всех снова 30 героев" }]],
    ["25–40", "показ", "Агрегаты: count, sum, avg, min, max · питомцы", [
      { note: "В <code>sql-demo</code> после занятия 11 таблицы удалены. Создать питомцев (те же 6, что в шпаргалке у учеников):" },
      C(PITOMCY),
      { note: "Вопрос из Excel: «Сколько собак? Какой средний возраст?» — там формулы врали. Теперь база:" },
      C("select count(*) from pitomcy;", "select count(*) from pitomcy where vid = 'собака';"),
      { note: "6 и 3. <code>count(*)</code> — сколько строк. С <code>where</code> — сначала отобрали, потом посчитали." },
      C("select count(hozyain) from pitomcy;"),
      { warn: "<b>Ловушка 3 — снова NULL.</b> Выйдет 4, а не 6: <code>count(столбец)</code> пропускает пустые. Спросить: «Почему?» — у Кеши и Шарика хозяина нет. Нужно «сколько всего» — <code>count(*)</code>." },
      C("select sum(vozrast), avg(vozrast), min(vozrast), max(vozrast) from pitomcy;"),
      { note: "27, <code>4.5000000000000000</code>, 1, 9. «Помните Excel? Там средний вышел 4,2 — а правильно 4,5». Хвост из нулей:" },
      C("select round(avg(vozrast), 1) as sredniy from pitomcy;", "select count(distinct vid) as vidov from pitomcy;"),
      { note: "<code>round(…, 1)</code> — один знак после точки. <code>as</code> — своё имя столбца в результате. <code>distinct</code> — без повторов: 4 вида." }]],
    ["40–50", "показ", "group by и having", [
      { note: "«А сколько питомцев каждого вида? Считать <code>where vid = …</code> четыре раза? А если видов 50?»" },
      C("select vid, count(*) from pitomcy group by vid;"),
      { note: "Нарисовать на доске: база раскладывает строки по кучкам — по одной на каждый вид — и считает в каждой. Одна строка результата = одна кучка." },
      C("select vid, count(*) as skolko from pitomcy\ngroup by vid\norder by skolko desc;", "select vid, round(avg(vozrast), 1) as sredniy from pitomcy group by vid;"),
      C("select hozyain, count(*) from pitomcy group by hozyain;"),
      { note: "Аня 2, Миша 1, Петя 1 и пустая строка 2 — «у кого хозяина нет» тоже кучка." },
      C("select vid, klichka, count(*) from pitomcy group by vid;"),
      { warn: "<b>Ловушка 4.</b> Ошибка <code>must appear in the GROUP BY clause</code>. «У собак три клички — какую из них показать в одной строке?» Правило: в <code>select</code> — только то, что в <code>group by</code>, и подсчёты." },
      C("select vid from pitomcy where count(*) > 1 group by vid;", "select vid, count(*) from pitomcy\ngroup by vid\nhaving count(*) > 1;"),
      { warn: "<b>Ловушка 5.</b> <code>where count(*) &gt; 1</code> — ошибка: <code>where</code> работает со <b>строками до</b> подсчёта, кучек ещё нет. Группы отбирает <code>having</code> — <b>после</b>. Результат: собака 3." },
      C("select vid, count(*) from pitomcy where vozrast > 2 group by vid;"),
      { note: "кот 1, кошка 1, собака 2: <code>where</code> выкинул малышей (Кешу и Шарика) <b>до</b> раскладки. Порядок слов — на доску:" },
      C("select … from … where … group by … having … order by … limit …")]],
    ["50–55", "разговор", "Мостик к занятию 13: телефон хозяина", [
      { note: "Спросить: «Нам нужен телефон Ани. Куда его записать?» Добавить столбец <code>telefon</code> в <code>pitomcy</code>? Тогда у Ани он будет в двух строках. Аня сменила номер — править в двух местах, забыли одно — у Ани два номера. А если у хозяина 10 питомцев?" },
      { note: "Не решать. «Подумайте, что с этим делать, — это тема следующего занятия. И посмотрите на свой проект: что у вас будет повторяться так же?» — это часть 3 домашки." }]],
    ["55–60", "перерыв", "Перерыв", [{ note: "Кто не дошёл до 30 героев — запустить <code>geroi.sql</code> заново." }]],
    ["60–95", "практика", "Практика 1: считаем героев · каждый сам", [
      C("ПРАКТИКА 1 · БАЗА СЧИТАЕТ САМА · занятие 12\nВсё по шагам — вкладка «Подсчёты». Сначала у всех должно быть 30 героев.\n\nСЧИТАЕМ ВСЮ ТАБЛИЦУ\n 1. Сколько всего героев?                                   → 30\n 2. Сколько магов?                                          → 8\n 3. Сколько героев в гильдии? count(gildiya)                → 22. А count(*) — 30. Почему?\n 4. Всё золото и средний уровень одним запросом\n    (средний: round(avg(uroven), 1))                        → 66409 и 52.3\n 5. Самый высокий и самый низкий уровень                    → 99 и 7\n 6. Когда зарегистрировался самый первый герой?             → 2024-08-08\n 7. Сколько героев с уровнем больше 50?                     → 16\n\nПО ГРУППАМ — group by\n 8. Сколько героев в каждом классе, больших первыми         → воин 9, маг 8, лучник 7, лекарь 6\n 9. Средний уровень в каждом классе, от высокого            → воин 60.6, маг 59.1, лекарь 44.0, лучник 41.0\n10. Сколько героев в каждой гильдии                         → 5 строк, пустая — 8. Откуда пятая?\n11. Золото каждой гильдии, без пустой, богатая первой       → Стальные волки 22200\n12. Сколько героев в сети и сколько нет                     → true 17, false 13\n13. Уровень больше 50 — сколько в каждом классе             → воин 6, маг 5, лучник 3, лекарь 2\n\nОТБОР ГРУПП — having\n14. Классы, где больше 7 героев                             → воин 9, маг 8\n15. Гильдии, где средний уровень больше 50                  → 3 строки, первая Стальные волки 73.2\n\nГотово — пишите в чат «Практика 1 готова»."),
      { warn: "<b>Ответы:</b> 1) <code>count(*)</code> · 2) <code>where klass = 'маг'</code> · 3) <code>count(gildiya)</code> не считает 8 пустых · 4) <code>sum(zoloto), round(avg(uroven), 1)</code> · 5) <code>max(uroven), min(uroven)</code> · 6) <code>min(data_registracii)</code> · 7) <code>where uroven &gt; 50</code> · 8) <code>group by klass order by count(*) desc</code> · 9) <code>round(avg(uroven), 1) as sredniy … group by klass order by sredniy desc</code> · 10) <code>group by gildiya</code>: пустая 8, Ночные тени 6, Стальные волки 6, Белые крылья 5, Звёздный круг 5 · 11) <code>where gildiya is not null group by gildiya order by sum(zoloto) desc</code>: 22200, Звёздный круг 18689, Ночные тени 14210, Белые крылья 6270 · 12) <code>group by v_seti</code> · 13) <code>where uroven &gt; 50 group by klass</code> · 14) <code>having count(*) &gt; 7</code> · 15) <code>having avg(uroven) &gt; 50</code>: 73.2, Звёздный круг 65.6, Ночные тени 58.3 (Белые крылья 43.4 и пустая 29.4 — нет). Запросы — <code>Урок_12/Ответы.md</code>." },
      { note: "Бонус на вкладке (Б1–Б4): по годам через <code>extract(year from data_registracii)</code> — 2024: 6, 2025: 17 (сходится с Д4!), 2026: 7; <code>count(distinct gildiya)</code> = 4 — <code>NULL</code> не считается; max/min по классам; <code>group by klass, gildiya having count(*) &gt;= 3</code> — 5 строк, первая маг · Звёздный круг 5." },
      { ready: "Все написали «Практика 1 готова» (или дошли до 11)" }]],
    ["95–110", "практика", "Практика 2: своя таблица", [
      C("ПРАКТИКА 2 · СВОЯ ТАБЛИЦА · 15 минут\nТаблица вашего проекта из домашки. Нет её — сначала create table + 5 строк.\n1. select count(*) from ваша_таблица;\n2. Выберите столбец, где значения повторяются, — посчитайте строки в каждой группе (group by).\n   Ничего не повторяется — добавьте строки, чтобы повторялось.\n3. Одну строку измените, одну удалите — по id. Каждый раз сначала select с тем же where.\n4. Скриншот результата group by — в чат."),
      { note: "Ходить по скриншотам: осмысленна ли группа для их проекта («сколько напоминаний у каждого пользователя», «сколько ответов на каждый вопрос»). Хорошие примеры — показать всем: это то, что будет считать их бот." },
      { ready: "Скриншоты group by своей таблицы в чате" }]],
    ["110–120", "итог", "Итог и домашка", [
      C("ЗАПОМНИТЬ · БАЗЫ ДАННЫХ · занятие 12\n• count(*) — сколько строк; count(столбец) — пустые (NULL) не считает.\n• sum, avg, min, max — сумма, среднее, меньшее, большее. round(avg(…), 1) — 1 знак.\n• as — своё имя столбца в результате. distinct — без повторов.\n• group by — разложить по кучкам и посчитать в каждой. NULL — тоже кучка.\n• В select при group by — только столбцы из group by и подсчёты.\n• where — отбирает СТРОКИ до подсчёта, having — ГРУППЫ после.\n• Порядок: select … from … where … group by … having … order by … limit …\n• update и delete — только по id и только после select с тем же where."),
      C("ДОМАШНЕЕ ЗАДАНИЕ К ЗАНЯТИЮ 13 · ~40 минут\nВсё на вкладке «Подсчёты»: " + SITE + "#sql2\nЕсли таблица героев менялась — сначала geroi.sql заново.\n\nЧАСТЬ 1. Каждый сам — запросы к героям:\n Д1. Сколько лекарей сейчас в сети?                    → 3\n Д2. Сколько золота у всех магов вместе?               → 24689\n Д3. Средний уровень героев без гильдии (до 1 знака).  → 29.4\n Д4. Сколько героев в сети в каждой гильдии?           → 5 строк, пустая — 5\n Д5. Золото каждого класса, от богатого к бедному.     → первый маг 24689\n Д6. Самый высокий уровень в каждой гильдии, без пустой. → первая Звёздный круг 99\n Д7. Классы, у которых всё золото больше 10000.        → маг, воин\n Д8. Гильдии (без пустой), где в сети 3 героя и больше. → 3 строки, первая Стальные волки 4\n Все 8 запросов — в файл podschet.sql (подпишите -- Д1, -- Д2 …) и в чат.\n\nЧАСТЬ 2. Каждый сам — своя таблица:\n Доделайте практику 2. Плюс два своих вопроса к своей таблице с count, sum или avg —\n запрос и скриншот результата в чат.\n\nЧАСТЬ 3. Командой:\n В README командного репозитория раздел «Данные»: какие таблицы нужны проекту (2–3),\n какие в них столбцы. Что в них ПОВТОРЯЕТСЯ (например, имя и телефон пользователя\n в каждом напоминании)? На занятии 13 разберём, что с этим делать.\n\nЗастряли больше 5 минут — в чат: какой запрос и какую ошибку видите."),
      { warn: "<b>Ответы Д1–Д8</b> (проверены): Д1 <code>count(*) where klass = 'лекарь' and v_seti = true</code> → 3 · Д2 <code>sum(zoloto) where klass = 'маг'</code> → 24689 · Д3 <code>round(avg(uroven), 1) where gildiya is null</code> → 29.4 · Д4 <code>where v_seti = true group by gildiya</code>: пустая 5, Стальные волки 4, Белые крылья 3, Ночные тени 3, Звёздный круг 2 · Д5 маг 24689, воин 24260, лучник 9620, лекарь 7840 · Д6 Звёздный круг 99, Стальные волки 95, Ночные тени 82, Белые крылья 71 · Д7 <code>having sum(zoloto) &gt; 10000</code> · Д8 <code>where v_seti = true and gildiya is not null group by gildiya having count(*) &gt;= 3</code>: Стальные волки 4, Белые крылья 3, Ночные тени 3." },
      { note: "После занятия очистить демо (проект <code>sql-demo</code> не удалять):" },
      C("drop table if exists pitomcy;\ndrop table if exists geroi;")]],
  ];
  // разбор практики 1 и домашки к 12 — показывать на экране в sql-demo (все результаты проверены на PostgreSQL)
  const FLOW11R = [
    ["0", "подготовка", "Герои в sql-demo", [
      { note: "Чтобы показывать живьём: в <code>sql-demo</code> → SQL Editor → вставить весь <code>Урок_10/geroi.sql</code> (или по ссылке ниже: Ctrl+A, Ctrl+C) → Run → <code>vsego_geroev 30</code>. Порядок разбора: сначала ребята говорят свой запрос, потом вы запускаете, потом — ловушка, если есть." },
      C(GEROI)]],
    ["1–4", "практика 1", "Читаем и отбираем", [
      C("select * from geroi;", "select imya, uroven from geroi;", "select * from geroi where klass = 'маг';", "select * from geroi where uroven > 50;"),
      { note: "30 · 30 (2 столбца) · 8 · 16. Под результатом Supabase пишет число строк — это и есть самопроверка. Спросить: «Почему <code>'маг'</code> в кавычках, а <code>50</code> — нет?» — текст и число." },
      { warn: "Частое: <code>where klass = маг</code> → <code>column \"маг\" does not exist</code> (без кавычек база ищет столбец); <code>'Маг'</code> → 0 строк без ошибки." }]],
    ["5–8", "практика 1", "and, or, in, NULL, like", [
      C("select imya from geroi where klass = 'маг' and uroven > 50;"),
      { note: "5: Белла, Жасмин, Нокс, Руна, Ультра. <code>and</code> — оба условия сразу." },
      C("select * from geroi where klass = 'лучник' or klass = 'лекарь';", "select * from geroi where klass in ('лучник', 'лекарь');"),
      { note: "13 и 13 — одно и то же, <code>in</code> короче." },
      C("select * from geroi where gildiya = NULL;", "select * from geroi where gildiya is null;"),
      { warn: "<b>Ловушка NULL.</b> 0 строк — и 8. «Неизвестно» не равно ничему, даже другому «неизвестно». Только <code>is null</code> / <code>is not null</code>." },
      C("select * from geroi where imya like 'А%';"),
      { note: "3: Аргон, Астра, Ангел. <code>%</code> — любые символы после «А»." }]],
    ["9–12", "практика 1", "Сортировка, даты, true/false", [
      C("select imya, zoloto from geroi order by zoloto desc limit 5;"),
      { note: "Ультра 9999, Йети 7800, Гром 5100, Нокс 4600, Ястреб 4200. Без <code>desc</code> — самые бедные. Порядок слов: <code>order by</code> всегда перед <code>limit</code>." },
      C("select imya, klass, uroven from geroi order by klass, uroven desc;"),
      { note: "Первые: Йети 95, Гром 88, Ястреб 80 — все воины. Спросить: «Почему воины первые?» — классы по алфавиту: воин, лекарь, лучник, маг. <code>desc</code> относится только к <code>uroven</code>." },
      C("select imya, data_registracii from geroi where data_registracii >= '2026-01-01';"),
      { note: "7: Зорро, Юла, Ёрш, Искра, Чешир, Эхо, Пиксель. Дата — в кавычках и всегда год-месяц-день." },
      C("select imya from geroi where gildiya = 'Стальные волки' and v_seti = true;"),
      { note: "4: Аргон, Йети, Сокол, Цезарь. <code>true</code> — без кавычек, это не текст." }]],
    ["13–16", "практика 2", "Свой герой: insert → update → delete + контроль", [
      { note: "На занятии 11 эту часть не поняли — разбирать медленно, каждый шаг запускать и смотреть результат. Главная мысль: <code>insert</code> — новая строка, а <code>update</code> и <code>delete</code> работают с теми строками, которые выбрал <code>where</code>. Поэтому сначала <code>select</code> с тем же <code>where</code>." },
      C("insert into geroi (imya, klass, uroven, zoloto, gildiya)\nvalues ('Ник', 'маг', 42, 100, NULL);", "select * from geroi where imya = 'Ник';"),
      { note: "13 → строка с <code>id</code> 31, <code>v_seti</code> = false, <code>data_registracii</code> = сегодня. Спросить: «Мы не писали <code>id</code>, <code>v_seti</code> и дату — откуда они?» — <code>id</code> ставит база, остальное — <code>default</code> из <code>create table</code>." },
      C("insert into geroi (imya, klass, uroven) values ('Ник2', 'маг', 500);", "insert into geroi (imya, klass) values ('Ник3', 'маг');"),
      { warn: "Обе — ошибки, и это хорошо: база сама защищает данные. Уровень 500 → <code>violates check constraint \"geroi_uroven_check\"</code> (правило <code>check (uroven between 1 and 100)</code>). Без уровня → <code>violates not-null constraint</code>. Excel записал бы и то и другое. Заметить: в тексте ошибки <code>Failing row contains (32, …)</code> — неудачная попытка тоже «съела» номер, следующий герой получит 33 или 34. Номера не обязаны идти подряд, и это нормально." },
      C("select * from geroi where id = 31;", "update geroi set zoloto = zoloto + 500, v_seti = true where id = 31;", "select * from geroi where id = 31;"),
      { note: "14 → золото 100 → 600, <code>v_seti</code> = true. Два столбца — через запятую в одном <code>set</code>. <code>zoloto = zoloto + 500</code>: «возьми, что было, и прибавь». Спросить: «Почему <code>where id = 31</code>, а не <code>where imya = 'Ник'</code>?» — имя может совпасть у двоих, <code>id</code> — никогда." },
      C("update geroi set gildiya = 'Белые крылья' where id = 31;"),
      { note: "15 → гильдия «Белые крылья». Можно было сделать и одним <code>update</code> вместе с золотом — тоже верно." },
      C("select * from geroi where id = 31;", "delete from geroi where id = 31;", "select count(*) from geroi;"),
      { note: "16 → снова 30. <code>delete</code> — без списка столбцов: удаляется строка целиком." },
      C("update geroi set zoloto = 0;"),
      { warn: "<b>Без <code>where</code></b> — показать и нажать <b>Cancel</b>, когда Supabase переспросит: изменились бы все 30. Если кто-то так сделал — запустить <code>geroi.sql</code> заново." },
      C("select klass, imya, uroven from geroi\nwhere uroven > 60 and gildiya is not null\norder by uroven desc limit 5;"),
      { note: "Контроль → маг Ультра 99, воин Йети 95, воин Гром 88, маг Нокс 82, воин Ястреб 80. У кого другое — таблица изменена: свой герой не удалён или был <code>update</code> без <code>where</code>." }]],
    ["Д1–Д4", "домашка", "Домашка: отбор, сортировка, даты", [
      C("select imya, zoloto from geroi\nwhere klass = 'воин' and gildiya = 'Стальные волки'\norder by zoloto desc;"),
      { note: "Д1 → Йети 7800, Гром 5100, Цезарь 1600, Аргон 1200." },
      C("select imya, uroven from geroi where v_seti = false and uroven < 30;"),
      { note: "Д2 → Ёрш 12, Зорро 23, Эхо 15. Можно и <code>where not v_seti</code> — тоже верно." },
      C("select imya, uroven from geroi order by uroven limit 3;"),
      { note: "Д3 → Пиксель 7, Ёрш 12, Эхо 15. «Самые слабые» = по уровню от меньшего, <code>desc</code> не нужен." },
      C("select * from geroi where data_registracii like '2025%';", "select * from geroi\nwhere data_registracii >= '2025-01-01' and data_registracii < '2026-01-01';", "select * from geroi where data_registracii between '2025-01-01' and '2025-12-31';"),
      { warn: "<b>Д4 — ловушка «дата не текст».</b> <code>like</code> по дате → ошибка <code>operator does not exist: date ~~ unknown</code>: <code>like</code> только для текста. Правильно — диапазоном: два последних запроса, оба → <b>17 строк</b>. «Считали строки — а на этом занятии база посчитает сама» → мостик к <code>count</code>." }]],
    ["Д5–Д8", "домашка", "Домашка: скобки, like, between", [
      C("select imya, klass from geroi where klass = 'маг' or klass = 'лекарь' and gildiya is null;", "select imya, klass from geroi where (klass = 'маг' or klass = 'лекарь') and gildiya is null;", "select imya, klass from geroi where klass in ('маг', 'лекарь') and gildiya is null;"),
      { warn: "<b>Д5 — ловушка «and сильнее or».</b> Первый запрос → <b>10</b> строк: база читает его как «все маги ИЛИ (лекари без гильдии)». Как в математике умножение раньше сложения. Нужны скобки или <code>in</code> → <b>4</b>: Искра, Чешир, Эхо, Ангел." },
      C("select imya from geroi where imya like '%а';"),
      { note: "Д6 → 9: Белла, Дана, Искра, Кира, Мира, Руна, Ультра, Юла, Астра. <code>%</code> — перед «а», значит «кончается на а»." },
      C("select imya, zoloto from geroi where zoloto between 1000 and 2000 order by zoloto;", "select imya, zoloto from geroi where zoloto >= 1000 and zoloto <= 2000;"),
      { note: "Д7 → 7: Оникс 1050 … Руна 1900. <code>between</code> включает оба края — то же, что <code>&gt;=</code> и <code>&lt;=</code>." },
      C("select imya, uroven from geroi where uroven between 20 and 30 order by uroven;"),
      { note: "Д8 → Зорро 23, Юла 26, Мира 29." }]],
    ["Д9–Д11", "домашка", "Домашка: снова NULL, ilike, самый новый", [
      { note: "Д9: сначала спросить — «сколько не из Ночных теней?» Обычно отвечают 30 − 6 = 24." },
      C("select imya, gildiya from geroi where gildiya <> 'Ночные тени';", "select imya, gildiya from geroi where gildiya <> 'Ночные тени' or gildiya is null;"),
      { warn: "<b>Д9 — NULL ещё раз.</b> Первый → <b>16</b>: 8 героев без гильдии не попали. Про них неизвестно, в «Ночных тенях» они или нет, — поэтому ни <code>=</code>, ни <code>&lt;&gt;</code> их не берут. Нужны все 24 — добавить <code>or gildiya is null</code>." },
      C("select imya from geroi where imya like '%р%';", "select imya from geroi where imya ilike '%р%';"),
      { warn: "<b>Д10.</b> <code>like</code> → 14, <code>ilike</code> → <b>15</b>. Лишний — Руна: у неё большая «Р». <code>like</code> различает большие и маленькие буквы, <code>ilike</code> — нет." },
      C("select imya, data_registracii from geroi order by data_registracii desc limit 1;"),
      { note: "Д11 → Пиксель, 2026-09-01. «Самый новый» = самая поздняя дата = сортировка от большей." }]],
    ["Своя таблица", "домашка", "Домашка, часть 2: таблица своего проекта", [
      { note: "Показать на экране 1–2 скриншота/запроса из чата (лучше разных команд). По каждому — вслух, по чек-листу:" },
      { ol: ["<code>id bigint generated always as identity primary key</code> — есть? Без него — нет ключа, строки не различить.",
        "У каждого столбца подходящий тип: дата — <code>date</code>, а не <code>text</code>; да/нет — <code>boolean</code>; количество — <code>int</code>.",
        "<code>not null</code> — на том, без чего строка бессмысленна (текст напоминания, имя).",
        "<code>default</code> — где есть естественное «по умолчанию» (<code>false</code>, <code>0</code>, <code>current_date</code>).",
        "Названия латиницей, маленькими, через <code>_</code>. Нет ли столбца «про другое» — например, телефон пользователя в таблице напоминаний? Это зацепка к занятию 13, не исправлять."] },
      C("create table napominaniya (\n  id          bigint generated always as identity primary key,\n  tekst       text    not null,\n  data        date    not null,\n  vypolneno   boolean not null default false\n);\ninsert into napominaniya (tekst, data) values\n  ('Сдать домашку по SQL', '2026-11-05');\nselect * from napominaniya;"),
      { note: "Образец с сайта — если надо показать, как работает <code>default</code>: <code>vypolneno</code> не указали, а стало <code>false</code>. После показа: <code>drop table napominaniya;</code>" }]],
  ];
  const NAPOM12 = "drop table if exists napominaniya;\ncreate table napominaniya (\n  id          bigint generated always as identity primary key,\n  tekst       text    not null,\n  kategoriya  text    not null,\n  minuty      int     not null,\n  vypolneno   boolean not null default false\n);\ninsert into napominaniya (tekst, kategoriya, minuty, vypolneno) values\n  ('Сдать домашку по SQL', 'учёба', 40, true),\n  ('Прочитать главу', 'учёба', 30, false),\n  ('Тренировка', 'спорт', 60, false),\n  ('Пробежка', 'спорт', 20, true),\n  ('Купить тетрадь', 'дела', 15, false);\nselect * from napominaniya;";
  // отметки запросов в разборе: правильный, база вернёт ошибку, выполнится, но результат неверный
  const RIGHT = (t) => ({ t, k: "ok" }), FAILS = (t) => ({ t, k: "err" }), WRONG = (t) => ({ t, k: "bad" });
  // разбор практик, бонуса и домашки к 13 — показывать на экране в sql-demo (все результаты проверены на PostgreSQL)
  const FLOW12R = [
    ["0", "подготовка", "Герои в sql-demo", [
      { note: "После занятия 12 демо очищали, поэтому сначала: <code>sql-demo</code> → SQL Editor → вставить весь <code>geroi.sql</code> (по ссылке ниже: Ctrl+A, Ctrl+C) → Run → <code>vsego_geroev 30</code>. Порядок разбора: сначала ребята говорят свой запрос, потом вы запускаете, потом — ловушка, если есть. Если у ученика числа не сходятся — в его таблице остался свой герой или был <code>update</code> без <code>where</code>: <code>geroi.sql</code> заново." },
      C(GEROI)]],
    ["Практика 0", "все вместе", "Жизнь одной строки: 30 → 31 → 31 → 30", [
      { note: "На занятии шли в ногу, поэтому здесь — коротко и по шагам. После каждого шага смотрим <code>count(*)</code>: он показывает, что сделала команда. Главная мысль: <code>insert</code> добавляет строку, <code>update</code> меняет строку, <code>delete</code> убирает строку." },
      C("select count(*) from geroi;", "insert into geroi (imya, klass, uroven, zoloto, gildiya)\nvalues ('Ник', 'маг', 42, 100, NULL);", "select count(*) from geroi;", "select * from geroi where imya = 'Ник';"),
      { note: "Шаги 1–3 → 30, потом 31, потом строка с <code>id</code> 31, <code>v_seti</code> = false и сегодняшней датой. Спросить: «Мы не писали <code>id</code>, <code>v_seti</code> и дату — откуда они?» — <code>id</code> ставит база, остальное — <code>default</code>." },
      C("select * from geroi where id = 31;", "update geroi set zoloto = zoloto + 500, v_seti = true where id = 31;", "select * from geroi where id = 31;", "update geroi set gildiya = 'Белые крылья' where id = 31;", "select count(*) from geroi;"),
      { note: "Шаг 4 → золото 100 → 600, <code>v_seti</code> = true, гильдия «Белые крылья»; <code>count(*)</code> <b>всё ещё 31</b>: <code>update</code> строк не добавляет. Спросить: «Почему по <code>id</code>, а не по имени?» — два ученика могли выбрать один ник, а <code>id</code> не повторяется." },
      C(WRONG("update geroi set zoloto = zoloto + 500 where id = 999;")),
      { warn: "<b>Чужой <code>id</code>.</b> Ошибки нет: такой строки не нашлось, ничего не изменилось. Поэтому <code>select</code> до и после обязателен: ошибка об этом не предупредит. У кого <code>id</code> не 31 — удалял и вставлял снова: номера не используются повторно." },
      C("select * from geroi where id = 31;", "delete from geroi where id = 31;", "select count(*) from geroi;"),
      { note: "Шаг 5 → снова <b>30</b>. Если у ученика не 30 — свой герой не удалён или удалено лишнее: <code>geroi.sql</code> заново." }]],
    ["1–7", "практика 1", "Считаем всю таблицу: count, sum, avg, min, max", [
      C(RIGHT("select count(*) from geroi;"), RIGHT("select count(*) from geroi where klass = 'маг';")),
      { note: "1 → 30. 2 → 8: сначала <code>where</code> отобрал, потом <code>count</code> посчитал." },
      C(RIGHT("select count(gildiya), count(*) from geroi;")),
      { warn: "<b>3</b> → 22 и 30. «Почему разница?» — <code>count(столбец)</code> не считает <code>NULL</code>, а у 8 героев гильдии нет. 30 − 22 = 8." },
      C(RIGHT("select sum(zoloto), round(avg(uroven), 1) from geroi;"), RIGHT("select max(uroven), min(uroven) from geroi;")),
      { note: "4 → 66409 и 52.3. 5 → 99 и 7. Несколько подсчётов в одном <code>select</code> — через запятую." },
      C(FAILS("select imya, max(uroven) from geroi;"), RIGHT("select imya, uroven from geroi order by uroven desc limit 1;")),
      { warn: "<b>Тянет спросить «а кто это?».</b> Первый → <code>column \"geroi.imya\" must appear in the GROUP BY clause</code>: <code>max</code> даёт одно число на всю таблицу, а имён 30. Узнать героя можно старым способом — сортировкой: второй → Ультра 99." },
      C(RIGHT("select min(data_registracii) from geroi;")),
      { note: "6 → 2024-08-08. <code>min</code> и <code>max</code> работают и с датами: самая ранняя дата — самая маленькая." },
      C(RIGHT("select count(*) from geroi where uroven > 50;"), WRONG("select count(uroven > 50) from geroi;")),
      { warn: "<b>7</b> → <b>16</b>. Второй запрос без ошибки даёт <b>30</b>: <code>count(…)</code> считает все непустые значения, а <code>uroven &gt; 50</code> для каждого героя непусто — true или false. Условие пишем в <code>where</code>." }]],
    ["8–13", "практика 1", "По группам: group by", [
      C(RIGHT("select klass, count(*) from geroi group by klass order by count(*) desc;")),
      { note: "8 → воин 9, маг 8, лучник 7, лекарь 6. Самопроверка: в сумме 30. Одна строка результата = одна кучка." },
      C(RIGHT("select klass, round(avg(uroven), 1) as sredniy from geroi\ngroup by klass\norder by sredniy desc;")),
      { note: "9 → воин 60.6, маг 59.1, лекарь 44.0, лучник 41.0." },
      C(RIGHT("select gildiya, count(*) from geroi group by gildiya order by count(*) desc;")),
      { warn: "<b>10</b> → 5 строк: пустая 8, Стальные волки 6, Ночные тени 6, Белые крылья 5, Звёздный круг 5. «Откуда пятая, если гильдий четыре?» — <code>NULL</code> тоже становится группой. Без <code>order by</code> строки могут идти в другом порядке — это не ошибка." },
      C(RIGHT("select gildiya, sum(zoloto) as vsego from geroi\nwhere gildiya is not null\ngroup by gildiya\norder by vsego desc;")),
      { note: "11 → Стальные волки 22200, Звёздный круг 18689, Ночные тени 14210, Белые крылья 6270. Без <code>where</code> будет пятая строка: пустая 5040." },
      C(RIGHT("select v_seti, count(*) from geroi group by v_seti;")),
      { note: "12 → true 17, false 13. Группировать можно и по <code>boolean</code>: кучек всего две." },
      C(RIGHT("select klass, count(*) from geroi where uroven > 50 group by klass order by count(*) desc;")),
      { note: "13 → воин 6, маг 5, лучник 3, лекарь 2. Самопроверка: 6 + 5 + 3 + 2 = 16, как в задании 7. Сначала <code>where</code> убрал слабых, потом база разложила оставшихся." }]],
    ["14–15", "практика 1", "Отбор групп: having", [
      C(RIGHT("select klass, count(*) from geroi group by klass having count(*) > 7;")),
      { note: "14 → воин 9, маг 8. Порядок строк здесь не задан и может отличаться. «Больше 7» — условие про весь класс, поэтому <code>having</code>." },
      C(RIGHT("select gildiya, round(avg(uroven), 1) from geroi group by gildiya having avg(uroven) > 50 order by 2 desc;"), "select gildiya, round(avg(uroven), 1) from geroi group by gildiya order by 2 desc;", WRONG("select gildiya, round(avg(uroven), 1) from geroi where uroven > 50 group by gildiya order by 2 desc;")),
      { warn: "<b>15</b> → Стальные волки 73.2, Звёздный круг 65.6, Ночные тени 58.3. Второй запрос показывает, кто отсеялся: Белые крылья 43.4 и пустая 29.4. <b>Третий — хитрая ошибка:</b> первая строка та же (73.2), но строк 5 и остальные средние другие: Звёздный круг 72.8, Ночные тени 72.3, Белые крылья 71.0, пустая 58.0. <code>where</code> заранее выбросил слабых героев, и считалось среднее только по сильным. Поэтому сверять надо весь результат, а не первую строку." }]],
    ["Практика 2", "практика 2", "Своя таблица: count, group by, изменить и удалить", [
      { note: "Показать 1–2 скриншота из чата. Спросить: «Какой вопрос про ваш проект задаёт эта группа?» Хорошо: «сколько напоминаний у каждого пользователя», «сколько ответов на каждый вопрос» — это будет считать их бот. Если своих примеров нет — образец, 5 строк:" },
      C(NAPOM12),
      C(RIGHT("select count(*) from napominaniya;"), RIGHT("select vypolneno, count(*) from napominaniya group by vypolneno;"), RIGHT("select kategoriya, count(*) from napominaniya group by kategoriya order by count(*) desc;")),
      { note: "Шаги 1–2 → 5 · false 3, true 2 · учёба 2, спорт 2, дела 1 (порядок равных может отличаться)." },
      C(WRONG("select tekst, count(*) from napominaniya group by tekst;")),
      { warn: "<b>Столбец без повторов:</b> в каждой из 5 групп будет 1, считать нечего. В задании на этот случай сказано: выбрать другой столбец или добавить строки, чтобы значения повторялись." },
      C("select * from napominaniya where id = 2;", RIGHT("update napominaniya set vypolneno = true where id = 2;"), "select * from napominaniya where id = 2;", "select * from napominaniya where id = 5;", RIGHT("delete from napominaniya where id = 5;"), "select count(*) from napominaniya;"),
      { note: "Шаг 3 → «Прочитать главу» стало <code>vypolneno</code> = true, «Купить тетрадь» удалена, всего 4. Проверить у учеников: и <code>update</code>, и <code>delete</code> — по <code>id</code>, перед каждым <code>select</code> с тем же <code>where</code>." },
      C("drop table napominaniya;")]],
    ["Б1–Б4", "бонус", "Бонус: годы, distinct, две группы", [
      { note: "Для тех, кто успел: пусть они и объясняют свои запросы." },
      C(RIGHT("select extract(year from data_registracii) as god, count(*) from geroi\ngroup by god\norder by god;")),
      { warn: "<b>Б1</b> → 2024: 6, 2025: 17, 2026: 7. 17 — как в Д4 прошлой домашки, там считали строки глазами. <code>extract(year from …)</code> достаёт год из даты. Если спросят: <code>group by god</code> работает, потому что PostgreSQL принимает имя из <code>as</code> в <code>group by</code> и <code>order by</code>. В <code>where</code> и <code>having</code> так нельзя." },
      C(RIGHT("select count(distinct gildiya) from geroi;"), "select distinct gildiya from geroi;"),
      { warn: "<b>Б2</b> → <b>4</b>. «Почему не 5, как в задании 10?» — <code>count(столбец)</code> не считает <code>NULL</code>, и с <code>distinct</code> тоже. Второй запрос показывает 5 строк: <code>distinct</code> сам по себе пустое значение оставляет." },
      C(RIGHT("select klass, max(uroven), min(uroven) from geroi group by klass order by klass;")),
      { note: "Б3 → воин 95 и 23, лекарь 71 и 15, лучник 78 и 7, маг 99 и 19. Сверка с заданием 5: общий максимум 99 и минимум 7 есть среди этих чисел." },
      C("select klass, gildiya, count(*) from geroi group by klass, gildiya order by count(*) desc;", RIGHT("select klass, gildiya, count(*) from geroi\ngroup by klass, gildiya\nhaving count(*) >= 3\norder by count(*) desc;")),
      { warn: "<b>Б4</b> → 5 строк: маг · Звёздный круг 5; воин · Ночные тени 4; воин · Стальные волки 4; лекарь · Белые крылья 4; лучник · пустая 3 (порядок равных может отличаться). Первый запрос показывает все 12 пар: теперь кучка — это пара «класс + гильдия». Обе колонки должны быть в <code>group by</code>: при <code>group by klass</code> → <code>column \"geroi.gildiya\" must appear in the GROUP BY clause</code>." }]],
    ["Д1–Д3", "часть 1", "Одно число на всех: count, sum, avg", [
      C(RIGHT("select count(*) from geroi where klass = 'лекарь' and v_seti = true;"), "select imya from geroi where klass = 'лекарь' and v_seti = true;"),
      { note: "Д1 → <b>3</b>: Дана, Мира, Ангел — вторым запросом видно, кого посчитали. Можно и <code>and v_seti</code> без <code>= true</code> — тоже верно. Если получилось 6 — забыто условие про сеть." },
      C(RIGHT("select sum(zoloto) from geroi where klass = 'маг';"), FAILS("select klass, sum(zoloto) from geroi where klass = 'маг';")),
      { warn: "<b>Д2</b> → <b>24689</b>. Второй запрос — ошибка <code>column \"geroi.klass\" must appear in the GROUP BY clause</code>: столбец рядом с подсчётом можно показать, только если есть <code>group by</code>. Здесь столбец и не нужен: класс уже задан в <code>where</code>." },
      C(RIGHT("select round(avg(uroven), 1) from geroi where gildiya is null;"), WRONG("select round(avg(uroven), 1) from geroi where gildiya = NULL;"), WRONG("select count(*) from geroi where gildiya = NULL;")),
      { warn: "<b>Д3 — NULL в новом виде.</b> Первый → <b>29.4</b>. Второй: нет ни ошибки, ни «0 строк», а <b>одна пустая строка</b>. Подсчёт без <code>group by</code> всегда возвращает одну строку; героев не нашлось — среднего нет. Третий → <b>0</b>: <code>count</code> в таком случае даёт ноль. Пустой результат — повод проверить <code>where</code>." }]],
    ["Д4–Д6", "часть 1", "Группы: group by и порядок слов", [
      C(RIGHT("select gildiya, count(*) from geroi\nwhere v_seti = true\ngroup by gildiya\norder by count(*) desc;"), FAILS("select gildiya, count(*) from geroi group by gildiya where v_seti = true;"), "select count(*) from geroi where v_seti = true;"),
      { warn: "<b>Д4</b> → 5 строк: пустая 5, Стальные волки 4, Белые крылья 3, Ночные тени 3, Звёздный круг 2 (порядок равных может отличаться). Пустую строку убирать не надо: в задании её не исключали, <code>NULL</code> — тоже группа. Второй запрос → <code>syntax error at or near \"where\"</code>: <code>where</code> всегда до <code>group by</code>. Самопроверка третьим запросом: 5 + 4 + 3 + 3 + 2 = <b>17</b>." },
      C(RIGHT("select klass, sum(zoloto) from geroi group by klass order by sum(zoloto) desc;"), RIGHT("select klass, sum(zoloto) as vsego from geroi group by klass order by vsego desc;"), FAILS("select klass, sum(zoloto) from geroi group by klass order by zoloto desc;")),
      { warn: "<b>Д5</b> → маг 24689, воин 24260, лучник 9620, лекарь 7840. Первые два запроса равноценны: в <code>order by</code> своё имя из <code>as</code> работает. Третий → <code>column \"geroi.zoloto\" must appear in the GROUP BY clause</code>: после группировки отдельного золота героя уже нет, есть только сумма. Спросить: «Чьё золото взять, если в группе 9 воинов?»" },
      C(RIGHT("select gildiya, max(uroven) from geroi\nwhere gildiya is not null\ngroup by gildiya\norder by max(uroven) desc;"), FAILS("select gildiya, imya, max(uroven) from geroi where gildiya is not null group by gildiya;")),
      { warn: "<b>Д6</b> → Звёздный круг 99, Стальные волки 95, Ночные тени 82, Белые крылья 71. Если вместо <code>where</code> написали <code>having gildiya is not null</code> — результат тот же, это не ошибка; но принято отсекать строки раньше, в <code>where</code>. Второй запрос → <code>column \"geroi.imya\" must appear in the GROUP BY clause</code>: ребята часто хотят увидеть и самого героя. <code>group by</code> этого не умеет — здесь не решаем, это подзапросы, позже." }]],
    ["Д7–Д8", "часть 1", "where и having: главное в этой домашке", [
      C(RIGHT("select klass, sum(zoloto) from geroi group by klass having sum(zoloto) > 10000;"), FAILS("select klass, sum(zoloto) from geroi where sum(zoloto) > 10000 group by klass;"), WRONG("select klass, sum(zoloto) from geroi where zoloto > 10000 group by klass;"), FAILS("select klass, sum(zoloto) as vsego from geroi group by klass having vsego > 10000;")),
      { warn: "<b>Д7</b> → воин 24260, маг 24689 (порядок любой). Второй → <code>aggregate functions are not allowed in WHERE</code>. Третий опаснее: <b>0 строк без ошибки</b> — он спрашивает про золото одного героя, а самый богатый имеет 9999. Четвёртый → <code>column \"vsego\" does not exist</code>: в <code>order by</code> имя из <code>as</code> работало, а в <code>having</code> — нет. Причина — порядок работы базы, можно выписать на экран: <code>from → where → group by → having → select → order by</code>. Имя появляется в <code>select</code>, поэтому <code>having</code> его ещё не знает, а <code>order by</code> уже знает." },
      C(RIGHT("select gildiya, count(*) from geroi\nwhere v_seti = true and gildiya is not null\ngroup by gildiya\nhaving count(*) >= 3\norder by count(*) desc;"), WRONG("select gildiya, count(*) from geroi\nwhere v_seti = true\ngroup by gildiya\nhaving count(*) >= 3\norder by count(*) desc;"), WRONG("select gildiya, count(*) from geroi\nwhere gildiya is not null\ngroup by gildiya\nhaving count(*) >= 3\norder by count(*) desc;"), FAILS("select gildiya, count(*) from geroi\nwhere gildiya is not null\ngroup by gildiya\nhaving v_seti = true and count(*) >= 3;")),
      { warn: "<b>Д8</b> → Стальные волки 4, Белые крылья 3, Ночные тени 3 (порядок равных может отличаться). Частые неверные варианты: второй — забыто «без пустой», 4 строки, первая пустая 5; третий — забыто «в сети», 4 строки: Стальные волки 6, Ночные тени 6, Белые крылья 5, Звёздный круг 5; четвёртый — условие про отдельного героя в <code>having</code> → <code>column \"geroi.v_seti\" must appear in the GROUP BY clause</code>. Правило: <b>про строку — в <code>where</code>, про группу — в <code>having</code></b>. Спросить про каждое условие: «Это про одного героя или про всю гильдию?»" }]],
    ["Своя таблица", "часть 2", "Два своих вопроса к таблице проекта", [
      { note: "Показать на экране 1–2 запроса со скриншотами из чата (лучше разных команд). По каждому — вслух, по чек-листу:" },
      { ol: ["Вопрос можно сказать словами, и ответ полезен проекту: «сколько напоминаний не выполнено», а не просто «<code>count(*)</code>».",
        "Функция подходит столбцу: <code>sum</code> и <code>avg</code> — только для чисел.",
        "Подсчёт имеет смысл: <code>avg(id)</code> запустится, но такое число ни о чём не говорит.",
        "Если есть <code>group by</code> — столбец с повторами. Группировка по <code>id</code> или другому уникальному столбцу даёт по 1 в каждой группе.",
        "Практика 2 доделана: <code>update</code> и <code>delete</code> — по <code>id</code>, перед ними <code>select</code> с тем же <code>where</code>."] },
      C(NAPOM12),
      { note: "Образец, если хороших запросов в чате нет или нужно показать ошибки. Результат — 5 строк." },
      C(RIGHT("select count(*) from napominaniya where vypolneno = false;"), RIGHT("select sum(minuty) from napominaniya where vypolneno = false;"), RIGHT("select kategoriya, count(*), round(avg(minuty), 1) as sredniy\nfrom napominaniya group by kategoriya order by sredniy desc;")),
      { note: "→ 3 · 105 · спорт 2 и 40.0, учёба 2 и 35.0, дела 1 и 15.0. Вопросы словами: «Сколько дел осталось? Сколько минут они займут? Какие дела в среднем самые долгие?»" },
      C(FAILS("select sum(tekst) from napominaniya;"), WRONG("select id, count(*) from napominaniya group by id;")),
      { warn: "Первый → <code>function sum(text) does not exist</code>: текст нельзя сложить. Второй запустится, но в каждой из 5 групп будет 1 — подсчитывать нечего." },
      C("drop table napominaniya;")]],
    ["README", "часть 3", "Командой: раздел «Данные»", [
      { note: "Открыть README обеих команд на экране, по очереди. Рассказывает команда, вы только задаёте вопросы. Проверить:" },
      { ol: ["Раздел «Данные» есть в README командного репозитория, а не у одного участника в личном.",
        "Названо 2–3 таблицы, и по названию понятно, про что каждая.",
        "У каждой таблицы перечислены столбцы; ясно, что будет в одной строке.",
        "Таблицы взяты из проекта команды, а не скопированы из примера про напоминания.",
        "Названо, что <b>повторяется</b>. Если не нашли — спросить: «Что придётся писать заново в каждой новой строке?»"] },
      C("## Данные\n\nnapominaniya: id, tekst, data, vypolneno, imya_polzovatelya, telefon\n\nПовторяется: imya_polzovatelya и telefon — в каждом напоминании одного человека."),
      { note: "Образец раздела — на случай, если README пуст и нужно показать, чего ждём. Ещё два вопроса к повторам команды: «Сколько строк менять, если человек сменит телефон? Что будет, если в одной строке опечататься?»" },
      { warn: "<b>Схему здесь не исправлять и новую таблицу не предлагать.</b> Это тот же вопрос, что «телефон Ани» из конца занятия 12, а ответ — тема занятия 13. Выпишите по одному повтору от каждой команды: на этих примерах и пойдёт занятие 13. Команда без раздела делает его первым делом: без него ей не на чем работать на занятии." }]],
  ];
  // занятие 13: зачем делить таблицы
  const GEROI_G = SITE + "files/geroi-gildii.sql";
  const PITOMCY13A = "drop table if exists pitomcy;\ndrop table if exists hozyaeva;\ncreate table pitomcy (\n  id bigint generated always as identity primary key,\n  klichka text not null, vid text, vozrast int, hozyain text, telefon text\n);\ninsert into pitomcy (klichka, vid, vozrast, hozyain, telefon) values\n  ('Барсик', 'кот', 3, 'Аня', '111-11-11'),\n  ('Рекс', 'собака', 5, 'Миша', '222-22-22'),\n  ('Кеша', 'попугай', 2, NULL, NULL),\n  ('Мурка', 'кошка', 7, 'Аня', '111-11-11'),\n  ('Шарик', 'собака', 1, NULL, NULL),\n  ('Граф', 'собака', 9, 'Петя', '333-33-33');\nselect * from pitomcy order by id;";
  const PITOMCY13B = "drop table if exists pitomcy;\ndrop table if exists hozyaeva;\n\ncreate table hozyaeva (\n  id      bigint generated always as identity primary key,\n  imya    text not null,\n  telefon text\n);\ninsert into hozyaeva (imya, telefon) values\n  ('Аня', '111-11-11'), ('Миша', '222-22-22'), ('Петя', '333-33-33');\n\ncreate table pitomcy (\n  id         bigint generated always as identity primary key,\n  klichka    text not null,\n  vid        text,\n  vozrast    int,\n  hozyain_id bigint references hozyaeva(id)\n);\ninsert into pitomcy (klichka, vid, vozrast, hozyain_id) values\n  ('Барсик', 'кот', 3, 1), ('Рекс', 'собака', 5, 2), ('Кеша', 'попугай', 2, NULL),\n  ('Мурка', 'кошка', 7, 1), ('Шарик', 'собака', 1, NULL), ('Граф', 'собака', 9, 3);\nselect * from pitomcy order by id;";
  const GILDII13 = "alter table gildii enable row level security;\ninsert into gildii (nazvanie, gorod) values\n  ('Стальные волки', 'Кузня'),\n  ('Звёздный круг',  'Астрал'),\n  ('Ночные тени',    'Кузня'),\n  ('Белые крылья',   'Облака');\nselect * from gildii order by id;";
  const SVYAZ = "from geroi\njoin gildii on geroi.gildiya_id = gildii.id";
  const PREP13 = [
    "Домашка к 13 проверена по чату: podschet.sql, два своих вопроса, раздел «Данные» в README обеих команд.",
    "Выбрано по одному повтору от каждой команды: с них начинается занятие и на них строится практика 2.",
    "Ученикам в чат за день: «Завтра делим таблицы. Откройте Supabase → sql-praktika: если проект Paused — нажмите Restore заранее. Домашку и раздел „Данные“ в README — до занятия».",
    "sql-demo открывается, таблиц pitomcy, hozyaeva, geroi и gildii в нём нет или их можно удалить: скрипты в ходе занятия начинаются с drop table if exists.",
    "Открыты вкладки: эта страница, sql-demo → SQL Editor, вкладка «Связи» у учеников (#sql3). На доске есть место для двух таблиц и стрелки.",
    "Ответы (оранжевые блоки) не показывать на экране. Демонстрировать окно, а не весь экран.",
  ];
  PREPS[13] = PREP13;
  const FLOW13 = [
    ["0–10", "разбор", "Домашка к занятию 13", [
      { note: "Пока все подключаются — у кого проект «Paused», жмут Restore. Разбираем не всё, а две вещи (полный разбор с запросами — вкладка «Занятие 12» → «Разбор практик, бонуса и домашки»):" },
      { ol: ["<b>Д7 и Д8:</b> «Это условие про одного героя или про всю гильдию?» Про строку — <code>where</code>, про группу — <code>having</code>.",
        "<b>Раздел «Данные»:</b> открыть README каждой команды, каждая называет один повтор. Выписать на доску: «что повторяется и сколько строк придётся менять». Не решать — сейчас к этому вернёмся."] }]],
    ["10–25", "показ", "Одна таблица: что ломается", [
      { note: "Напомнить вопрос с прошлого занятия: «Нам нужен телефон Ани. Куда его записать?» Самый простой ответ — столбец в <code>pitomcy</code>. Делаем так и смотрим, что будет:" },
      C(PITOMCY13A),
      { note: "<b>1. Повтор.</b> Один и тот же телефон хранится дважды, а если питомцев будет 10 — десять раз:" },
      C("select klichka, hozyain, telefon from pitomcy where hozyain = 'Аня' order by id;"),
      { note: "<b>2. Изменение.</b> Аня сменила номер, а поправили только одну строку. Спросить: «Какой номер настоящий?» База этого не знает." },
      C("update pitomcy set telefon = '999-99-99' where klichka = 'Барсик';", "select klichka, hozyain, telefon from pitomcy where hozyain = 'Аня' order by id;"),
      { note: "<b>3. Удаление.</b> Граф был единственным питомцем Пети. Удалили Графа — вместе с ним пропал телефон Пети: 0 строк." },
      C("delete from pitomcy where klichka = 'Граф';", "select telefon from pitomcy where hozyain = 'Петя';"),
      { note: "<b>4. Добавление.</b> Новая хозяйка Оля ещё без питомца. Записать её некуда: строка таблицы — это питомец, а кличка обязательна." },
      C(FAILS("insert into pitomcy (hozyain, telefon) values ('Оля', '444-44-44');")),
      { note: "Вывод на доску: <b>в одной таблице смешались две разные вещи — питомец и человек</b>. Отсюда все четыре проблемы. Вернуться к повторам команд: «Где у вас то же самое?»" }]],
    ["25–45", "показ", "Две таблицы и внешний ключ", [
      { note: "Нарисовать на доске две таблицы и стрелку от <code>hozyain_id</code> к <code>id</code>. Слова: <b>сущность</b> — то, о чём храним данные (питомец, хозяин); <b>атрибут</b> — её свойство (кличка, телефон); <b>первичный ключ</b> (<code>primary key</code>) — номер, по которому строка находится точно; <b>внешний ключ</b> (<code>references</code>) — столбец, в котором хранится номер строки из другой таблицы." },
      C(PITOMCY13B),
      { note: "Порядок важен: сначала <code>hozyaeva</code>, потом <code>pitomcy</code> — ссылаться можно только на то, что уже есть. У Аниных питомцев Барсика и Мурки <code>hozyain_id</code> = 1. У Кеши и Шарика — <code>NULL</code>: хозяина нет, и это разрешено." },
      { note: "<b>Один ко многим:</b> один хозяин — много питомцев, а у питомца один хозяин. Столбец-ссылка всегда в таблице «многих». Спросить: «Почему не хранить в <code>hozyaeva</code> столбец <code>pitomcy</code> со списком?» — снова ячейка «Барсик, Мурка», искать и менять неудобно." },
      { note: "Теперь те же проблемы. Новый номер Ани — в одном месте, одна строка:" },
      C("update hozyaeva set telefon = '999-99-99' where id = 1;", "insert into hozyaeva (imya, telefon) values ('Оля', '444-44-44');", "delete from pitomcy where klichka = 'Граф';", "select * from hozyaeva order by id;"),
      { note: "Оля записана без питомца, Граф удалён, а телефон Пети остался: 4 хозяина. Изменение, добавление и удаление больше не мешают друг другу." },
      { note: "<b>Внешний ключ защищает связь.</b> Попробуем её сломать:" },
      C(FAILS("insert into pitomcy (klichka, vid, vozrast, hozyain_id)\nvalues ('Тузик', 'собака', 4, 99);"), FAILS("delete from hozyaeva where id = 1;")),
      { warn: "Обе — ошибка <code>violates foreign key constraint</code>, и это хорошо. Первая: хозяина № 99 нет. Вторая: у Ани есть питомцы, они остались бы без хозяина. Excel записал бы и то и другое." }]],
    ["45–55", "показ", "join: снова вместе", [
      { note: "«Данные разделили. А как увидеть кличку рядом с телефоном?» <code>join</code> ставит рядом строки двух таблиц, <code>on</code> говорит, какие строки — пара. Читаем вслух: «номер хозяина у питомца равен номеру у хозяина»." },
      C(RIGHT("select pitomcy.klichka, hozyaeva.imya, hozyaeva.telefon\nfrom pitomcy\njoin hozyaeva on pitomcy.hozyain_id = hozyaeva.id;")),
      { note: "После удаления Графа — 3 строки: Барсик и Мурка у Ани с номером 999-99-99, Рекс у Миши. Телефон мы меняли один раз, а показан он в обеих строках Ани. Спросить: «А где Кеша и Шарик?» — <b>не отвечать</b>, это начало занятия 14. Пока: <code>join</code> показывает только строки, у которых есть пара." },
      C(RIGHT("select p.klichka, h.imya, h.telefon\nfrom pitomcy p\njoin hozyaeva h on p.hozyain_id = h.id;"), RIGHT("select p.klichka from pitomcy p\njoin hozyaeva h on p.hozyain_id = h.id\nwhere h.imya = 'Аня';")),
      { note: "Короткие имена <code>p</code> и <code>h</code> — то же самое, просто меньше букв. На практике можно писать и так, и полными именами. <code>where</code> работает как обычно: Барсик, Мурка." },
      C(FAILS("select klichka, imya from pitomcy join hozyaeva;"), FAILS("select id, klichka, imya from pitomcy\njoin hozyaeva on hozyain_id = hozyaeva.id;"), WRONG("select p.klichka, h.imya from pitomcy p\njoin hozyaeva h on p.id = h.id;")),
      { warn: "<b>Три ловушки.</b> Первая: нет <code>on</code> → <code>syntax error at or near \";\"</code>. Вторая: <code>column reference \"id\" is ambiguous</code> — <code>id</code> есть в обеих таблицах, база не знает, какой взять. <b>Третья опаснее:</b> ошибки нет, но сравниваются номер питомца и номер хозяина. Кеша без хозяина получает Петю. Поэтому читаем <code>on</code> вслух и смотрим на результат." }]],
    ["55–60", "перерыв", "Перерыв", [{ note: "Открыть вкладку «Связи» и запустить <code>geroi.sql</code>." }]],
    ["60–95", "практика", "Практика 1: гильдии отдельной таблицей · каждый сам", [
      C(SITE + "#sql3"),
      C("ПРАКТИКА 1 · ГИЛЬДИИ ОТДЕЛЬНОЙ ТАБЛИЦЕЙ · занятие 13\nВсё по шагам — вкладка «Связи». Отстали на шагах 2–6 — там есть готовый скрипт.\n\nДЕЛИМ\n 1. geroi.sql заново                                        → 30\n 2. Создайте таблицу gildii: id, nazvanie (обязательно), gorod\n 3. Заполните готовым скриптом с вкладки                    → 4 гильдии, id от 1 до 4\n 4. Столбец-ссылка: готовая команда alter table\n 5. Заполните gildiya_id четырьмя update                    → count(gildiya_id) 22, count(*) 30\n 6. Удалите старый столбец gildiya\n 7. Проверьте защиту: номер гильдии 99 и удаление гильдии 3 → две ошибки foreign key\n\nСОЕДИНЯЕМ\n 8. Герой и его гильдия                                     → 22 строки. Почему не 30?\n 9. Плюс город, по имени героя, первые 3                    → Аргон, Астра, Белла\n10. Герои Звёздного круга, сильные первыми                  → 5 строк, первая Ультра 99\n11. Сколько героев в городе Кузня                           → 12\n12. Сколько героев в каждой гильдии, большие первыми        → 4 строки, по 6, 6, 5, 5\n13. Золото каждого города, богатые первыми                  → Кузня 36410\n\nИМЯ В ОДНОМ МЕСТЕ\n14. Переименуйте гильдию 3 в «Ночные совы», запрос её героев → 6 строк с новым именем\n15. Верните название «Ночные тени»\n\nГотово — пишите в чат «Практика 1 готова»."),
      { warn: "<b>Ответы:</b> 2) как <code>id</code> в <code>geroi.sql</code>, <code>nazvanie text not null</code>, <code>gorod text</code> · 5) по одному <code>update … where gildiya = …</code>, номера 1, 2, 3, 4 · 8) <code>join gildii on geroi.gildiya_id = gildii.id</code>; 8 героев без гильдии в результат не попадают · 11) <code>where gildii.gorod = 'Кузня'</code> · 12) <code>group by gildii.nazvanie</code> · 13) <code>group by gildii.gorod</code>: 36410, Астрал 18689, Облака 6270. Запросы и ловушки — разбор ниже и <code>Урок_13/Ответы.md</code>." },
      { note: "Бонус на вкладке (Б1–Б4): без гильдии — 8, средний уровень через <code>join</code> и <code>having</code>, города с более чем 5 героями в сети — Кузня 7, новая гильдия без героев не видна в задании 12 — вопрос к занятию 14." },
      { ready: "Все написали «Практика 1 готова» (или дошли до 12)" }]],
    ["95–110", "практика", "Практика 2: повтор из своего проекта", [
      C("ПРАКТИКА 2 · СВОЙ ПРОЕКТ · 15 минут\nВозьмите повтор из раздела «Данные» в README вашей команды. Схему обсуждаете командой, запросы каждый запускает у себя.\n1. Назовите две сущности и скажите: «одна X — много Y».\n2. Создайте две таблицы: сначала X, потом Y со столбцом x_id bigint references x(id).\n3. Добавьте 2–3 строки в X и 5 строк в Y.\n4. Напишите join: строки Y рядом с данными X.\n5. Вставьте строку Y с номером 99, получите ошибку foreign key.\n6. Скриншоты запроса join и ошибки — в чат."),
      { note: "Ходить по командам. Вопросы: «Где тут один, а где много? В какой таблице столбец-ссылка? Что будет, если у человека сменится телефон?» Если сущности не выделяются — пример ниже в разборе. Хорошие примеры показать всем." },
      { ready: "Скриншоты join и ошибки в чате" }]],
    ["110–120", "итог", "Итог и домашка", [
      C("ЗАПОМНИТЬ · БАЗЫ ДАННЫХ · занятие 13\n• Если в таблице смешались две сущности, это ломает изменение, удаление и добавление. Делим на две таблицы.\n• primary key — номер строки: не пустой и не повторяется.\n• references — внешний ключ: номер строки из другой таблицы. База не даст сослаться на то, чего нет, и удалить то, на что ссылаются.\n• Один ко многим: столбец-ссылка в таблице «многих».\n• Создаём сначала таблицу, на которую ссылаемся. Удаляем — в обратном порядке.\n• join … on … — поставить рядом строки двух таблиц. Показывает только строки с парой.\n• on читаем вслух: ссылка = первичный ключ. Неверное on ошибки не даст, но результат будет неверным."),
      C("ДОМАШНЕЕ ЗАДАНИЕ К ЗАНЯТИЮ 14 · ~50 минут\nВсё на вкладке «Связи»: " + SITE + "#sql3\nТаблицы сломались — запустите geroi-gildii.sql с вкладки.\n\nЧАСТЬ 1. Каждый сам — запросы, в файл svyazi.sql (подпишите -- Д1, -- Д2 …) и в чат:\n Д1. Воины в гильдиях: имя и город, по имени.                  → 8 строк. Воинов 9 — где девятый?\n Д2. Сколько героев в сети в городе Облака?                    → 3\n Д3. Герои Ночных теней от богатого к бедному.                 → 6 строк, первый Нокс 4600\n Д4. Средний уровень в каждом городе, от высокого (1 знак).    → Кузня 65.8, Астрал 65.6, Облака 43.4\n Д5. Гильдия, её город и всё золото, богатые первыми.          → первая Стальные волки, Кузня, 22200\n Д6. Города, где больше 5 героев.                              → Кузня 12\n Д7. Найдите ошибку: join gildii on geroi.id = gildii.id.      → Сколько строк и что не так?\n\nЧАСТЬ 2. Каждый сам — пиццерия:\n Разделите таблицу заказов с вкладки на две, заполните, сделайте join и подсчёт по клиентам.\n Получите ошибку foreign key. Запросы и скриншот ошибки — в чат.\n\nЗастряли больше 5 минут — в чат: какой запрос и какую ошибку видите."),
      { warn: "<b>Ответы Д1–Д7:</b> полные запросы — разбор ниже. Д1 Оникс без гильдии · Д7 → 4 строки: сравниваются номер героя и номер гильдии, Вихрь без гильдии попадает в Ночные тени, Гром — в Белые крылья." },
      { note: "После занятия очистить демо (проект <code>sql-demo</code> не удалять). Сначала таблицы со ссылками:" },
      C("drop table if exists pitomcy;\ndrop table if exists hozyaeva;\ndrop table if exists geroi;\ndrop table if exists gildii;")]],
  ];
  // разбор практик, бонуса и домашки к 14 — выполняется сверху вниз в sql-demo (все результаты проверены на PostgreSQL)
  const FLOW13R = [
    ["0", "подготовка", "Герои в sql-demo", [
      { note: "Начинаем с чистого места: удалить старые таблицы, вставить весь <code>geroi.sql</code> (по ссылке ниже: Ctrl+A, Ctrl+C) → Run → <code>vsego_geroev 30</code>. Порядок разбора: сначала ребята говорят свой запрос, потом вы запускаете, потом — ловушка, если есть. Если у ученика числа не сходятся — ему поможет <code>geroi-gildii.sql</code>." },
      C("drop table if exists geroi;\ndrop table if exists gildii;", GEROI),
      { note: "Готовое состояние после заданий 1–6, если шаги показывать не нужно. Тогда разбор начинайте с задания 7." },
      C(GEROI_G)]],
    ["1–3", "практика 1", "Новая таблица gildii", [
      C(RIGHT("select count(*) from geroi;")),
      { note: "1 → 30." },
      C(RIGHT("create table gildii (\n  id       bigint generated always as identity primary key,\n  nazvanie text not null,\n  gorod    text\n);")),
      { note: "2. Спросить: «Почему <code>nazvanie</code> обязательно, а <code>gorod</code> нет?» — гильдия без названия бессмысленна. Первичный ключ — такой же, как в <code>geroi</code>." },
      C(GILDII13),
      { warn: "3 → 4 строки: Стальные волки 1, Звёздный круг 2, Ночные тени 3, Белые крылья 4. У кого 8 строк — вставили дважды: удалить таблицу и создать снова, иначе номера не совпадут. <code>relation \"gildii\" already exists</code> — создавал раньше: <code>drop table gildii;</code>." }]],
    ["4–6", "практика 1", "Ссылка вместо текста", [
      C(RIGHT("alter table geroi add column gildiya_id bigint references gildii(id);")),
      { note: "4. Читаем вслух: «добавь столбец, в нём номер строки из <code>gildii</code>». Подробно <code>alter table</code> — на занятии 16. Пока столбец пустой у всех." },
      C(RIGHT("update geroi set gildiya_id = 1 where gildiya = 'Стальные волки';"), RIGHT("update geroi set gildiya_id = 2 where gildiya = 'Звёздный круг';"), RIGHT("update geroi set gildiya_id = 3 where gildiya = 'Ночные тени';"), RIGHT("update geroi set gildiya_id = 4 where gildiya = 'Белые крылья';"), RIGHT("select count(gildiya_id), count(*) from geroi;")),
      { warn: "<b>5</b> → 22 и 30: как в задании 3 занятия 12, <code>count(столбец)</code> не считает пустые. Если <code>count(gildiya_id)</code> меньше 22 — опечатка в названии: <code>update</code> не нашёл строк, а ошибки не будет. Перепутан номер гильдии — найти этим запросом:" },
      C("select gildiya, gildiya_id, count(*) from geroi group by gildiya, gildiya_id order by gildiya_id;"),
      { note: "Должно быть: Стальные волки 1 — 6, Звёздный круг 2 — 5, Ночные тени 3 — 6, Белые крылья 4 — 5, пустая — 8." },
      C(RIGHT("alter table geroi drop column gildiya;"), "select imya, gildiya_id from geroi where id = 1;"),
      { note: "6 → Аргон, 1. Названия гильдии у героев больше нет, только номер. Вопрос «как увидеть название?» ведёт к заданию 8." }]],
    ["7", "практика 1", "Проверяем защиту", [
      C(FAILS("update geroi set gildiya_id = 99 where imya = 'Аргон';"), FAILS("delete from gildii where id = 3;")),
      { warn: "Обе → <code>violates foreign key constraint</code>. Первая: гильдии № 99 нет. Вторая: в гильдии 3 есть герои, они ссылались бы на пустоту. Ученику показать: если ошибки нет — столбец создан без <code>references</code>." }]],
    ["8–11", "практика 1", "Соединяем: join", [
      C(RIGHT("select geroi.imya, gildii.nazvanie " + SVYAZ + ";"), FAILS("select imya, nazvanie from geroi join gildii;"), WRONG("select geroi.imya, gildii.nazvanie from geroi\njoin gildii on geroi.id = gildii.id;")),
      { warn: "<b>8</b> → 22 строки. «Почему не 30?» — 8 героев без гильдии: у них нет пары, а <code>join</code> показывает только пары. Второй: нет <code>on</code> → синтаксическая ошибка. Третий — главная ловушка, разбирается в Д7: сравнивает номер героя с номером гильдии." },
      C(RIGHT("select geroi.imya, gildii.nazvanie, gildii.gorod " + SVYAZ + "\norder by geroi.imya limit 3;")),
      { note: "9 → Аргон, Астра, Белла. Порядок слов прежний: <code>join … on</code> сразу после <code>from</code>." },
      C(RIGHT("select geroi.imya, geroi.uroven " + SVYAZ + "\nwhere gildii.nazvanie = 'Звёздный круг'\norder by geroi.uroven desc;")),
      { note: "10 → Ультра 99, Белла 73, Жасмин 65, Руна 54, Астра 37. В <code>where</code> можно брать столбцы любой из двух таблиц." },
      C(RIGHT("select count(*) " + SVYAZ + "\nwhere gildii.gorod = 'Кузня';")),
      { note: "11 → 12: в Кузне две гильдии, по 6 героев. Раньше города в таблице героев не было, а отвечать теперь можно и на такой вопрос." }]],
    ["12–13", "практика 1", "join и group by", [
      C(RIGHT("select gildii.nazvanie, count(*) " + SVYAZ + "\ngroup by gildii.nazvanie\norder by count(*) desc;")),
      { note: "12 → Стальные волки 6, Ночные тени 6, Белые крылья 5, Звёздный круг 5 (порядок равных может отличаться). На занятии 12 было 5 строк с пустой группой, здесь 4: пустой гильдии нет пары." },
      C(RIGHT("select gildii.gorod, sum(geroi.zoloto) as vsego " + SVYAZ + "\ngroup by gildii.gorod\norder by vsego desc;")),
      { note: "13 → Кузня 36410, Астрал 18689, Облака 6270. Самопроверка: 22200 + 14210 = 36410, как две гильдии Кузни на занятии 12." }]],
    ["14–15", "практика 1", "Имя в одном месте", [
      C(RIGHT("update gildii set nazvanie = 'Ночные совы' where id = 3;"), RIGHT("select geroi.imya, gildii.nazvanie " + SVYAZ + "\nwhere gildii.id = 3;")),
      { warn: "<b>14</b> → 6 строк, у всех «Ночные совы». Изменили <b>одну</b> строку, а раньше пришлось бы менять шесть. Это и есть ответ на вопрос про телефон Ани." },
      C(RIGHT("update gildii set nazvanie = 'Ночные тени' where id = 3;")),
      { note: "15. Вернуть обязательно: на старое название опираются бонус и домашка." }]],
    ["Практика 2", "практика 2", "Свой повтор → две таблицы", [
      { note: "Показать 1–2 скриншота из чата, лучше от разных команд. По каждому — вслух, по чек-листу:" },
      { ol: ["Сказано словами: «одна X — много Y». Если выходит «много — много», это занятие 14: отметить и не решать.",
        "Столбец-ссылка в таблице «многих», тип <code>bigint</code>, есть <code>references</code>.",
        "В таблице «многих» больше нет повторяющихся данных из таблицы «один»: имя и телефон только у пользователя.",
        "<code>join … on</code> читается вслух: ссылка = первичный ключ.",
        "Ошибка <code>foreign key</code> получена, значит, защита работает."] },
      { note: "Образец, если хороших примеров в чате нет:" },
      C("drop table if exists napominaniya;\ndrop table if exists polzovateli;\ncreate table polzovateli (\n  id      bigint generated always as identity primary key,\n  imya    text not null,\n  telefon text\n);\ninsert into polzovateli (imya, telefon) values ('Аня', '111-11-11'), ('Миша', '222-22-22');\ncreate table napominaniya (\n  id            bigint generated always as identity primary key,\n  polzovatel_id bigint not null references polzovateli(id),\n  tekst         text not null,\n  data          date not null\n);\ninsert into napominaniya (polzovatel_id, tekst, data) values\n  (1, 'Сдать SQL', '2026-11-20'),\n  (1, 'Купить тетрадь', '2026-11-21'),\n  (2, 'Тренировка', '2026-11-22'),\n  (2, 'Прочитать главу', '2026-11-23'),\n  (1, 'Позвонить', '2026-11-24');\nselect * from napominaniya order by id;"),
      C(RIGHT("select polzovateli.imya, polzovateli.telefon, napominaniya.tekst\nfrom napominaniya\njoin polzovateli on napominaniya.polzovatel_id = polzovateli.id\norder by napominaniya.data;"), FAILS("insert into napominaniya (polzovatel_id, tekst, data)\nvalues (99, 'x', '2026-11-20');")),
      { note: "→ 5 строк, Аня 3 раза, Миша 2 раза, телефон в базе записан по одному разу. Вторая команда — ошибка <code>foreign key</code>. <code>not null</code> на ссылке значит: напоминания без пользователя быть не может, а питомец без хозяина быть мог. После показа:" },
      C("drop table napominaniya;\ndrop table polzovateli;")]],
    ["Б1–Б4", "бонус", "Бонус: без пары, having, новая гильдия", [
      { note: "Для тех, кто успел: пусть они и объясняют свои запросы." },
      C(RIGHT("select count(*) from geroi where gildiya_id is null;")),
      { note: "Б1 → 8. <code>join</code> здесь не нужен: ответ есть в одной таблице." },
      C(RIGHT("select gildii.nazvanie, round(avg(geroi.uroven), 1) " + SVYAZ + "\ngroup by gildii.nazvanie\nhaving avg(geroi.uroven) > 50\norder by 2 desc;")),
      { note: "Б2 → Стальные волки 73.2, Звёздный круг 65.6, Ночные тени 58.3. Те же числа, что в задании 15 занятия 12." },
      C(RIGHT("select gildii.gorod, count(*) " + SVYAZ + "\nwhere geroi.v_seti = true\ngroup by gildii.gorod\nhaving count(*) > 5;")),
      { note: "Б3 → Кузня 7. Про героя — <code>where</code>, про город целиком — <code>having</code>." },
      C("insert into gildii (nazvanie, gorod) values ('Серые плащи', 'Астрал');", RIGHT("select gildii.nazvanie, count(*) " + SVYAZ + "\ngroup by gildii.nazvanie\norder by count(*) desc;"), "delete from gildii where nazvanie = 'Серые плащи';"),
      { warn: "<b>Б4</b> → снова 4 строки: новой гильдии с нулём героев в результате нет. У неё нет пары, как у героев без гильдии. Как показать и таких — тема занятия 14. <b>Не забыть удалить гильдию</b>, иначе у ученика сдвинутся ответы." }]],
    ["Д1–Д3", "часть 1", "Домашка: join и where", [
      C(RIGHT("select geroi.imya, gildii.gorod " + SVYAZ + "\nwhere geroi.klass = 'воин'\norder by geroi.imya;")),
      { warn: "<b>Д1</b> → 8 строк: Аргон, Гром, Зорро, Йети, Тень, Хаос, Цезарь, Ястреб, все в Кузне. «Воинов 9 — где девятый?» — Оникс без гильдии, у него нет пары." },
      C(RIGHT("select count(*) " + SVYAZ + "\nwhere gildii.gorod = 'Облака' and geroi.v_seti = true;")),
      { note: "Д2 → 3: Дана, Мира, Юла." },
      C(RIGHT("select geroi.imya, geroi.zoloto " + SVYAZ + "\nwhere gildii.nazvanie = 'Ночные тени'\norder by geroi.zoloto desc;")),
      { note: "Д3 → 6 строк: Нокс 4600, Ястреб 4200, Тень 2300, Лис 2100, Хаос 700, Зорро 310." }]],
    ["Д4–Д6", "часть 1", "Домашка: join и подсчёты", [
      C(RIGHT("select gildii.gorod, round(avg(geroi.uroven), 1) as sredniy " + SVYAZ + "\ngroup by gildii.gorod\norder by sredniy desc;")),
      { note: "Д4 → Кузня 65.8, Астрал 65.6, Облака 43.4." },
      C(RIGHT("select gildii.nazvanie, gildii.gorod, sum(geroi.zoloto) as vsego " + SVYAZ + "\ngroup by gildii.nazvanie, gildii.gorod\norder by vsego desc;"), FAILS("select gildii.nazvanie, gildii.gorod, sum(geroi.zoloto) as vsego " + SVYAZ + "\ngroup by gildii.nazvanie\norder by vsego desc;")),
      { warn: "<b>Д5</b> → Стальные волки, Кузня, 22200; Звёздный круг, Астрал, 18689; Ночные тени, Кузня, 14210; Белые крылья, Облака, 6270. Второй → <code>column \"gildii.gorod\" must appear in the GROUP BY clause</code>: правило занятия 12 работает и с <code>join</code>. В <code>select</code> два столбца — оба в <code>group by</code>." },
      C(RIGHT("select gildii.gorod, count(*) " + SVYAZ + "\ngroup by gildii.gorod\nhaving count(*) > 5;")),
      { note: "Д6 → Кузня 12. Астрал и Облака — по 5, а нужно больше 5." }]],
    ["Д7", "часть 1", "Домашка: найти ошибку", [
      C(WRONG("select geroi.imya, gildii.nazvanie from geroi\njoin gildii on geroi.id = gildii.id;"), RIGHT("select geroi.imya, gildii.nazvanie " + SVYAZ + ";")),
      { warn: "<b>Д7</b> → неверный запрос даёт 4 строки: Аргон — Стальные волки, Белла — Звёздный круг, Вихрь — Ночные тени, Гром — Белые крылья. Вихрь на самом деле без гильдии, а Гром — в Стальных волках. <code>on</code> сравнивает номер героя с номером гильдии, ошибки нет, потому что оба столбца — числа. Правильно: <code>on</code> ссылка = первичный ключ, 22 строки." }]],
    ["Пиццерия", "часть 2", "Домашка: разделить заказы", [
      { note: "Показать одно решение из чата. Проблемы словами: <b>изменение</b> — Оля сменила телефон, менять в двух заказах; <b>удаление</b> — удалили единственный заказ Нины, пропал её телефон; <b>добавление</b> — клиента без заказа не записать. Образец:" },
      C("drop table if exists zakazy;\ndrop table if exists klienty;\ncreate table klienty (\n  id      bigint generated always as identity primary key,\n  imya    text not null,\n  telefon text\n);\ninsert into klienty (imya, telefon) values\n  ('Оля', '111-22-33'), ('Макс', '444-55-66'), ('Нина', '777-88-99');\ncreate table zakazy (\n  id        bigint generated always as identity primary key,\n  klient_id bigint not null references klienty(id),\n  pizza     text not null,\n  cena      int  not null,\n  data      date not null\n);\ninsert into zakazy (klient_id, pizza, cena, data) values\n  (1, 'Маргарита',   500, '2026-11-01'),\n  (2, 'Пепперони',   650, '2026-11-01'),\n  (1, 'Четыре сыра', 700, '2026-11-02'),\n  (3, 'Маргарита',   500, '2026-11-03'),\n  (2, 'Маргарита',   500, '2026-11-04');\nselect * from zakazy order by id;"),
      C(RIGHT("select klienty.imya, klienty.telefon, zakazy.pizza, zakazy.data\nfrom zakazy\njoin klienty on zakazy.klient_id = klienty.id\norder by zakazy.data;"), RIGHT("select klienty.imya, count(*), sum(zakazy.cena)\nfrom zakazy\njoin klienty on zakazy.klient_id = klienty.id\ngroup by klienty.imya\norder by sum(zakazy.cena) desc;"), FAILS("insert into zakazy (klient_id, pizza, cena, data)\nvalues (99, 'Маргарита', 500, '2026-11-05');")),
      { warn: "Join → 5 строк. Подсчёт → Оля 2 и 1200, Макс 2 и 1150, Нина 1 и 500. Третья команда — ошибка <code>foreign key</code>. <b>Если спросят про название пиццы:</b> «Маргарита» тоже повторяется, и ученик, который это заметил, прав. Пицц и заказов много с обеих сторон — это занятие 14. Сейчас можно оставить как есть." },
      C("drop table zakazy;\ndrop table klienty;")]],
  ];
  // занятие 14: left join, типы связей, многие ко многим, диаграмма Mermaid
  const GEROI_K = SITE + "files/kvesty.sql", BIBL = SITE + "files/biblioteka.sql";
  const PITOMCY14 = "drop table if exists pitomcy;\ndrop table if exists hozyaeva;\n\ncreate table hozyaeva (\n  id      bigint generated always as identity primary key,\n  imya    text not null,\n  telefon text\n);\ninsert into hozyaeva (imya, telefon) values\n  ('Аня', '111-11-11'), ('Миша', '222-22-22'), ('Петя', '333-33-33'), ('Оля', '444-44-44');\n\ncreate table pitomcy (\n  id         bigint generated always as identity primary key,\n  klichka    text not null,\n  vid        text,\n  vozrast    int,\n  hozyain_id bigint references hozyaeva(id)\n);\ninsert into pitomcy (klichka, vid, vozrast, hozyain_id) values\n  ('Барсик', 'кот', 3, 1), ('Рекс', 'собака', 5, 2), ('Кеша', 'попугай', 2, NULL),\n  ('Мурка', 'кошка', 7, 1), ('Шарик', 'собака', 1, NULL), ('Граф', 'собака', 9, 3);\nselect * from pitomcy order by id;";
  const KRUZHKI14 = "drop table if exists zapisi;\ndrop table if exists ucheniki;\ndrop table if exists kruzhki;\n\ncreate table ucheniki (\n  id   bigint generated always as identity primary key,\n  imya text not null\n);\ncreate table kruzhki (\n  id       bigint generated always as identity primary key,\n  nazvanie text not null\n);\n-- таблица-связка: одна строка = один ученик записан в один кружок\ncreate table zapisi (\n  id         bigint generated always as identity primary key,\n  uchenik_id bigint not null references ucheniki(id),\n  kruzhok_id bigint not null references kruzhki(id)\n);\n\ninsert into ucheniki (imya) values ('Аня'), ('Боря'), ('Вика'), ('Гоша');\ninsert into kruzhki (nazvanie) values ('Шахматы'), ('Робототехника'), ('Рисование'), ('Театр');\ninsert into zapisi (uchenik_id, kruzhok_id) values\n  (1, 1), (1, 2), (2, 2), (3, 1), (3, 2), (3, 3);\nselect * from zapisi order by id;";
  const KVESTY14 = "alter table kvesty enable row level security;\ninsert into kvesty (nazvanie, nagrada) values\n  ('Пещера дракона',     500),\n  ('Спасти деревню',     200),\n  ('Тёмный лес',         300),\n  ('Башня мага',         400),\n  ('Затонувший корабль', 600);\nselect * from kvesty order by id;";
  const UCHASTIE14 = "alter table uchastie enable row level security;\ninsert into uchastie (geroy_id, kvest_id) values\n  (10, 1), (20, 1), (4, 1), (5, 1),\n  (1, 2), (5, 2), (16, 2), (3, 2),\n  (12, 3), (14, 3), (20, 3),\n  (2, 4), (14, 4), (20, 4), (9, 4);\nselect count(*) from uchastie;";
  const J3 = "from uchastie\njoin geroi on uchastie.geroy_id = geroi.id\njoin kvesty on uchastie.kvest_id = kvesty.id";
  const MM_KRUZHKI = "erDiagram\n    ucheniki ||--o{ zapisi : \"записан\"\n    kruzhki ||--o{ zapisi : \"в кружке\"\n    ucheniki {\n        bigint id PK\n        text imya\n    }\n    kruzhki {\n        bigint id PK\n        text nazvanie\n    }\n    zapisi {\n        bigint id PK\n        bigint uchenik_id FK\n        bigint kruzhok_id FK\n    }";
  const MM_PITOMCY = "erDiagram\n    hozyaeva |o--o{ pitomcy : \"хозяин\"\n    hozyaeva {\n        bigint id PK\n        text imya\n        text telefon\n    }\n    pitomcy {\n        bigint id PK\n        text klichka\n        bigint hozyain_id FK\n    }";
  const MM_KVESTY = "erDiagram\n    gildii |o--o{ geroi : \"состоит\"\n    geroi ||--o{ uchastie : \"участвует\"\n    kvesty ||--o{ uchastie : \"в квесте\"\n    gildii {\n        bigint id PK\n        text nazvanie\n        text gorod\n    }\n    geroi {\n        bigint id PK\n        text imya\n        text klass\n        int uroven\n        bigint gildiya_id FK\n    }\n    kvesty {\n        bigint id PK\n        text nazvanie\n        int nagrada\n    }\n    uchastie {\n        bigint id PK\n        bigint geroy_id FK\n        bigint kvest_id FK\n    }";
  const MM_BIBL = "erDiagram\n    knigi ||--o{ knigi_avtory : \"написана\"\n    avtory ||--o{ knigi_avtory : \"написал\"\n    knigi ||--o{ vydachi : \"выдана\"\n    chitateli ||--o{ vydachi : \"взял\"\n    avtory {\n        bigint id PK\n        text imya\n    }\n    knigi {\n        bigint id PK\n        text nazvanie\n        int god\n    }\n    knigi_avtory {\n        bigint id PK\n        bigint kniga_id FK\n        bigint avtor_id FK\n    }\n    chitateli {\n        bigint id PK\n        text imya\n        text klass\n    }\n    vydachi {\n        bigint id PK\n        bigint kniga_id FK\n        bigint chitatel_id FK\n        date data_vydachi\n        date data_vozvrata\n    }";
  const PREP14 = [
    "Домашка к 14 проверена по чату: svyazi.sql (Д1–Д7), пиццерия, бонус Б1–Б4. Отмечено, кто заметил, что «Маргарита» тоже повторяется, — это вход в «многие ко многим».",
    "Ученикам в чат за день: «Завтра — типы связей. Откройте Supabase → sql-praktika: если проект Paused — нажмите Restore заранее. Домашку — до занятия».",
    "sql-demo открывается. Все скрипты в ходе занятия начинаются с drop table if exists — старые таблицы мешать не будут.",
    "Открыт mermaid.live — на нём рисуем диаграммы. Проверить, что он открывается с того интернета, откуда ведёте занятие.",
    "Открыты вкладки: эта страница, sql-demo → SQL Editor, mermaid.live, вкладка «Типы связей» у учеников (#sql4).",
    "Ответы (оранжевые блоки) и схему библиотеки не показывать на экране до разбора практики 2.",
  ];
  PREPS[14] = PREP14;
  const FLOW14 = [
    ["0–15", "разбор", "Домашка к занятию 14", [
      { note: "Пока все подключаются — у кого проект «Paused», жмут Restore. Полный разбор с запросами — вкладка «Занятие 13» → «Разбор практик, бонуса и домашки». Сегодня оттуда — четыре вещи, все ведут в новую тему:" },
      { ol: ["<b>Б4:</b> новая гильдия без героев не появилась в подсчёте. «Почему?» — у неё нет пары.",
        "<b>Д1:</b> воинов 9, а строк 8. «Где девятый?» — Оникс без гильдии, у него тоже нет пары. Вывод: <code>join</code> теряет строки без пары. Сегодня научимся их не терять.",
        "<b>Д7:</b> неверное <code>on</code> — ошибки нет, ответ неверный. Читаем <code>on</code> вслух.",
        "<b>Пиццерия:</b> «Кто заметил, что „Маргарита“ тоже повторяется?» Пицца бывает во многих заказах, а в заказе может быть много пицц. Это второй новый вопрос: связь «многие ко многим»."] }]],
    ["15–35", "показ", "left join: не терять строки без пары", [
      { note: "Питомцы и хозяева, как в конце занятия 13: у Кеши и Шарика хозяина нет, у Оли нет питомцев." },
      C(PITOMCY14),
      C("select pitomcy.klichka, hozyaeva.imya\nfrom pitomcy\njoin hozyaeva on pitomcy.hozyain_id = hozyaeva.id;", RIGHT("select pitomcy.klichka, hozyaeva.imya\nfrom pitomcy\nleft join hozyaeva on pitomcy.hozyain_id = hozyaeva.id;")),
      { note: "4 строки и 6 строк. <code>left join</code> — «все строки из левой таблицы, той, что в <code>from</code>; пара — если есть». У Кеши и Шарика в столбце хозяина <code>NULL</code>." },
      C(RIGHT("select hozyaeva.imya, pitomcy.klichka\nfrom hozyaeva\nleft join pitomcy on pitomcy.hozyain_id = hozyaeva.id;")),
      { note: "Поменяли таблицы местами — теперь «все хозяева»: 5 строк, Оля с пустым питомцем, а Кеши и Шарика нет. <b>Какая таблица в <code>from</code>, такую и показываем целиком.</b>" },
      C(RIGHT("select hozyaeva.imya\nfrom hozyaeva\nleft join pitomcy on pitomcy.hozyain_id = hozyaeva.id\nwhere pitomcy.id is null;"), WRONG("select hozyaeva.imya\nfrom hozyaeva\nleft join pitomcy on pitomcy.hozyain_id = hozyaeva.id\nwhere pitomcy.id = NULL;")),
      { warn: "<b>Кто без пары.</b> Первый → Оля: оставляем только строки, где пары не нашлось. Второй → 0 строк, без ошибки: снова ловушка <code>= NULL</code>, только <code>is null</code>." },
      C(WRONG("select hozyaeva.imya, count(*)\nfrom hozyaeva\nleft join pitomcy on pitomcy.hozyain_id = hozyaeva.id\ngroup by hozyaeva.imya;"), RIGHT("select hozyaeva.imya, count(pitomcy.id)\nfrom hozyaeva\nleft join pitomcy on pitomcy.hozyain_id = hozyaeva.id\ngroup by hozyaeva.imya;")),
      { warn: "<b>Ловушка подсчёта.</b> С <code>count(*)</code> у Оли <b>1</b>: строка-то есть, хоть и с пустым питомцем. Нужно считать питомцев: <code>count(pitomcy.id)</code> → Оля 0 (вспоминаем: <code>count(столбец)</code> не считает <code>NULL</code>). Аня 2, Миша 1, Петя 1 — порядок строк любой." }]],
    ["35–55", "показ", "Типы связей и многие ко многим", [
      { note: "На доске три типа. <b>Один ко многим</b> — уже знаем: хозяин и питомцы, гильдия и герои; ссылка в таблице «многих». <b>Один к одному</b> — редко: у ученика один пропуск, у пропуска один ученик; часто это просто столбцы той же таблицы. <b>Многие ко многим</b> — ученик ходит в несколько кружков, в кружке много учеников." },
      { note: "Спросить: «Куда записать, кто в каком кружке?» Столбец <code>kruzhok</code> у ученика — а если кружков три? Столбец <code>ucheniki</code> у кружка — «Аня, Вика» через запятую. Обе таблицы — «многие», ссылку класть некуда. <b>Ответ: третья таблица-связка</b>, одна строка = одна пара «ученик — кружок»." },
      C(KRUZHKI14),
      { note: "Связка <code>zapisi</code> — это два «один ко многим»: у ученика много записей, у кружка много записей. Вика записана в три кружка, Гоша — ни в один, в Театр — никто." },
      C(RIGHT("select ucheniki.imya, kruzhki.nazvanie\nfrom zapisi\njoin ucheniki on zapisi.uchenik_id = ucheniki.id\njoin kruzhki on zapisi.kruzhok_id = kruzhki.id\norder by ucheniki.imya;")),
      { note: "6 строк. Два <code>join</code> подряд: от связки к ученику и от связки к кружку. Начинаем со связки — у неё обе ссылки." },
      C(RIGHT("select kruzhki.nazvanie, count(zapisi.id)\nfrom kruzhki\nleft join zapisi on zapisi.kruzhok_id = kruzhki.id\ngroup by kruzhki.nazvanie\norder by count(zapisi.id) desc;"), RIGHT("select ucheniki.imya\nfrom ucheniki\nleft join zapisi on zapisi.uchenik_id = ucheniki.id\nwhere zapisi.id is null;")),
      { note: "Робототехника 3, Шахматы 2, Рисование 1, Театр 0. Без записей — Гоша. Здесь хватает двух таблиц: названия второй стороны не нужны." },
      C(WRONG("select ucheniki.imya, kruzhki.nazvanie\nfrom zapisi\njoin ucheniki on zapisi.uchenik_id = ucheniki.id\njoin kruzhki on zapisi.id = kruzhki.id;")),
      { warn: "Ловушка из Д7 в новом виде: номер записи сравнивается с номером кружка. Ошибки нет, 4 строки, Боря «в Рисовании», Вика «в Театре»." },
      C("insert into zapisi (uchenik_id, kruzhok_id) values (1, 1);", "select count(*) from zapisi where uchenik_id = 1 and kruzhok_id = 1;"),
      { note: "→ 2. Аня записана в Шахматы дважды, база не возразила. Не исправлять: «как запретить повтор пары — занятие 15»." }]],
    ["55–60", "перерыв", "Перерыв", [{ note: "Пока перерыв — открыть mermaid.live на экране." }]],
    ["60–75", "показ", "Диаграмма: рисуем схему кодом", [
      { note: "Схему удобно рисовать не руками, а текстом: Mermaid. GitHub сам рисует такую диаграмму в README, а на mermaid.live её видно сразу. Вставить на mermaid.live:" },
      C(MM_KRUZHKI),
      { note: "Разобрать по частям: прямоугольник — таблица, внутри — столбцы, <code>PK</code> — первичный ключ, <code>FK</code> — внешний. Линия — связь, на концах — сколько." },
      { ol: ["<code>||</code> — ровно один", "<code>o|</code> — ноль или один", "<code>|{</code> — один или много", "<code>o{</code> — ноль или много"] },
      { note: "Читаем вслух: «у ученика ноль или много записей, у записи ровно один ученик». Задание всем — нарисовать питомцев и хозяев. Подсказка: у питомца может не быть хозяина. Ответ:" },
      C(MM_PITOMCY),
      { warn: "<code>|o</code> со стороны хозяина: питомцу хозяин не обязателен (<code>hozyain_id</code> без <code>not null</code>). Если ученик поставил <code>||</code> — разобрать: «а Кеша?»" }]],
    ["75–100", "практика", "Практика 1: квесты героев · каждый сам", [
      C(SITE + "#sql4"),
      C("ПРАКТИКА 1 · ГЕРОИ И КВЕСТЫ · занятие 14\nВсё по шагам — вкладка «Типы связей». Отстали на шагах 2–5 — там есть готовый скрипт.\n\nДЕЛАЕМ\n 1. geroi-gildii.sql с вкладки                              → 30 и 22\n 2. Создайте kvesty: id, nazvanie (обязательно), nagrada (число, обязательно)\n 3. Заполните готовым скриптом                              → 5 квестов\n 4. Создайте связку uchastie: id, geroy_id → geroi, kvest_id → kvesty (обе обязательны)\n 5. Заполните готовым скриптом                              → 15\n 6. Проверьте защиту: квест номер 99                        → ошибка foreign key\n\nLEFT JOIN\n 7. Все герои и их гильдия, включая без гильдии             → 30 строк, у 8 пусто\n\nТРИ ТАБЛИЦЫ\n 8. Кто в каком квесте, по имени героя                      → 15 строк\n 9. Участники «Пещеры дракона», сильные первыми             → Ультра 99, Йети 95, Гром 88, Дана 41\n10. Сколько квестов у каждого участника, больше первыми     → 11 строк, первая Ультра 3\n\nLEFT JOIN И ПОДСЧЁТ\n11. Сколько участников в каждом квесте, включая пустые      → 5 строк, Затонувший корабль 0\n12. Сколько героев не участвует ни в одном квесте           → 19\n13. Сумма наград каждого героя, первые 3                    → Ультра 1200, потом Дана и Нокс по 700\n\nГотово — пишите в чат «Практика 1 готова»."),
      { warn: "<b>Ответы:</b> 4) <code>geroy_id bigint not null references geroi(id)</code>, так же <code>kvest_id</code> · 7) <code>from geroi left join gildii on geroi.gildiya_id = gildii.id</code> · 8) <code>from uchastie join geroi … join kvesty …</code> · 11) <code>from kvesty left join uchastie …</code>, <code>count(uchastie.id)</code> · 12) <code>from geroi left join uchastie … where uchastie.id is null</code> · 13) <code>sum(kvesty.nagrada)</code> по героям. Запросы и ловушки — разбор ниже и <code>Урок_14/Ответы.md</code>." },
      { note: "Бонус на вкладке: квесты Звёздного круга (четыре таблицы, ловушка <code>nazvanie</code> is ambiguous), участия по гильдиям, Ультра в Пещере дважды (вопрос к занятию 15), диаграмма питомцев." },
      { ready: "Все написали «Практика 1 готова» (или дошли до 11)" }]],
    ["100–115", "практика", "Практика 2: схема школьной библиотеки · в парах", [
      C("ПРАКТИКА 2 · СХЕМА БИБЛИОТЕКИ · в парах · 15 минут\nSQL не пишем — только схема на mermaid.live.\n\nВ библиотеке есть книги: у книги название и год издания. У книги может быть\nнесколько авторов, у автора — несколько книг. Читатели — ученики: имя и класс.\nУченик берёт книгу и потом возвращает. Библиотекарю нужно знать, у кого какая\nкнига сейчас, и историю: кто и когда брал.\n\n1. Выпишите сущности (существительные): какие будут таблицы?\n2. Для каждой пары: один к одному, один ко многим или многие ко многим?\n3. Нарисуйте диаграмму: таблицы, столбцы, PK и FK, связи.\n4. Где хранить «когда взял» и «когда вернул»?\n5. Скриншот диаграммы — в чат."),
      { note: "Ходить по парам и спрашивать, а не подсказывать: «Книга и автор — кто тут „многие“? А книга и читатель?» Хорошие диаграммы — показать всем. Ответ — после того как пары прислали скриншоты:" },
      C(MM_BIBL),
      { warn: "<b>Главное:</b> две связи «многие ко многим», и они разные. <code>knigi_avtory</code> — просто пары. <code>vydachi</code> — связка <b>со своими столбцами</b>: даты относятся не к книге и не к читателю, а к конкретной выдаче. Частые ошибки: столбец <code>avtor</code> в книге (а у «Двенадцати стульев» двое авторов), <code>kniga</code> или даты у читателя (а если он взял три книги?). Пустая <code>data_vozvrata</code> значит «ещё на руках». Дома они получат эту схему готовой в <code>biblioteka.sql</code> и сравнят со своей." }]],
    ["115–120", "итог", "Итог и домашка", [
      C("ЗАПОМНИТЬ · БАЗЫ ДАННЫХ · занятие 14\n• join показывает только пары. left join — все строки из таблицы в from, пара — если есть, иначе NULL.\n• Кто без пары: left join … where правая.id is null.\n• Считать с left join — count(правая.id), а не count(*): иначе «пустой» получит 1.\n• Связи: один к одному (редко), один ко многим (ссылка у «многих»), многие ко многим (таблица-связка).\n• Связка — это две ссылки. Запрос: от связки два join.\n• Связка может хранить и свои данные: даты выдачи книги.\n• Mermaid: || ровно один, o| ноль или один, |{ один или много, o{ ноль или много."),
      C("ДОМАШНЕЕ ЗАДАНИЕ К ЗАНЯТИЮ 15 · ~50 минут\nВсё на вкладке «Типы связей»: " + SITE + "#sql4\nТаблицы сломались — запустите kvesty.sql с вкладки.\n\nЧАСТЬ 1. Герои и квесты · каждый сам:\n Д1. В каких квестах Ультра?                                → 3: Пещера дракона, Тёмный лес, Башня мага\n Д2. Сколько участий у каждого класса героев?               → маг 7, воин 3, лучник 3, лекарь 2\n Д3. Квесты, где участников 4 и больше.                     → 3 квеста\n Д4. Сколько участий у героев без гильдии?                  → 3\n Д5. Стальные волки, которые не участвуют ни в одном квесте. → Сокол, Цезарь, Шторм\n\nЧАСТЬ 2. Школьная библиотека · каждый сам:\n Запустите biblioteka.sql с вкладки → 7 и 7.\n Сравните готовую схему со своей из практики 2: два отличия — в комментарии.\n Д6. Книги на руках: книга, читатель, дата, с давних.        → 4 строки, первая Война и мир, Вика\n Д7. Авторы каждой книги, по названию.                      → 8 строк. У каких книг два автора?\n Д8. Книга без автора.                                      → Энциклопедия школьника\n Д9. Сколько раз брали каждую книгу, включая ни разу.       → 7 строк, Энциклопедия 0\n Д10. Кто ни разу не брал книг.                             → Дина\n\nВсё — в файл svyazi2.sql (подпишите -- Д1 …) и в чат.\nЗастряли больше 5 минут — в чат: какой запрос и какую ошибку видите."),
      { warn: "<b>Ответы Д1–Д10:</b> полные запросы — разбор ниже и <code>Урок_14/Ответы.md</code>. Ловушки: Д9 <code>count(*)</code> даёт Энциклопедии 1; Д6 <code>data_vozvrata = NULL</code> даёт 0 строк." },
      { note: "После занятия очистить демо (проект <code>sql-demo</code> не удалять). Сначала таблицы со ссылками:" },
      C("drop table if exists pitomcy;\ndrop table if exists hozyaeva;\ndrop table if exists zapisi;\ndrop table if exists ucheniki;\ndrop table if exists kruzhki;\ndrop table if exists uchastie;\ndrop table if exists kvesty;\ndrop table if exists geroi;\ndrop table if exists gildii;")]],
  ];
  // разбор практик, бонуса и домашки к 15 — выполняется сверху вниз в sql-demo (все результаты проверены на PostgreSQL)
  const FLOW14R = [
    ["0", "подготовка", "Герои и гильдии в sql-demo", [
      { note: "Начинаем с чистого места: удалить квесты, вставить весь <code>geroi-gildii.sql</code> (по ссылке ниже) → Run → <code>30 и 22</code>. Порядок разбора: сначала ребята говорят свой запрос, потом вы запускаете, потом — ловушка, если есть." },
      C("drop table if exists uchastie;\ndrop table if exists kvesty;", GEROI_G),
      { note: "Готовое состояние после заданий 1–5, если шаги показывать не нужно. Тогда разбор начинайте с задания 6." },
      C(GEROI_K)]],
    ["1–3", "практика 1", "Таблица kvesty", [
      C(RIGHT("select count(*), count(gildiya_id) from geroi;")),
      { note: "1 → 30 и 22. Файл ставит всё заново, в том числе убирает «Серые плащи», если кто-то не удалил их в бонусе занятия 13." },
      C(RIGHT("create table kvesty (\n  id       bigint generated always as identity primary key,\n  nazvanie text not null,\n  nagrada  int  not null\n);"), KVESTY14),
      { note: "2–3 → 5 квестов, номера 1–5. У кого 10 строк — вставил дважды: <code>kvesty.sql</code>." }]],
    ["4–6", "практика 1", "Связка uchastie", [
      C(RIGHT("create table uchastie (\n  id       bigint generated always as identity primary key,\n  geroy_id bigint not null references geroi(id),\n  kvest_id bigint not null references kvesty(id)\n);")),
      { note: "4. Спросить: «Почему обе ссылки <code>not null</code>?» — участие без героя или без квеста бессмысленно. Сравнить с <code>gildiya_id</code>, где пустое значение разрешено." },
      C(UCHASTIE14),
      { note: "5 → 15. Ультра (20) — в трёх квестах, Затонувший корабль (5) — ни у кого." },
      C(FAILS("insert into uchastie (geroy_id, kvest_id) values (1, 99);")),
      { note: "6 → <code>violates foreign key constraint</code>: квеста 99 нет." }]],
    ["7", "практика 1", "left join: все герои", [
      C(RIGHT("select geroi.imya, gildii.nazvanie\nfrom geroi\nleft join gildii on geroi.gildiya_id = gildii.id;"), WRONG("select geroi.imya, gildii.nazvanie\nfrom gildii\nleft join geroi on geroi.gildiya_id = gildii.id;")),
      { warn: "<b>7</b> → 30 строк, у 8 героев гильдия пустая. Второй запрос — таблицы поменяли местами: теперь «все гильдии», 22 строки, герои без гильдии опять пропали. Какая таблица в <code>from</code>, такую и показываем целиком." }]],
    ["8–10", "практика 1", "Три таблицы", [
      C(RIGHT("select geroi.imya, kvesty.nazvanie\n" + J3 + "\norder by geroi.imya;"), FAILS("select imya, nazvanie\nfrom geroi\njoin uchastie on uchastie.geroy_id = geroi.id;"), WRONG("select geroi.imya, kvesty.nazvanie\nfrom uchastie\njoin geroi on uchastie.geroy_id = geroi.id\njoin kvesty on uchastie.id = kvesty.id;")),
      { warn: "<b>8</b> → 15 строк. Второй — забыт второй <code>join</code>: <code>column \"nazvanie\" does not exist</code>, названия квеста в этих таблицах нет. Третий — снова неверное <code>on</code>: 5 строк, номер участия сравнивается с номером квеста." },
      C(RIGHT("select geroi.imya, geroi.uroven\n" + J3 + "\nwhere kvesty.nazvanie = 'Пещера дракона'\norder by geroi.uroven desc;")),
      { note: "9 → Ультра 99, Йети 95, Гром 88, Дана 41." },
      C(RIGHT("select geroi.imya, count(*)\nfrom uchastie\njoin geroi on uchastie.geroy_id = geroi.id\ngroup by geroi.imya\norder by count(*) desc;")),
      { note: "10 → 11 строк: Ультра 3, Дана 2, Нокс 2, остальные по 1. Таблица <code>kvesty</code> здесь не нужна: считаем строки связки. Можно и с тремя таблицами — ответ тот же." }]],
    ["11–13", "практика 1", "left join и подсчёт", [
      C(RIGHT("select kvesty.nazvanie, count(uchastie.id)\nfrom kvesty\nleft join uchastie on uchastie.kvest_id = kvesty.id\ngroup by kvesty.nazvanie\norder by count(uchastie.id) desc;"), WRONG("select kvesty.nazvanie, count(*)\nfrom kvesty\nleft join uchastie on uchastie.kvest_id = kvesty.id\ngroup by kvesty.nazvanie\norder by count(*) desc;"), WRONG("select kvesty.nazvanie, count(*)\nfrom kvesty\njoin uchastie on uchastie.kvest_id = kvesty.id\ngroup by kvesty.nazvanie;")),
      { warn: "<b>11</b> → Спасти деревню 4, Пещера дракона 4, Башня мага 4, Тёмный лес 3, Затонувший корабль <b>0</b>. Второй — <code>count(*)</code>: у Затонувшего корабля 1. Третий — обычный <code>join</code>: Затонувшего корабля нет совсем, 4 строки." },
      C(RIGHT("select count(*)\nfrom geroi\nleft join uchastie on uchastie.geroy_id = geroi.id\nwhere uchastie.id is null;")),
      { note: "12 → 19. Самопроверка: в квестах 11 разных героев, 30 − 11 = 19. Здесь <code>count(*)</code> верен: считаем строки, оставшиеся после <code>where</code>." },
      C(RIGHT("select geroi.imya, sum(kvesty.nagrada) as nagrady\n" + J3 + "\ngroup by geroi.imya\norder by nagrady desc\nlimit 3;")),
      { note: "13 → Ультра 1200 (500 + 300 + 400), Дана 700, Нокс 700. Дана и Нокс могут идти в любом порядке." }]],
    ["Б1–Б3", "бонус", "Бонус: четыре таблицы и повтор пары", [
      C(FAILS("select geroi.imya, nazvanie\n" + J3 + "\njoin gildii on geroi.gildiya_id = gildii.id;"), RIGHT("select geroi.imya, kvesty.nazvanie\n" + J3 + "\njoin gildii on geroi.gildiya_id = gildii.id\nwhere gildii.nazvanie = 'Звёздный круг'\norder by geroi.imya;")),
      { warn: "<b>Б1</b> → 4 строки: Белла — Башня мага, Ультра — три квеста. Первый → <code>column reference \"nazvanie\" is ambiguous</code>: <code>nazvanie</code> есть и у гильдии, и у квеста. Четыре таблицы — это три <code>join</code> подряд." },
      C(RIGHT("select gildii.nazvanie, count(*)\nfrom uchastie\njoin geroi on uchastie.geroy_id = geroi.id\njoin gildii on geroi.gildiya_id = gildii.id\ngroup by gildii.nazvanie\norder by count(*) desc;")),
      { note: "Б2 → Звёздный круг 4, Стальные волки 3, Ночные тени 3, Белые крылья 2. Вместе 12, ещё 3 участия — у героев без гильдии (это Д4)." },
      C("insert into uchastie (geroy_id, kvest_id) values (20, 1);", "select count(*) from uchastie where geroy_id = 20 and kvest_id = 1;", "delete from uchastie where id > 15;"),
      { warn: "<b>Б3</b> → 2: база разрешила записать Ультру в Пещеру дважды. Как это запретить — занятие 15. Удалить лишнюю строку обязательно, иначе разъедутся ответы домашки." },
      { note: "Б4 — диаграмма питомцев на mermaid.live, ответ — в ходе занятия, блок 60–75." }]],
    ["Практика 2", "практика 2", "Схема библиотеки", [
      { note: "Показать 2–3 скриншота из чата и сравнить с ответом. Ответ — в ходе занятия, блок 100–115, там же частые ошибки. Дома ученики загружают эту схему из <code>biblioteka.sql</code> и сравнивают со своей." },
      C(MM_BIBL)]],
    ["Д1–Д5", "часть 1", "Домашка: герои и квесты", [
      C(RIGHT("select kvesty.nazvanie\n" + J3 + "\nwhere geroi.imya = 'Ультра';")),
      { note: "Д1 → Пещера дракона, Тёмный лес, Башня мага." },
      C(RIGHT("select geroi.klass, count(*)\nfrom uchastie\njoin geroi on uchastie.geroy_id = geroi.id\ngroup by geroi.klass\norder by count(*) desc;")),
      { note: "Д2 → маг 7, воин 3, лучник 3, лекарь 2. Это участия, а не герои: Ультра даёт магам 3." },
      C(RIGHT("select kvesty.nazvanie, count(*)\nfrom uchastie\njoin kvesty on uchastie.kvest_id = kvesty.id\ngroup by kvesty.nazvanie\nhaving count(*) >= 4;")),
      { note: "Д3 → Пещера дракона, Спасти деревню, Башня мага, по 4. Порядок любой." },
      C(RIGHT("select count(*)\nfrom uchastie\njoin geroi on uchastie.geroy_id = geroi.id\nwhere geroi.gildiya_id is null;")),
      { note: "Д4 → 3: Вихрь, Пиксель, Искра. Сходится с Б2: 15 − 12 = 3." },
      C(RIGHT("select geroi.imya\nfrom geroi\njoin gildii on geroi.gildiya_id = gildii.id\nleft join uchastie on uchastie.geroy_id = geroi.id\nwhere gildii.nazvanie = 'Стальные волки' and uchastie.id is null\norder by geroi.imya;")),
      { warn: "<b>Д5</b> → Сокол, Цезарь, Шторм. Обычный <code>join</code> к гильдии и <code>left join</code> к участию в одном запросе — так можно. Условие на гильдию в <code>where</code> здесь безопасно: гильдия — не та таблица, где мы ищем пропуски." }]],
    ["Д6–Д10", "часть 2", "Домашка: библиотека", [
      C(BIBL),
      { note: "Загрузить <code>biblioteka.sql</code> → 7 и 7. Сначала спросить, какие отличия от своей схемы нашли." },
      C(RIGHT("select knigi.nazvanie, chitateli.imya, vydachi.data_vydachi\nfrom vydachi\njoin knigi on vydachi.kniga_id = knigi.id\njoin chitateli on vydachi.chitatel_id = chitateli.id\nwhere vydachi.data_vozvrata is null\norder by vydachi.data_vydachi;"), WRONG("select knigi.nazvanie, chitateli.imya\nfrom vydachi\njoin knigi on vydachi.kniga_id = knigi.id\njoin chitateli on vydachi.chitatel_id = chitateli.id\nwhere vydachi.data_vozvrata = NULL;")),
      { warn: "<b>Д6</b> → Война и мир — Вика, Незнайка на Луне — Аня, Золотой телёнок — Боря, Двенадцать стульев — Гоша. С <code>= NULL</code> — 0 строк без ошибки." },
      C(RIGHT("select knigi.nazvanie, avtory.imya\nfrom knigi_avtory\njoin knigi on knigi_avtory.kniga_id = knigi.id\njoin avtory on knigi_avtory.avtor_id = avtory.id\norder by knigi.nazvanie;")),
      { note: "Д7 → 8 строк. Два автора у «Двенадцати стульев» и «Золотого телёнка»: Ильф и Петров. Энциклопедии в результате нет — у неё нет пары, это Д8." },
      C(RIGHT("select knigi.nazvanie\nfrom knigi\nleft join knigi_avtory on knigi_avtory.kniga_id = knigi.id\nwhere knigi_avtory.id is null;")),
      { note: "Д8 → Энциклопедия школьника." },
      C(RIGHT("select knigi.nazvanie, count(vydachi.id)\nfrom knigi\nleft join vydachi on vydachi.kniga_id = knigi.id\ngroup by knigi.nazvanie\norder by count(vydachi.id) desc;"), WRONG("select knigi.nazvanie, count(*)\nfrom knigi\nleft join vydachi on vydachi.kniga_id = knigi.id\ngroup by knigi.nazvanie;")),
      { warn: "<b>Д9</b> → 7 строк: Двенадцать стульев 2, Энциклопедия школьника 0, остальные по 1. С <code>count(*)</code> у Энциклопедии 1 — та же ловушка, что на показе с Олей." },
      C(RIGHT("select chitateli.imya\nfrom chitateli\nleft join vydachi on vydachi.chitatel_id = chitateli.id\nwhere vydachi.id is null;")),
      { note: "Д10 → Дина." }]],
  ];
  const FLOWS = { 8: FLOW8, 11: FLOW11, "11r": FLOW11R, 12: FLOW12, "12r": FLOW12R, 13: FLOW13, "13r": FLOW13R, 14: FLOW14, "14r": FLOW14R };
  const MARK_TEXT = { ok: "✓ Правильно", err: "✗ Ошибка: база не выполнит запрос", bad: "✗ Неверно: ошибки не будет, но результат не тот" };
  let cmdN = 0;
  function renderFlow(l) {
    const FLOW = FLOWS[l];
    $("flowNav-" + l).innerHTML = FLOW.map((b, i) => "<a href='#fl" + l + "-" + i + "'>" + b[0] + "</a>").join("") + ($("problems-" + l) ? "<a href='#problems-" + l + "'>Проблемы</a>" : "");
    $("flow-" + l).innerHTML = FLOW.map((b, i) => "<div class='fl-block' id='fl" + l + "-" + i + "'><div class='fl-time'>" + b[0] + "<small>" + esc(b[1]) + "</small></div><div class='fl-body'><b>" + esc(b[2]) + "</b>" +
      b[3].map((x) => {
        if (x.cmd) return "<div class='fl-cmds'>" + x.cmd.map((c) => { const id = cmdN++; const m = typeof c === "string" ? null : c; return "<button type='button' class='fl-cmd" + (m ? " m-" + m.k : "") + (copied.has(id) ? " done" : "") + "' data-c='" + id + "'>" + (m ? "<b class='fl-mark'>" + MARK_TEXT[m.k] + "</b>" : "") + "<code>" + esc(m ? m.t : c) + "</code><span>" + (copied.has(id) ? "скопировано" : "копировать") + "</span></button>"; }).join("") + "</div>";
        if (x.ol) return "<ol>" + x.ol.map((t) => "<li>" + t + "</li>").join("") + "</ol>";
        if (x.warn) return "<div class='note'>" + x.warn + "</div>";
        if (x.ready) return "<span class='fl-ready'>" + esc(x.ready) + "</span>";
        return "<div class='muted'>" + x.note + "</div>";
      }).join("") + "</div></div>").join("");
    $("flow-" + l).querySelectorAll(".fl-cmd").forEach((btn) => (btn.onclick = () => {
      const code = btn.querySelector("code"), text = code.textContent;
      const done = () => { copied.add(+btn.dataset.c); btn.classList.add("done"); btn.querySelector("span").textContent = "скопировано"; };
      const sel = () => { const r = document.createRange(); r.selectNodeContents(code); const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); btn.querySelector("span").textContent = "Cmd+C"; };
      try { navigator.clipboard.writeText(text).then(done, sel); } catch (e) { sel(); }
    }));
  }

  // ---------- результаты опросов ----------
  let allAnswers = [];
  let resSession = null;
  const fmtDate = (t) => new Date(t).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  function sessionsList() {
    const m = {};
    allAnswers.forEach((e) => {
      const s = e.payload.s;
      if (!m[s]) m[s] = { id: s, start: e.created_at, keys: new Set() };
      m[s].keys.add(e.key);
    });
    return Object.values(m).sort((a, b) => (a.start < b.start ? 1 : -1));
  }
  function renderResults() {
    const box = $("results");
    const list = sessionsList();
    if (!list.length) { box.innerHTML = "<div class='muted'>Опросов с ответами пока не было.</div>"; return; }
    if (!resSession || !list.some((x) => x.id === resSession)) resSession = list[0].id;
    const cur = list.find((x) => x.id === resSession);
    // последний ответ каждого ученика на каждый вопрос
    const last = {};
    allAnswers.forEach((e) => { if (e.payload.s === resSession) (last[e.key] = last[e.key] || {})[e.payload.q] = e.payload.a; });
    const known = byKey();
    const keys = pupils.filter((p) => p.key && last[p.key]).map((p) => p.key)
      .concat(Object.keys(last).filter((k) => !known[k]));
    const L = "АБВГДЕ";
    let h = "<div class='res-top'><select id='resSel'>" + list.map((x) =>
      "<option value='" + esc(x.id) + "'" + (x.id === resSession ? " selected" : "") + ">" + esc(fmtDate(x.start)) + " · ответили " + x.keys.size + "</option>").join("") +
      "</select>" + (quiz.session === resSession ? "<span class='muted'>идёт сейчас</span>" : "") +
      "<button class='btn mini' id='resDel' style='margin-left:auto'>удалить этот опрос</button></div>";
    // считаем баллы и сортируем: больше верных → меньше ошибок → по алфавиту
    const perQ = QZ.map(() => ({ ok: 0, n: 0 }));
    const rows = keys.map((k) => {
      let ok = 0, n = 0;
      QZ.forEach((q, i) => {
        const a = last[k][i];
        if (a === undefined || q.correct === null) return;
        n++; perQ[i].n++;
        if (a === q.correct) { ok++; perQ[i].ok++; }
      });
      const p = known[k];
      return { k: k, p: p, ok: ok, n: n, name: p ? p.name : "яяя" };
    }).sort((a, b) => b.ok - a.ok || (a.n - a.ok) - (b.n - b.ok) || a.name.localeCompare(b.name, "ru"));
    h += "<table class='res'><tr><th>Место</th><th>Ученик</th>" + QZ.map((q, i) => "<th title='" + esc(q.text) + "'>" + (i + 1) + "</th>").join("") + "<th>Итог</th></tr>";
    let place = 0, prev = null;
    rows.forEach((r, idx) => {
      const sig = r.ok + "/" + (r.n - r.ok);
      if (sig !== prev) { place = idx + 1; prev = sig; }
      const medal = place === 1 ? " 🥇" : place === 2 ? " 🥈" : place === 3 ? " 🥉" : "";
      h += "<tr><td><b>" + place + "</b>" + medal + "</td><td style='text-align:left'>" + (r.p ? esc(r.p.name) : "<span class='muted'>удалённый ученик</span>") + "</td>";
      QZ.forEach((q, i) => {
        const a = last[r.k][i];
        if (a === undefined) { h += "<td class='v'>·</td>"; return; }
        if (q.correct === null) { h += "<td class='v'>" + L[a] + "</td>"; return; }
        if (a === q.correct) h += "<td class='y' title='" + esc(GitQuiz.optionsOf(q)[a]) + "'>✔</td>";
        else h += "<td class='n' title='Ответил: " + esc(GitQuiz.optionsOf(q)[a]) + "'>" + L[a] + "</td>";
      });
      h += "<td><b>" + r.ok + "</b> из " + r.n + "</td></tr>";
    });
    h += "<tr class='pct'><td></td><td style='text-align:left'>верно, %</td>" + QZ.map((q, i) => {
      if (q.correct === null || !perQ[i].n) return "<td>—</td>";
      const pc = Math.round((perQ[i].ok / perQ[i].n) * 100);
      return "<td class='" + (pc < 60 ? "low" : "") + "'>" + pc + "</td>";
    }).join("") + "<td></td></tr></table>";
    const graded = QZ.map((q, i) => ({ q: q, i: i, pc: perQ[i].n ? Math.round((perQ[i].ok / perQ[i].n) * 100) : 100 })).filter((x) => x.q.correct !== null);
    const minPc = Math.min.apply(null, graded.map((x) => x.pc));
    const weak = graded.filter((x) => x.pc < 60 || (x.pc === minPc && x.pc < 100));
    h += weak.length
      ? "<p class='lead' style='margin-top:10px'><b>" + (minPc < 60 ? "Повторить на следующем занятии" : "Слабее всего") + ":</b> " + weak.map((x) => "№" + (x.i + 1) + " «" + esc(x.q.text) + "» — " + x.pc + "%").join("; ") + "</p>"
      : "<p class='lead' style='margin-top:10px'>Все вопросы решены без ошибок.</p>";
    h += "<p class='muted' style='font-size:12px'>✔ — верно, буква — неверный ответ (наведите, чтобы увидеть текст), · — не ответил.</p>";
    box.innerHTML = h;
    $("resSel").onchange = (e) => { resSession = e.target.value; renderResults(); };
    $("resDel").onclick = async () => {
      if (!confirm("Удалить все ответы опроса от " + fmtDate(cur.start) + "? Это нельзя отменить. Удобно для репетиций.")) return;
      await rest("git_events?kind=eq.answer&payload->>s=eq." + encodeURIComponent(resSession), { method: "DELETE" });
      allAnswers = allAnswers.filter((e) => e.payload.s !== resSession);
      resSession = null;
      renderResults(); loadAnswers();
    };
  }
  async function loadAllAnswers() {
    allAnswers = await rest("git_events?select=key,payload,created_at&kind=eq.answer&order=created_at.asc&limit=20000");
  }

  async function loadEvents() {
    events = await rest("git_events?select=key,kind,payload,created_at&kind=in.(level,check)&order=created_at.asc&limit=10000");
  }
  let timer = null;
  async function tick() {
    if (!session || document.hidden) return;
    try {
      if (quiz.session) await loadAnswers();
      await loadEvents();
      const active = document.activeElement;
      // Не перерисовывать, только пока руководитель печатает в поле таблицы.
      const typing = active && active.tagName === "INPUT" && active.type !== "checkbox" && active.closest && active.closest("#pupils");
      if (!typing) renderPupils();
      await loadAllAnswers();
      if (!(active && active.id === "resSel")) renderResults();
    } catch (e) { /* сеть моргнула — попробуем в следующий раз */ }
  }
  async function start() {
    const [ps, kv, qz] = await Promise.all([
      rest("git_pupils?select=*&order=team.asc,sort.asc,name.asc"),
      rest("git_teacher_kv?select=*&key=in.(" + Object.keys(PREPS).map((l) => "prep" + l).join(",") + ",sent)"),
      rest("git_quiz?select=session,q,revealed&id=eq.1"),
    ]);
    pupils = ps;
    const kvOf = (k) => { const r = kv.find((x) => x.key === k); return (r && r.value) || []; };
    Object.keys(PREPS).forEach((l) => (prepDone[l] = kvOf("prep" + l)));
    sentMarks = kvOf("sent");
    if (qz[0]) quiz = qz[0];
    await loadEvents();
    await loadAnswers();
    $("who").textContent = session.email;
    $("login").hidden = true;
    $("app").hidden = false;
    await loadAllAnswers();
    renderPupils(); cmdN = 0; Object.keys(PREPS).forEach(renderPrep); Object.keys(FLOWS).forEach(renderFlow); renderLive(); renderResults();
    status(pupils.length ? "Учеников: " + pupils.length : "Список пуст — добавьте учеников ниже.");
    clearInterval(timer);
    timer = setInterval(tick, 3000);
  }

  if (session) start().catch((e) => { if (e.message !== "idle" && e.message !== "401") showLogin("Не удалось загрузить: " + e.message); });
  else showLogin("");
})();
