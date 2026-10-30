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
  const TABS = ["pupils", "l8", "l11"];
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
  const PREPS = { 8: PREP8, 11: PREP11 };
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
      { note: "«Мышкой удобно, пока строк три. Когда тысяча, а вопрос — „все собаки старше 4 лет без хозяина“ — нужен SQL»." }]],
    ["30–45", "показ", "SQL Editor: SELECT, WHERE, ORDER BY, INSERT, UPDATE, DELETE", [
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
    ["45–48", "показ", "geroi.sql и как устроена практика", [
      { note: "Новый запрос → вставить весь <code>geroi.sql</code> → Run → <code>vsego_geroev 30</code>. Пройти по <code>create table</code>: <code>generated always as identity primary key</code> — номер ставит база; <code>not null</code> — обязательно; <code>check (uroven between 1 and 100)</code> — уровень 500 не запишется; <code>default 0</code>; <code>drop table if exists</code> — <b>сломали героев → запустите скрипт заново</b>." },
      C(GEROI),
      { note: "Ссылку — в чат (открывается как текст: Ctrl+A, Ctrl+C). Или отправить файл <code>Урок_10/geroi.sql</code>. В каждом задании написано, сколько строк должно выйти, — это самопроверка." }]],
    ["48–53", "перерыв", "Перерыв", [{ note: "Кто не успел создать проект — доделать в перерыв." }]],
    ["53–93", "практика", "Практика 1: запросы к героям · каждый в своём sql-praktika", [
      C("ПРАКТИКА · БАЗЫ ДАННЫХ · занятие 11\n\n0. Supabase → проект sql-praktika → SQL Editor → New query.\n   Вставить ВЕСЬ текст geroi.sql → Run. Внизу: vsego_geroev 30.\n   " + GEROI + "\n   Каждое задание — новый запрос или выделить нужную строку и Run.\n   Сломали таблицу — запустите geroi.sql заново.\n\nТаблица geroi: id, imya, klass, uroven, zoloto, gildiya, v_seti, data_registracii\nКлассы: воин, маг, лучник, лекарь.\nГильдии: Стальные волки, Звёздный круг, Ночные тени, Белые крылья (или пусто).\n\n 1. Все герои, все столбцы.                                → 30 строк\n 2. Только имя и уровень всех героев.                      → 30 строк, 2 столбца\n 3. Все маги.                                              → 8 строк\n 4. Герои с уровнем больше 50.                             → 16 строк\n 5. Маги с уровнем больше 50.                              → 5 строк\n 6. Лучники и лекари (через or и через in).                → 13 строк\n 7. Герои без гильдии.                                     → 8 строк\n    (а что выйдет с  where gildiya = NULL ? почему?)\n 8. Герои, чьё имя начинается на «А».                      → 3 строки\n 9. 5 самых богатых героев (имя и золото).                 → первый — Ультра, 9999\n10. Все герои: по классу, внутри — от высокого уровня.     → первые: Йети, Гром, Ястреб\n11. Зарегистрировались в 2026 году или позже\n    (дата пишется так: '2026-01-01').                      → 7 строк\n12. Кто из «Стальных волков» сейчас в сети? (v_seti = true) → 4 строки\n13. Уровень от 20 до 30 включительно, по уровню\n    (подсказка: between 20 and 30).                        → Зорро, Юла, Мира\n14. Сколько героев НЕ из «Ночных теней»?\n    Сначала угадайте, потом проверьте через <>.            → 16 строк. Почему не 24?\n15. В имени есть буква «р», любая (ilike вместо like).     → 15 строк\n16. Самый новый (по дате регистрации) герой.               → Пиксель\n\nГотово — пишите в чат «Практика 1 готова»."),
      { note: "Частые ошибки: <code>column \"маг\" does not exist</code> — текст без кавычек; <code>syntax error at or near …</code> — смотреть слово и слово перед ним (запятая, двойные кавычки); 0 строк без ошибки — <code>'Маг'</code> вместо <code>'маг'</code> или лишний пробел. Не успевают — 13–16 в домашку." },
      { warn: "<b>Ответы:</b> 5) Белла, Жасмин, Нокс, Руна, Ультра · 7) <code>is null</code>, <code>= NULL</code> → 0 · 8) Аргон, Астра, Ангел · 9) <code>order by zoloto desc limit 5</code>: Ультра 9999, Йети 7800, Гром 5100, Нокс 4600, Ястреб 4200 · 10) <code>order by klass, uroven desc</code> · 11) <code>data_registracii &gt;= '2026-01-01'</code> · 12) Аргон, Йети, Сокол, Цезарь · 14) 30 − 6 = 24, но 8 без гильдии не попали — про них неизвестно; все 24: <code>… or gildiya is null</code> · 15) <code>imya ilike '%р%'</code>; <code>like</code> различает Р и р · 16) <code>order by data_registracii desc limit 1</code>. Все — <code>Урок_10/Ответы.md</code>." },
      { ready: "Все написали «Практика 1 готова»" }]],
    ["93–105", "практика", "Практика 2: свой герой + контроль", [
      C("ПРАКТИКА 2 · свой герой\n\n17. Добавьте СВОЕГО героя: имя — ваш ник, класс, уровень (1–100!), золото, гильдия.\n    id и дату не пишите.                                   → 31 герой\n    Найдите себя через where imya = '…'.\n    Попробуйте добавить героя с уровнем 500 — что ответит база?\n18. Узнайте id своего героя. +500 золота (zoloto = zoloto + 500) и v_seti = true.\n    ТОЛЬКО ему — по id. Сначала select с тем же where, потом update.\n19. Ваш герой перешёл в «Белые крылья» — измените.\n20. Удалите своего героя. Сначала select с тем же where!  → снова 30\n\nКОНТРОЛЬ — выполните и пришлите СКРИНШОТ результата в чат:\n    select klass, imya, uroven from geroi\n    where uroven > 60 and gildiya is not null\n    order by uroven desc limit 5;"),
      { warn: "<b>Контроль:</b> Ультра 99, Йети 95, Гром 88, Нокс 82, Ястреб 80. Другое — таблица испорчена (<code>update</code> без <code>where</code>): запустить <code>geroi.sql</code> заново. Уровень 500 → <code>violates check constraint</code>: «база сама защищает данные — Excel бы записал». Удалил и вставил снова — id 32, 33: номера не переиспользуются." },
      { ready: "Скриншоты контроля у всех в чате" }]],
    ["105–112", "бонус", "Бонус для быстрых / помощь отстающим", [
      C("БОНУС\nБ1. Сколько всего героев?               select count(*) from geroi;\nБ2. Сколько золота у всех вместе?       select sum(zoloto) from geroi;\nБ3. Какие классы бывают (без повторов)? select distinct klass from geroi;\nБ4. Золото на один уровень — у кого больше?\n    select imya, zoloto / uroven as na_uroven from geroi\n    order by na_uroven desc limit 3;\nБ5. Таблица для ВАШЕГО проекта: 3–5 столбцов с типами, create table, 5 строк."),
      { note: "Ответы: Б1 30 · Б2 66409 · Б3 4 · Б4 Ультра 101, Йети 82, Гром 57. <code>count</code>, <code>sum</code> — тема занятия 12, сейчас только попробовать." }]],
    ["112–120", "итог", "Итог и домашка", [
      C("ЗАПОМНИТЬ · БАЗЫ ДАННЫХ · занятие 11\n• Таблица = строки (записи) × столбцы (поля). У столбца есть тип: text, int, boolean, date.\n• id — первичный ключ: уникальный номер строки, ставится сам.\n• Порядок в запросе: select … from … where … order by … limit …\n• Текст — в 'одинарных' кавычках, числа — без кавычек.\n• Пусто = NULL. Проверка: is null / is not null. «= NULL» не работает никогда.\n• UPDATE и DELETE — только с where. Сначала select с тем же where, потом меняем.\n• Несколько запросов в окне → видно только последний. Выделить нужный → Run.\n• Сломали таблицу героев — запустите geroi.sql заново."),
      C("ДОМАШНЕЕ ЗАДАНИЕ К ЗАНЯТИЮ 12 · каждый сам · ~40 минут\nSupabase → sql-praktika → SQL Editor. Если таблица героев менялась —\nсначала запустите geroi.sql заново.\n\nЧАСТЬ 1. Запросы (для каждого — сам запрос и проверка):\n Д1. Воины из «Стальных волков», от богатого к бедному.        → 4, первый Йети\n Д2. Герои НЕ в сети с уровнем меньше 30.                       → 3 строки\n Д3. 3 самых слабых героя (по уровню).                          → Пиксель, Ёрш, Эхо\n Д4. Сколько героев зарегистрировалось в 2025 году?             → 17\n Д5. Маги и лекари без гильдии.                                 → 4 строки\n Д6. Герои, чьё имя заканчивается на «а».                       → 9 строк\n Д7. Герои с золотом от 1000 до 2000 включительно.              → 7 строк\n Все 7 запросов сохраните в один файл zaprosy.sql\n (подпишите: -- Д1, -- Д2 …) и пришлите в чат.\n\nЧАСТЬ 2. Таблица для ВАШЕГО проекта.\n Придумайте одну таблицу, которая нужна вашему проекту\n (например, напоминания, пользователи, ответы бота).\n • Создайте её через create table по образцу geroi.sql:\n   id как в образце, 3–6 своих столбцов, у каждого тип (text, int, boolean, date),\n   хотя бы один not null и хотя бы один default.\n • Добавьте 5 строк через insert.\n • Скриншот select * from ваша_таблица; — в чат.\n Названия таблицы и столбцов — латиницей, маленькими буквами, через _.\n\nГОТОВО, КОГДА: в чате ваш zaprosy.sql и скриншот своей таблицы.\nЗастряли больше чем на 5 минут — пишите в чат группы: какой запрос и какую ошибку видите."),
      { note: "Если в практике не успели 13–16 — добавить их в часть 1. После занятия очистить демо (проект <code>sql-demo</code> не удалять):" },
      C("drop table if exists pitomcy;\ndrop table if exists geroi;")]],
  ];
  const FLOWS = { 8: FLOW8, 11: FLOW11 };
  let cmdN = 0;
  function renderFlow(l) {
    const FLOW = FLOWS[l];
    $("flowNav-" + l).innerHTML = FLOW.map((b, i) => "<a href='#fl" + l + "-" + i + "'>" + b[0] + "</a>").join("") + "<a href='#problems-" + l + "'>Проблемы</a>";
    $("flow-" + l).innerHTML = FLOW.map((b, i) => "<div class='fl-block' id='fl" + l + "-" + i + "'><div class='fl-time'>" + b[0] + "<small>" + esc(b[1]) + "</small></div><div class='fl-body'><b>" + esc(b[2]) + "</b>" +
      b[3].map((x) => {
        if (x.cmd) return "<div class='fl-cmds'>" + x.cmd.map((c) => { const id = cmdN++; return "<button type='button' class='fl-cmd" + (copied.has(id) ? " done" : "") + "' data-c='" + id + "'><code>" + esc(c) + "</code><span>" + (copied.has(id) ? "скопировано" : "копировать") + "</span></button>"; }).join("") + "</div>";
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
    renderPupils(); cmdN = 0; Object.keys(PREPS).forEach((l) => { renderPrep(l); renderFlow(l); }); renderLive(); renderResults();
    status(pupils.length ? "Учеников: " + pupils.length : "Список пуст — добавьте учеников ниже.");
    clearInterval(timer);
    timer = setInterval(tick, 3000);
  }

  if (session) start().catch((e) => { if (e.message !== "idle" && e.message !== "401") showLogin("Не удалось загрузить: " + e.message); });
  else showLogin("");
})();
