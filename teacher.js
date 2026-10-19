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
    $("qShow").onclick = () => { document.body.classList.toggle("show"); renderLive(); };
    $("qStop").onclick = () => { if (confirm("Завершить опрос? У учеников появится «Опрос ещё не начался».")) { document.body.classList.remove("show"); setQuiz({ session: null, q: 0, revealed: false }); } };
  }
  async function loadAnswers() {
    if (!quiz.session) { answers = []; return; }
    answers = await rest("git_events?select=key,payload,created_at&kind=eq.answer&payload->>s=eq." + encodeURIComponent(quiz.session) + "&order=created_at.asc");
    renderLive();
  }

  // ---------- чек-лист (git_teacher_kv, ключ prep) ----------
  const PREP = [
    "На GitHub создан публичный пустой репозиторий Vonagu3/istoriya-igra, в него отправлено: git remote add origin https://github.com/Vonagu3/istoriya-igra.git · git push -u origin --all. На GitHub 4 ветки, 20 коммитов в main.",
    "(По желанию) Vonagu3/istoriya-demo на GitHub — чтобы показать отказ git push после rebase и --force-with-lease. Без него — словами.",
    "Папка ~/Desktop/2107/Git/Vonagu3/istoriya-demo чистая и на main. Испорчена после репетиции — rm -rf и пересоздать: python3 ~/Desktop/2107/MAX/Урок_8/создать_репозиторий.py ~/Desktop/2107/Git/Vonagu3/istoriya-demo",
    "У себя git config --global core.editor \"code --wait\" — для показа rebase -i в VS Code, а не в Vim.",
    "Ответы детектива (в блоке практики) — не показывать на экране до конца практики.",
    "Демонстрировать окно, а не весь экран; эту страницу — только в «Режиме показа».",
  ];
  let prepDone = [];
  function renderPrep() {
    $("prep").innerHTML = PREP.map((t, i) => "<li><label><input type='checkbox' data-p='" + i + "'" + (prepDone.includes(i) ? " checked" : "") + "><span>" + esc(t) + "</span></label></li>").join("");
    $("prep").querySelectorAll("input").forEach((cb) => (cb.onchange = async () => {
      const i = +cb.dataset.p, k = prepDone.indexOf(i);
      if (cb.checked && k < 0) prepDone.push(i);
      if (!cb.checked && k >= 0) prepDone.splice(k, 1);
      try {
        await rest("git_teacher_kv?on_conflict=key", { method: "POST", body: JSON.stringify({ key: "prep8", value: prepDone, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
      } catch (e) { alert("Не сохранилось: " + e.message); }
    }));
  }

  // ---------- ход занятия: команды копируются кликом (терминал или чат группы в Telegram) ----------
  const copied = new Set();
  const C = (...cmds) => ({ cmd: cmds });
  const DEMO = "~/Desktop/2107/Git/Vonagu3/istoriya-demo";
  const IGRA = "https://github.com/Vonagu3/istoriya-igra";
  const FLOW = [
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
  function renderFlow() {
    let n = 0;
    $("flowNav").innerHTML = FLOW.map((b, i) => "<a href='#fl" + i + "'>" + b[0] + "</a>").join("") + "<a href='#problems'>Проблемы</a>";
    $("flow").innerHTML = FLOW.map((b, i) => "<div class='fl-block' id='fl" + i + "'><div class='fl-time'>" + b[0] + "<small>" + esc(b[1]) + "</small></div><div class='fl-body'><b>" + esc(b[2]) + "</b>" +
      b[3].map((x) => {
        if (x.cmd) return "<div class='fl-cmds'>" + x.cmd.map((c) => { const id = n++; return "<button type='button' class='fl-cmd" + (copied.has(id) ? " done" : "") + "' data-c='" + id + "'><code>" + esc(c) + "</code><span>" + (copied.has(id) ? "скопировано" : "копировать") + "</span></button>"; }).join("") + "</div>";
        if (x.ol) return "<ol>" + x.ol.map((t) => "<li>" + t + "</li>").join("") + "</ol>";
        if (x.warn) return "<div class='note'>" + x.warn + "</div>";
        if (x.ready) return "<span class='fl-ready'>" + esc(x.ready) + "</span>";
        return "<div class='muted'>" + x.note + "</div>";
      }).join("") + "</div></div>").join("");
    $("flow").querySelectorAll(".fl-cmd").forEach((btn) => (btn.onclick = () => {
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
      rest("git_teacher_kv?select=*&key=in.(prep8,sent)"),
      rest("git_quiz?select=session,q,revealed&id=eq.1"),
    ]);
    pupils = ps;
    const kvOf = (k) => { const r = kv.find((x) => x.key === k); return (r && r.value) || []; };
    prepDone = kvOf("prep8");
    sentMarks = kvOf("sent");
    if (qz[0]) quiz = qz[0];
    await loadEvents();
    await loadAnswers();
    $("who").textContent = session.email;
    $("login").hidden = true;
    $("app").hidden = false;
    await loadAllAnswers();
    renderPupils(); renderPrep(); renderFlow(); renderLive(); renderResults();
    status(pupils.length ? "Учеников: " + pupils.length : "Список пуст — добавьте учеников ниже.");
    clearInterval(timer);
    timer = setInterval(tick, 3000);
  }

  if (session) start().catch((e) => { if (e.message !== "idle" && e.message !== "401") showLogin("Не удалось загрузить: " + e.message); });
  else showLogin("");
})();
