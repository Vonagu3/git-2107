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
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  function codeOk(p) {
    if (!p.code || p.levels == null || p.levels === "") return null;
    const c = String(p.code).trim().toUpperCase();
    const words = norm(p.name).split(" ");
    const variants = [words.join(" "), words.slice().reverse().join(" ")];
    return variants.some((v) => S.progressCode(v, +p.levels) === c);
  }
  function status(t) { $("status").textContent = t; }

  function renderPupils() {
    const byTeam = {};
    pupils.forEach((p) => { (byTeam[p.team || "—"] = byTeam[p.team || "—"] || []).push(p); });
    let h = "<tr><th>Ученик</th><th>Класс</th><th>Логин GitHub</th><th style='width:90px'>Уровней</th><th style='width:110px'>Код</th><th></th><th>Заметка</th><th></th></tr>";
    Object.keys(byTeam).sort().forEach((team) => {
      h += "<tr class='team-h'><td colspan='8'>Команда " + esc(team) + " · " + byTeam[team].length + " чел.</td></tr>";
      byTeam[team].forEach((p) => {
        const ok = codeOk(p);
        h += "<tr data-id='" + p.id + "'><td>" + esc(p.name) + "</td><td>" + esc(p.klass) + "</td>" +
          "<td><input type='text' data-k='github' value='" + esc(p.github) + "' placeholder='логин'></td>" +
          "<td><input type='number' min='0' max='18' data-k='levels' value='" + esc(p.levels) + "'></td>" +
          "<td><input type='text' class='code' data-k='code' value='" + esc(p.code) + "'></td>" +
          "<td class='v'>" + (ok === null ? "" : ok ? "<span class='ok'>✔</span>" : "<span class='bad'>✘</span>") + "</td>" +
          "<td><input type='text' data-k='note' value='" + esc(p.note) + "'></td>" +
          "<td><button class='btn mini' data-del>удалить</button></td></tr>";
      });
    });
    $("pupils").innerHTML = h;
    $("pupils").querySelectorAll("input").forEach((inp) => {
      inp.oninput = () => {
        const p = pupils.find((x) => x.id === +inp.closest("tr").dataset.id);
        p[inp.dataset.k] = inp.value;
        const ok = codeOk(p);
        inp.closest("tr").querySelector(".v").innerHTML = ok === null ? "" : ok ? "<span class='ok'>✔</span>" : "<span class='bad'>✘</span>";
      };
      inp.onchange = () => save(+inp.closest("tr").dataset.id, inp.dataset.k, inp.value);
    });
    $("pupils").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      const id = +b.closest("tr").dataset.id;
      const p = pupils.find((x) => x.id === id);
      if (!confirm("Удалить " + p.name + " из списка?")) return;
      await rest("git_pupils?id=eq." + id, { method: "DELETE" });
      pupils = pupils.filter((x) => x.id !== id);
      renderPupils(); renderFlow();
      status("Удалено.");
    }));
  }
  async function save(id, key, value) {
    const body = {};
    body[key] = key === "levels" ? (value === "" ? null : +value) : value.trim() || null;
    body.updated_at = new Date().toISOString();
    try {
      await rest("git_pupils?id=eq." + id, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });
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
    status("Добавлен " + name + ".");
  };

  // ---------- чек-лист (git_teacher_kv, ключ prep) ----------
  const PREP = [
    "Собрать GitHub-логины учеников (таблица выше) и прислать Claude — он пригласит всех в git-praktika. Или вручную: Settings → Collaborators → Add people.",
    "Напомнить в чате принять приглашение: письмо на почту или " + REPO.replace("https://", "") + "/invitations.",
    "Проверить, что в git-praktika есть ветки main, демо-конфликт-1, демо-конфликт-2.",
    "На школьном компьютере: открывается тренажёр, git clone по HTTPS проходит, первый push открывает вход через браузер. Если GitHub режется — раздача с телефона или GitVerse; тренажёр — из файла index.html.",
    "Положить на рабочий стол папку демо_зачем_git для первых 10 минут.",
    "Список тех, кому нет 13 или нет почты: работают в паре, регистрируются дома.",
    "Распечатать GIT.md на всех учеников и шаблон группы на каждую команду.",
  ];
  let prepDone = [];
  function renderPrep() {
    $("prep").innerHTML = PREP.map((t, i) => "<li><label><input type='checkbox' data-p='" + i + "'" + (prepDone.includes(i) ? " checked" : "") + "><span>" + esc(t) + "</span></label></li>").join("");
    $("prep").querySelectorAll("input").forEach((cb) => (cb.onchange = async () => {
      const i = +cb.dataset.p, k = prepDone.indexOf(i);
      if (cb.checked && k < 0) prepDone.push(i);
      if (!cb.checked && k >= 0) prepDone.splice(k, 1);
      try {
        await rest("git_teacher_kv?on_conflict=key", { method: "POST", body: JSON.stringify({ key: "prep", value: prepDone, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
      } catch (e) { alert("Не сохранилось: " + e.message); }
    }));
  }

  // ---------- ход занятия (команды — из таблицы учеников) ----------
  function renderFlow() {
    const teams = {};
    pupils.forEach((p) => { (teams[p.team || "—"] = teams[p.team || "—"] || []).push(p.name.split(" ").slice(-1)[0]); });
    const teamText = Object.keys(teams).sort().map((t) => t + ": " + teams[t].join(", ")).join(". ") || "составы — в таблице учеников";
    const n = pupils.length || "все";
    const flow = [
      ["0–10", "Зачем Git", "Папка демо_зачем_git: какой файл правильный? (вопросы — в вопросы.md). Затем git log учебного репозитория — та же история, но с подписями и датами."],
      ["10–25", "Четыре места", "Тренажёр → «Как устроен Git» на проекторе, по сценарию ниже. Ученики рисуют схему в тетради."],
      ["25–45", "Тренажёр, блоки 1–2", "Каждый сам: уровни 1–10. Ходить по классу, быстрым — до 12."],
      ["45–60", "Настоящий GitHub", "Вкладка «Подключение»: config, clone, открыть папку в VS Code, python 01_график.py. Задания 1–2, python проверить.py."],
      ["60–70", "Перерыв", ""],
      ["70–85", "Своя ветка и свои данные", "Задания 3–6: ветка, CSV из 7 строк, commit, push -u. python проверить.py до зелёных у всех (" + n + "). Показать, что картинка не попала в коммит (.gitignore)."],
      ["85–95", "Pull request и конфликт", "На экране: PR одного ученика, Merge. Слить демо-конфликт-1, открыть PR демо-конфликт-2 → «Resolve conflicts». Слить остальные PR. Все: git checkout main, git pull (задание 7)."],
      ["95–100", "Объявление команд", teamText + ". Команда Курчатовского проекта — из одного класса. Каждой 2–3 темы-кандидата."],
      ["100–120", "Выбор темы", "Команды заполняют группы/A.md, группы/B.md по шаблону; один человек от команды — ветка, коммит, push, PR. Последние 3 минуты — домашка (вкладка «Домашка»)."],
    ];
    $("flow").innerHTML = "<tr><th>Мин</th><th>Блок</th><th>Что происходит</th></tr>" + flow.map((r) => "<tr><td style='white-space:nowrap'>" + r[0] + "</td><td><b>" + esc(r[1]) + "</b></td><td>" + esc(r[2]) + "</td></tr>").join("");
  }

  async function start() {
    const [ps, kv] = await Promise.all([
      rest("git_pupils?select=*&order=team.asc,sort.asc,name.asc"),
      rest("git_teacher_kv?select=*&key=eq.prep"),
    ]);
    pupils = ps;
    prepDone = (kv[0] && kv[0].value) || [];
    $("who").textContent = session.email;
    $("login").hidden = true;
    $("app").hidden = false;
    renderPupils(); renderPrep(); renderFlow();
    status(pupils.length ? "Учеников: " + pupils.length : "Список пуст — добавьте учеников ниже.");
  }

  if (session) start().catch((e) => { if (e.message !== "idle" && e.message !== "401") showLogin("Не удалось загрузить: " + e.message); });
  else showLogin("");
})();
