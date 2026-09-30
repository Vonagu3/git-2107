// Движок git-тренажёра: модель файлов, репозиториев и «GitHub», разбор команд, уровни.
// Чистые функции без DOM, чтобы их можно было проверить в node (см. тест.mjs).
(function (root) {
  "use strict";

  // Аккаунт GitHub, где лежит учебный репозиторий git-praktika.
  const ORG = "Vonagu3";
  const GH = "https://github.com/";
  const PRAKTIKA_URL = GH + ORG + "/git-praktika";

  // ---------- утилиты ----------

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function hash(s) {
    let h1 = 0x811c9dc5, h2 = 0x1234567;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
  }

  function out(text, cls) {
    return { text: text, cls: cls || "" };
  }
  const hint = (t) => out("Подсказка: " + t, "hint");
  const err = (t) => out(t, "err");

  // Разбор строки на слова с учётом кавычек.
  function tokenize(line) {
    const res = [];
    let cur = "", q = null, has = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === q) q = null; else cur += ch;
      } else if (ch === '"' || ch === "'" || ch === "«" || ch === "»") {
        if (ch === "»") continue;
        q = ch === "«" ? "»" : ch; has = true;
      } else if (/\s/.test(ch)) {
        if (cur || has) { res.push(cur); cur = ""; has = false; }
      } else if (ch === ">" ) {
        if (cur || has) { res.push(cur); cur = ""; has = false; }
        if (line[i + 1] === ">") { res.push(">>"); i++; } else res.push(">");
      } else cur += ch;
    }
    if (cur || has) res.push(cur);
    return res;
  }

  // ---------- мир ----------
  // world = {
  //   cwd: "" (домашняя папка) или имя папки,
  //   home: { files: {}, dirs: { имя: { files: {путь: текст}, repo: null|repo } } },
  //   objects: { id: commit }, seq,
  //   github: { url: { branches: {имя: id}, head: "main" } },
  //   config: { "user.name": ..., "user.email": ... },
  //   loggedIn: false, history: [ {cmd, ok, out} ], editing: null
  // }

  function newWorld() {
    return {
      cwd: "",
      home: { files: {}, dirs: {} },
      objects: {},
      seq: 0,
      github: {},
      config: {},
      loggedIn: false,
      history: [],
    };
  }

  function newRepo() {
    return {
      branches: {},
      head: "main",
      index: {},
      remotes: {},
      tracking: {},
      upstream: {},
      merging: null,
      unmerged: [],
    };
  }

  function curDir(w) {
    return w.cwd ? w.home.dirs[w.cwd] : null;
  }
  function curRepo(w) {
    const d = curDir(w);
    return d && d.repo ? d.repo : null;
  }
  function worktree(w) {
    const d = curDir(w);
    return d ? d.files : w.home.files;
  }

  function makeCommit(w, msg, parents, tree, author, time) {
    w.seq++;
    const a = author || { name: w.config["user.name"] || "?", email: w.config["user.email"] || "?" };
    const id = hash(msg + "|" + parents.join(",") + "|" + JSON.stringify(tree) + "|" + a.name + "|" + w.seq);
    w.objects[id] = { id: id, msg: msg, parents: parents.slice(), tree: clone(tree), author: a, seq: w.seq, time: time || Date.now() };
    return id;
  }

  function headId(repo) {
    return repo.branches[repo.head] || null;
  }
  function treeOf(w, id) {
    return id ? w.objects[id].tree : {};
  }

  function ancestors(w, id) {
    const seen = new Set();
    const stack = id ? [id] : [];
    while (stack.length) {
      const c = stack.pop();
      if (seen.has(c)) continue;
      seen.add(c);
      w.objects[c].parents.forEach((p) => stack.push(p));
    }
    return seen;
  }
  function isAncestor(w, a, b) {
    // a — предок b (или равен)
    if (!a) return true;
    if (!b) return false;
    return ancestors(w, b).has(a);
  }
  function mergeBase(w, a, b) {
    const A = ancestors(w, a), B = ancestors(w, b);
    let best = null;
    A.forEach((c) => {
      if (B.has(c) && (!best || w.objects[c].seq > w.objects[best].seq)) best = c;
    });
    return best;
  }
  function countBetween(w, from, to) {
    // сколько коммитов есть в to, которых нет в from
    const F = ancestors(w, from);
    let n = 0;
    ancestors(w, to).forEach((c) => { if (!F.has(c)) n++; });
    return n;
  }

  // .gitignore: *.png, venv/, точные имена
  function ignorePatterns(files) {
    const t = files[".gitignore"];
    if (!t) return [];
    return t.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  }
  function globToRe(g) {
    return new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");
  }
  function isIgnored(files, path) {
    const pats = ignorePatterns(files);
    const parts = path.split("/");
    const base = parts[parts.length - 1];
    return pats.some((p) => {
      if (p.endsWith("/")) {
        const d = p.slice(0, -1);
        return parts.slice(0, -1).some((x) => globToRe(d).test(x));
      }
      if (p.includes("/")) return globToRe(p.replace(/^\//, "")).test(path);
      return globToRe(p).test(base) || parts.slice(0, -1).some((x) => globToRe(p).test(x));
    });
  }

  // Состояние файлов: staged / unstaged / untracked
  function fileStatus(w) {
    const repo = curRepo(w);
    const wt = worktree(w);
    const head = treeOf(w, headId(repo));
    const idx = repo.index;
    const staged = [], unstaged = [], untracked = [], ignored = [];
    const all = new Set([...Object.keys(head), ...Object.keys(idx), ...Object.keys(wt)]);
    [...all].sort().forEach((p) => {
      if (repo.unmerged.includes(p)) return;
      const h = head[p], i = idx[p], f = wt[p];
      if (i !== h) {
        if (h === undefined) staged.push({ p: p, kind: "new file" });
        else if (i === undefined) staged.push({ p: p, kind: "deleted" });
        else staged.push({ p: p, kind: "modified" });
      }
      if (i === undefined) {
        if (f !== undefined) {
          if (isIgnored(wt, p)) ignored.push(p); else untracked.push(p);
        }
      } else if (f === undefined) unstaged.push({ p: p, kind: "deleted" });
      else if (f !== i) unstaged.push({ p: p, kind: "modified" });
    });
    return { staged: staged, unstaged: unstaged, untracked: untracked, ignored: ignored, unmerged: repo.unmerged.slice() };
  }
  function isClean(w) {
    const s = fileStatus(w);
    return !s.staged.length && !s.unstaged.length && !s.unmerged.length;
  }

  // ---------- слияние содержимого ----------

  function mergeText(b, o, t, oursName, theirsName) {
    b = b === undefined ? "" : b;
    const B = b.split("\n"), O = o.split("\n"), T = t.split("\n");
    const mark = (os, ts) => ["<<<<<<< " + oursName].concat(os, ["======="], ts, [">>>>>>> " + theirsName]);
    if (B.length === O.length && B.length === T.length) {
      const res = [];
      let conflict = false, i = 0;
      while (i < B.length) {
        if (O[i] === T[i] || T[i] === B[i]) { res.push(O[i]); i++; continue; }
        if (O[i] === B[i]) { res.push(T[i]); i++; continue; }
        const os = [], ts = [];
        while (i < B.length && O[i] !== T[i] && O[i] !== B[i] && T[i] !== B[i]) { os.push(O[i]); ts.push(T[i]); i++; }
        res.push.apply(res, mark(os, ts));
        conflict = true;
      }
      return { text: res.join("\n"), conflict: conflict };
    }
    let pre = 0;
    while (pre < B.length && pre < O.length && pre < T.length && B[pre] === O[pre] && B[pre] === T[pre]) pre++;
    let suf = 0;
    while (suf < B.length - pre && suf < O.length - pre && suf < T.length - pre &&
      B[B.length - 1 - suf] === O[O.length - 1 - suf] && B[B.length - 1 - suf] === T[T.length - 1 - suf]) suf++;
    const mid = (a) => a.slice(pre, a.length - suf);
    const bm = mid(B).join("\n"), om = mid(O).join("\n"), tm = mid(T).join("\n");
    let middle, conflict = false;
    if (om === tm || tm === bm) middle = mid(O);
    else if (om === bm) middle = mid(T);
    else { middle = mark(mid(O), mid(T)); conflict = true; }
    return { text: B.slice(0, pre).concat(middle, B.slice(B.length - suf)).join("\n"), conflict: conflict };
  }

  // Слить коммит theirs в текущую ветку. Возвращает строки вывода.
  function doMerge(w, theirs, theirsName, lines, msgIfCommit) {
    const repo = curRepo(w);
    const ours = headId(repo);
    if (isAncestor(w, theirs, ours)) { lines.push(out("Already up to date.")); return true; }
    const wt = worktree(w);
    const newTree = treeOf(w, theirs);
    if (!isClean(w)) {
      const s = fileStatus(w);
      const dirty = s.staged.concat(s.unstaged).map((x) => x.p);
      lines.push(err("error: Your local changes to the following files would be overwritten by merge:"));
      dirty.forEach((p) => lines.push(err("\t" + p)));
      lines.push(err("Please commit your changes or stash them before you merge."));
      lines.push(err("Aborting"));
      lines.push(hint("сначала сохраните свои изменения: git add . и git commit -m \"...\""));
      return false;
    }
    if (isAncestor(w, ours, theirs)) {
      const oldTree = treeOf(w, ours);
      lines.push(out("Updating " + (ours || "0000000").slice(0, 7) + ".." + theirs.slice(0, 7)));
      lines.push(out("Fast-forward"));
      applyTree(w, oldTree, newTree);
      repo.branches[repo.head] = theirs;
      const changed = diffNames(oldTree, newTree);
      changed.forEach((p) => lines.push(out(" " + p + " | изменён")));
      lines.push(out(" " + changed.length + " file" + (changed.length === 1 ? "" : "s") + " changed"));
      return true;
    }
    const base = mergeBase(w, ours, theirs);
    const bt = treeOf(w, base), ot = treeOf(w, ours), tt = treeOf(w, theirs);
    const paths = new Set([...Object.keys(bt), ...Object.keys(ot), ...Object.keys(tt)]);
    const result = {}, conflicts = [];
    [...paths].sort().forEach((p) => {
      const b = bt[p], o = ot[p], t = tt[p];
      if (o === t) { if (o !== undefined) result[p] = o; return; }
      if (o === b) { if (t !== undefined) result[p] = t; return; }
      if (t === b) { if (o !== undefined) result[p] = o; return; }
      if (o === undefined || t === undefined) { result[p] = o === undefined ? t : o; conflicts.push(p); return; }
      if (t.includes("\n") || o.includes("\n") || true) {
        const m = mergeText(b, o, t, "HEAD", theirsName);
        result[p] = m.text;
        if (m.conflict) conflicts.push(p);
      }
    });
    // рабочая папка
    Object.keys(ot).forEach((p) => { if (!(p in result)) delete wt[p]; });
    Object.keys(result).forEach((p) => { wt[p] = result[p]; });
    const newIdx = {};
    Object.keys(result).forEach((p) => { if (!conflicts.includes(p)) newIdx[p] = result[p]; });
    conflicts.forEach((p) => { if (ot[p] !== undefined) newIdx[p] = ot[p]; });
    repo.index = newIdx;
    const msg = msgIfCommit || ("Merge branch '" + theirsName + "'");
    if (conflicts.length) {
      conflicts.forEach((p) => lines.push(out("Auto-merging " + p)));
      conflicts.forEach((p) => lines.push(err("CONFLICT (content): Merge conflict in " + p)));
      lines.push(err("Automatic merge failed; fix conflicts and then commit the result."));
      lines.push(hint("откройте файл командой edit " + conflicts[0] + ", оставьте правильный вариант, удалите строки с <<<<<<<, ======= и >>>>>>>, затем git add и git commit."));
      repo.unmerged = conflicts;
      repo.merging = { theirs: theirs, msg: msg };
      return false;
    }
    repo.index = clone(result);
    const id = makeCommit(w, msg, [ours, theirs], result);
    repo.branches[repo.head] = id;
    lines.push(out("Merge made by the 'ort' strategy."));
    const changed = diffNames(ot, result);
    changed.forEach((p) => lines.push(out(" " + p + " | изменён")));
    return true;
  }

  function diffNames(a, b) {
    const s = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...s].filter((p) => a[p] !== b[p]).sort();
  }

  // Переключить рабочую папку и индекс с дерева oldTree на newTree, не трогая неотслеживаемые файлы.
  function applyTree(w, oldTree, newTree) {
    const repo = curRepo(w), wt = worktree(w);
    Object.keys(oldTree).forEach((p) => { if (!(p in newTree)) delete wt[p]; });
    Object.keys(newTree).forEach((p) => { wt[p] = newTree[p]; });
    repo.index = clone(newTree);
  }

  // ---------- команды оболочки ----------

  const HELP = [
    "Команды терминала:",
    "  ls [папка]        показать файлы",
    "  cd <папка>        перейти в папку (cd .. — назад, cd ~ — домой)",
    "  cat <файл>        показать содержимое файла",
    "  edit <файл>       открыть файл в редакторе (как в VS Code)",
    "  echo \"текст\" >> <файл>   дописать строку в файл",
    "  touch <файл>      создать пустой файл",
    "  python 01_график.py [csv]   запустить скрипт (создаст картинку)",
    "  clear             очистить экран",
    "Команды git: init, status, add, commit, log, show, diff, branch, checkout, switch,",
    "  merge, clone, remote, push, pull, fetch, config, restore, rm. Подробнее — вкладка «Шпаргалка».",
  ];

  function run(w, line) {
    line = line.trim();
    const lines = [];
    if (!line) return { lines: lines };
    let ok = true;
    const args = tokenize(line);
    const cmd = args[0];
    try {
      if (cmd === "git") ok = git(w, args.slice(1), lines);
      else if (cmd === "help" || cmd === "помощь") HELP.forEach((l) => lines.push(out(l)));
      else if (cmd === "clear" || cmd === "cls") return rec(w, line, true, [], { clear: true });
      else if (cmd === "ls" || cmd === "dir") ok = cmdLs(w, args.slice(1), lines);
      else if (cmd === "cd") ok = cmdCd(w, args.slice(1), lines);
      else if (cmd === "pwd") lines.push(out("/home/ученик" + (w.cwd ? "/" + w.cwd : "")));
      else if (cmd === "cat" || cmd === "type") ok = cmdCat(w, args.slice(1), lines);
      else if (cmd === "touch") { args.slice(1).forEach((p) => { const f = worktree(w); if (!(p in f)) f[p] = ""; }); }
      else if (cmd === "echo") ok = cmdEcho(w, args.slice(1), lines);
      else if (cmd === "edit" || cmd === "code" || cmd === "nano") {
        const p = args[1];
        if (!p) { lines.push(err("Укажите файл: edit имя_файла")); ok = false; }
        else return rec(w, line, true, [out("Открыт редактор: " + p)], { edit: p });
      } else if (cmd === "python" || cmd === "python3" || cmd === "py") ok = cmdPython(w, args.slice(1), lines);
      else if (cmd === "rm" || cmd === "del") {
        const f = worktree(w);
        args.slice(1).forEach((p) => { if (p in f) delete f[p]; else { lines.push(err("rm: " + p + ": No such file or directory")); ok = false; } });
      } else {
        lines.push(err(cmd + ": command not found"));
        lines.push(hint("такой команды нет. Список команд — help."));
        ok = false;
      }
    } catch (e) {
      lines.push(err("Ошибка тренажёра: " + e.message));
      ok = false;
    }
    return rec(w, line, ok, lines);
  }

  function rec(w, line, ok, lines, extra) {
    w.history.push({ cmd: line, ok: ok, cwd: w.cwd, text: lines.map((l) => l.text).join("\n") });
    return Object.assign({ lines: lines, ok: ok }, extra || {});
  }

  function listDir(files, prefix) {
    const names = new Set();
    Object.keys(files).forEach((p) => {
      if (prefix && !p.startsWith(prefix + "/")) return;
      const rest = prefix ? p.slice(prefix.length + 1) : p;
      const i = rest.indexOf("/");
      names.add(i >= 0 ? rest.slice(0, i) + "/" : rest);
    });
    return [...names].sort();
  }

  function cmdLs(w, args, lines) {
    const target = args.filter((a) => !a.startsWith("-"))[0];
    if (!w.cwd) {
      if (target) {
        const d = w.home.dirs[target.replace(/\/$/, "")];
        if (!d) { lines.push(err("ls: " + target + ": No such file or directory")); return false; }
        listDir(d.files, "").forEach((n) => lines.push(out(n)));
        return true;
      }
      Object.keys(w.home.dirs).sort().forEach((n) => lines.push(out(n + "/", "dir")));
      listDir(w.home.files, "").forEach((n) => lines.push(out(n)));
      return true;
    }
    const files = worktree(w);
    const pre = target ? target.replace(/\/$/, "") : "";
    const names = listDir(files, pre);
    if (pre && !names.length) { lines.push(err("ls: " + target + ": No such file or directory")); return false; }
    names.forEach((n) => lines.push(out(n, n.endsWith("/") ? "dir" : "")));
    return true;
  }

  function cmdCd(w, args, lines) {
    let t = (args[0] || "~").replace(/\/$/, "");
    if (t === "~" || t === "/home/ученик" || t === "") { w.cwd = ""; return true; }
    if (t === "..") { w.cwd = ""; return true; }
    if (t.startsWith("~/")) t = t.slice(2);
    if (!w.cwd && w.home.dirs[t]) { w.cwd = t; return true; }
    if (w.cwd) {
      const files = worktree(w);
      if (Object.keys(files).some((p) => p.startsWith(t + "/"))) {
        lines.push(out("В тренажёре работаем из корня репозитория, в подпапку " + t + " заходить не нужно.", "hint"));
        lines.push(hint("пишите путь к файлу целиком: cat " + t + "/имя_файла"));
        return false;
      }
    }
    lines.push(err("cd: no such file or directory: " + args[0]));
    lines.push(hint("посмотрите, какие папки есть рядом: ls" + (w.cwd ? ". Чтобы выйти из папки: cd .." : "")));
    return false;
  }

  function cmdCat(w, args, lines) {
    const files = worktree(w);
    if (!args.length) { lines.push(err("Укажите файл: cat имя_файла")); return false; }
    let ok = true;
    args.forEach((p) => {
      if (p in files) files[p].split("\n").forEach((l) => lines.push(out(l, l.startsWith("<<<<<<<") || l.startsWith(">>>>>>>") || l === "=======" ? "conf" : "")));
      else if (!w.cwd && w.home.dirs[p]) { lines.push(err("cat: " + p + ": Is a directory")); ok = false; }
      else { lines.push(err("cat: " + p + ": No such file or directory")); ok = false; }
    });
    return ok;
  }

  function cmdEcho(w, args, lines) {
    const i = args.findIndex((a) => a === ">" || a === ">>");
    if (i < 0) { lines.push(out(args.join(" "))); return true; }
    const text = args.slice(0, i).join(" ");
    const p = args[i + 1];
    if (!p) { lines.push(err("Не указан файл после " + args[i])); return false; }
    const files = worktree(w);
    if (args[i] === ">") files[p] = text;
    else {
      const old = files[p];
      files[p] = old === undefined || old === "" ? text : old + "\n" + text;
    }
    return true;
  }

  function cmdPython(w, args, lines) {
    const files = worktree(w);
    const script = args[0];
    if (!script) { lines.push(out("Python 3.12 — интерактивный режим в тренажёре не поддерживается.")); return false; }
    if (!(script in files)) {
      lines.push(err("python: can't open file '" + script + "': [Errno 2] No such file or directory"));
      lines.push(hint("вы в той папке? Посмотрите ls."));
      return false;
    }
    const csv = args[1] || "data/визиты_к_кормушке.csv";
    if (!(csv in files)) { lines.push(out("Нет такого файла: " + csv)); return false; }
    const rows = files[csv].split("\n").filter((s) => s.trim());
    const stem = csv.split("/").pop().replace(/\.csv$/, "");
    lines.push(out("Файл: " + csv + " | строк: " + (rows.length - 1)));
    const png = "график_" + stem + ".png";
    files[png] = "[картинка " + png + "]";
    lines.push(out("Готово: " + png));
    return true;
  }

  // ---------- git ----------

  function needRepo(w, lines) {
    if (curRepo(w)) return true;
    lines.push(err("fatal: not a git repository (or any of the parent directories): .git"));
    lines.push(hint(w.cwd ? "эта папка ещё не репозиторий. Создать: git init" : "вы в домашней папке, а не в репозитории. Посмотрите ls и перейдите: cd имя_папки"));
    return false;
  }

  function git(w, a, lines) {
    const sub = a[0];
    if (!sub) { lines.push(out("usage: git <command> [<args>]")); return false; }
    switch (sub) {
      case "config": return gitConfig(w, a.slice(1), lines);
      case "init": return gitInit(w, lines);
      case "clone": return gitClone(w, a.slice(1), lines);
      case "--version": case "version": lines.push(out("git version 2.46.0")); return true;
      case "help": HELP.slice(8).forEach((l) => lines.push(out(l))); return true;
    }
    if (!needRepo(w, lines)) return false;
    switch (sub) {
      case "status": return gitStatus(w, lines);
      case "add": return gitAdd(w, a.slice(1), lines);
      case "commit": return gitCommit(w, a.slice(1), lines);
      case "log": return gitLog(w, a.slice(1), lines);
      case "show": return gitShow(w, a.slice(1), lines);
      case "diff": return gitDiff(w, a.slice(1), lines);
      case "branch": return gitBranch(w, a.slice(1), lines);
      case "checkout": return gitCheckout(w, a.slice(1), lines, "checkout");
      case "switch": return gitCheckout(w, a.slice(1), lines, "switch");
      case "merge": return gitMerge(w, a.slice(1), lines);
      case "remote": return gitRemote(w, a.slice(1), lines);
      case "push": return gitPush(w, a.slice(1), lines);
      case "fetch": return gitFetch(w, lines);
      case "pull": return gitPull(w, a.slice(1), lines);
      case "restore": return gitRestore(w, a.slice(1), lines);
      case "rm": return gitRm(w, a.slice(1), lines);
    }
    lines.push(err("git: '" + sub + "' is not a git command. See 'git --help'."));
    lines.push(hint("проверьте написание. Основные команды — во вкладке «Шпаргалка»."));
    return false;
  }

  function gitConfig(w, a, lines) {
    const args = a.filter((x) => x !== "--global");
    if (args[0] === "--list" || args[0] === "-l") {
      Object.keys(w.config).forEach((k) => lines.push(out(k + "=" + w.config[k])));
      return true;
    }
    const key = args[0];
    if (!key) { lines.push(err("usage: git config [<options>]")); return false; }
    if (args.length === 1) {
      if (key in w.config) { lines.push(out(w.config[key])); return true; }
      return false;
    }
    w.config[key] = args.slice(1).join(" ");
    if (!a.includes("--global")) lines.push(hint("без --global настройка действует только в этом репозитории. Для имени и почты обычно пишут --global."));
    return true;
  }

  function gitInit(w, lines) {
    const d = curDir(w);
    if (!d) {
      lines.push(err("Лучше не делать репозиторий из всей домашней папки."));
      lines.push(hint("перейдите в папку проекта: cd имя_папки, и там git init"));
      return false;
    }
    if (d.repo) { lines.push(out("Reinitialized existing Git repository in /home/ученик/" + w.cwd + "/.git/")); return true; }
    d.repo = newRepo();
    lines.push(out("Initialized empty Git repository in /home/ученик/" + w.cwd + "/.git/"));
    return true;
  }

  function gitClone(w, a, lines) {
    const url = a[0];
    if (!url) { lines.push(err("fatal: You must specify a repository to clone.")); return false; }
    if (w.cwd) {
      lines.push(err("Клонировать внутрь другого проекта не стоит."));
      lines.push(hint("вернитесь в домашнюю папку: cd .. и повторите git clone"));
      return false;
    }
    const u = url.replace(/\.git$/, "").replace(/\/$/, "");
    const name = a[1] || u.split("/").pop();
    if (w.home.dirs[name]) {
      lines.push(err("fatal: destination path '" + name + "' already exists and is not an empty directory."));
      lines.push(hint("репозиторий уже скачан. Перейдите в него: cd " + name));
      return false;
    }
    lines.push(out("Cloning into '" + name + "'..."));
    const gh = w.github[u];
    if (!gh) {
      lines.push(err("remote: Repository not found."));
      lines.push(err("fatal: repository '" + url + "' not found"));
      lines.push(hint("проверьте ссылку. Правильная ссылка — на странице репозитория, кнопка «<> Code»."));
      return false;
    }
    const repo = newRepo();
    repo.remotes.origin = u;
    Object.keys(gh.branches).forEach((b) => { repo.tracking["origin/" + b] = gh.branches[b]; });
    const hb = gh.head || "main";
    repo.head = hb;
    if (gh.branches[hb]) {
      repo.branches[hb] = gh.branches[hb];
      repo.upstream[hb] = "origin/" + hb;
    }
    const tree = treeOf(w, gh.branches[hb]);
    w.home.dirs[name] = { files: clone(tree), repo: repo };
    repo.index = clone(tree);
    const n = ancestors(w, gh.branches[hb]).size;
    lines.push(out("remote: Enumerating objects: " + (n * 3) + ", done."));
    lines.push(out("Receiving objects: 100% (" + (n * 3) + "/" + (n * 3) + "), done."));
    lines.push(hint("репозиторий скачан в папку " + name + ". Не забудьте перейти в неё: cd " + name));
    return true;
  }

  function trackingLine(w, repo, lines) {
    const up = repo.upstream[repo.head];
    if (!up || !(up in repo.tracking)) return;
    const l = headId(repo), r = repo.tracking[up];
    const ahead = countBetween(w, r, l), behind = countBetween(w, l, r);
    if (!ahead && !behind) lines.push(out("Your branch is up to date with '" + up + "'."));
    else if (ahead && !behind) {
      lines.push(out("Your branch is ahead of '" + up + "' by " + ahead + " commit" + (ahead > 1 ? "s" : "") + "."));
      lines.push(out('  (use "git push" to publish your local commits)'));
    } else if (!ahead && behind) {
      lines.push(out("Your branch is behind '" + up + "' by " + behind + " commit" + (behind > 1 ? "s" : "") + ", and can be fast-forwarded."));
      lines.push(out('  (use "git pull" to update your local branch)'));
    } else {
      lines.push(out("Your branch and '" + up + "' have diverged,"));
      lines.push(out("and have " + ahead + " and " + behind + " different commits each, respectively."));
      lines.push(out('  (use "git pull" if you want to integrate the remote branch with yours)'));
    }
  }

  function gitStatus(w, lines) {
    const repo = curRepo(w);
    const s = fileStatus(w);
    lines.push(out("On branch " + repo.head));
    if (!headId(repo)) { lines.push(out("")); lines.push(out("No commits yet")); }
    else trackingLine(w, repo, lines);
    if (repo.merging) {
      lines.push(out(""));
      if (s.unmerged.length) {
        lines.push(out("You have unmerged paths."));
        lines.push(out('  (fix conflicts and run "git commit")'));
      } else {
        lines.push(out("All conflicts fixed but you are still merging."));
        lines.push(out('  (use "git commit" to conclude merge)'));
      }
    }
    if (s.staged.length) {
      lines.push(out(""));
      lines.push(out("Changes to be committed:"));
      lines.push(out('  (use "git restore --staged <file>..." to unstage)'));
      s.staged.forEach((x) => lines.push(out("\t" + (x.kind + ":").padEnd(12) + x.p, "staged")));
    }
    if (s.unmerged.length) {
      lines.push(out(""));
      lines.push(out("Unmerged paths:"));
      lines.push(out('  (use "git add <file>..." to mark resolution)'));
      s.unmerged.forEach((p) => lines.push(out("\tboth modified:   " + p, "err")));
    }
    if (s.unstaged.length) {
      lines.push(out(""));
      lines.push(out("Changes not staged for commit:"));
      lines.push(out('  (use "git add <file>..." to update what will be committed)'));
      s.unstaged.forEach((x) => lines.push(out("\t" + (x.kind + ":").padEnd(12) + x.p, "err")));
    }
    if (s.untracked.length) {
      lines.push(out(""));
      lines.push(out("Untracked files:"));
      lines.push(out('  (use "git add <file>..." to include in what will be committed)'));
      s.untracked.forEach((p) => lines.push(out("\t" + p, "err")));
    }
    lines.push(out(""));
    if (!s.staged.length && !s.unstaged.length && !s.unmerged.length) {
      if (s.untracked.length) lines.push(out('nothing added to commit but untracked files present (use "git add" to track)'));
      else lines.push(out("nothing to commit, working tree clean"));
    } else if (!s.staged.length && !repo.merging) lines.push(out('no changes added to commit (use "git add" and/or "git commit -a")'));
    return true;
  }

  function gitAdd(w, a, lines) {
    const repo = curRepo(w), wt = worktree(w);
    const force = a.includes("-f") || a.includes("--force");
    const specs = a.filter((x) => !x.startsWith("-"));
    const all = a.includes("-A") || a.includes("--all");
    if (!specs.length && !all) {
      lines.push(out("Nothing specified, nothing added."));
      lines.push(hint("укажите файл (git add имя_файла) или точку, чтобы добавить всё: git add ."));
      return false;
    }
    const known = new Set([...Object.keys(wt), ...Object.keys(repo.index)]);
    const chosen = new Set();
    const ignoredHit = [];
    let ok = true;
    const addAll = all || specs.includes(".") || specs.includes("*");
    specs.filter((x) => x !== "." && x !== "*").forEach((sp) => {
      const sp2 = sp.replace(/\/$/, "");
      const re = sp2.includes("*") ? globToRe(sp2) : null;
      const matched = [...known].filter((p) => p === sp2 || p.startsWith(sp2 + "/") || (re && re.test(p)));
      if (!matched.length) {
        lines.push(err("fatal: pathspec '" + sp + "' did not match any files"));
        lines.push(hint("проверьте имя файла: ls. Имена чувствительны к регистру и расширению."));
        ok = false;
        return;
      }
      matched.forEach((p) => {
        if (!(p in repo.index) && isIgnored(wt, p) && !force) {
          if (p === sp2) ignoredHit.push(p);
        } else chosen.add(p);
      });
    });
    if (!ok) return false;
    if (addAll) known.forEach((p) => { if ((p in repo.index) || !isIgnored(wt, p)) chosen.add(p); });
    if (ignoredHit.length) {
      lines.push(err("The following paths are ignored by one of your .gitignore files:"));
      ignoredHit.forEach((p) => lines.push(err(p)));
      lines.push(err('hint: Use -f if you really want to add them.'));
      lines.push(hint("файлы из .gitignore в репозиторий не кладём — так и задумано."));
      if (!chosen.size) return false;
    }
    chosen.forEach((p) => {
      if (p in wt) repo.index[p] = wt[p];
      else delete repo.index[p];
      const k = repo.unmerged.indexOf(p);
      if (k >= 0) {
        repo.unmerged.splice(k, 1);
        if (/^(<<<<<<<|=======|>>>>>>>)/m.test(wt[p] || "")) {
          lines.push(out("Внимание: в " + p + " остались метки конфликта <<<<<<< ======= >>>>>>>. Git не проверяет это за вас!", "warn"));
        }
      }
    });
    return true;
  }

  function parseMsg(a) {
    let msg = null, all = false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === "-m" || x === "--message") { msg = a[i + 1]; i++; }
      else if (x === "-am" || x === "-a") { all = true; if (x === "-am") { msg = a[i + 1]; i++; } }
      else if (x.startsWith("-m") && x.length > 2) msg = x.slice(2);
    }
    return { msg: msg, all: all };
  }

  function gitCommit(w, a, lines) {
    const repo = curRepo(w);
    if (!w.config["user.name"] || !w.config["user.email"]) {
      lines.push(err("Author identity unknown"));
      lines.push(out(""));
      lines.push(out("*** Please tell me who you are."));
      lines.push(out(""));
      lines.push(out("Run"));
      lines.push(out(""));
      lines.push(out('  git config --global user.email "you@example.com"'));
      lines.push(out('  git config --global user.name "Your Name"'));
      lines.push(out(""));
      lines.push(err("fatal: unable to auto-detect email address"));
      lines.push(hint("git должен знать, кто автор коммита. Выполните две команды git config выше со своими данными."));
      return false;
    }
    const m = parseMsg(a);
    if (m.all) {
      const wt = worktree(w);
      Object.keys(repo.index).forEach((p) => { if (p in wt) repo.index[p] = wt[p]; else delete repo.index[p]; });
    }
    if (repo.unmerged.length) {
      lines.push(err("error: Committing is not possible because you have unmerged files."));
      lines.push(err("hint: Fix them up in the work tree, and then use 'git add/rm <file>'"));
      lines.push(err("fatal: Exiting because of an unresolved conflict."));
      lines.push(hint("исправьте файлы с конфликтом (" + repo.unmerged.join(", ") + ") и сделайте git add."));
      return false;
    }
    let msg = m.msg;
    if (msg === null || msg === undefined) {
      if (repo.merging) msg = repo.merging.msg;
      else {
        lines.push(err("Тренажёр не открывает редактор для подписи коммита."));
        lines.push(hint('добавьте подпись: git commit -m "Что сделал"'));
        return false;
      }
    }
    if (!msg.trim()) { lines.push(err("Aborting commit due to empty commit message.")); return false; }
    const parent = headId(repo);
    const headTree = treeOf(w, parent);
    const changed = diffNames(headTree, repo.index);
    if (!changed.length && !repo.merging) {
      gitStatus(w, lines);
      lines.push(hint("в коммит попадает только то, что добавлено командой git add. Сначала git add."));
      return false;
    }
    const parents = parent ? [parent] : [];
    if (repo.merging) parents.push(repo.merging.theirs);
    const id = makeCommit(w, msg, parents, repo.index);
    repo.branches[repo.head] = id;
    repo.merging = null;
    lines.push(out("[" + repo.head + (parent ? "" : " (root-commit)") + " " + id.slice(0, 7) + "] " + msg));
    lines.push(out(" " + changed.length + " file" + (changed.length === 1 ? "" : "s") + " changed"));
    changed.forEach((p) => { if (!(p in headTree)) lines.push(out(" create mode 100644 " + p)); });
    return true;
  }

  function refsFor(w, repo, id) {
    const r = [];
    Object.keys(repo.branches).forEach((b) => {
      if (repo.branches[b] === id) r.push(b === repo.head ? "HEAD -> " + b : b);
    });
    r.sort((x, y) => (x.startsWith("HEAD") ? -1 : y.startsWith("HEAD") ? 1 : 0));
    Object.keys(repo.tracking).forEach((b) => { if (repo.tracking[b] === id) r.push(b); });
    return r;
  }

  function orderedLog(w, tips) {
    const set = new Set();
    tips.forEach((t) => ancestors(w, t).forEach((c) => set.add(c)));
    return [...set].map((c) => w.objects[c]).sort((a, b) => b.seq - a.seq);
  }

  function gitLog(w, a, lines) {
    const repo = curRepo(w);
    const one = a.includes("--oneline");
    const allF = a.includes("--all");
    const rest = a.filter((x) => !x.startsWith("-"));
    let tips;
    if (allF) tips = Object.values(repo.branches).concat(Object.values(repo.tracking));
    else if (rest.length) {
      const id = resolveRef(w, repo, rest[0]);
      if (!id) { lines.push(err("fatal: ambiguous argument '" + rest[0] + "': unknown revision")); return false; }
      tips = [id];
    } else tips = [headId(repo)];
    tips = tips.filter(Boolean);
    if (!tips.length) {
      lines.push(err("fatal: your current branch '" + repo.head + "' does not have any commits yet"));
      lines.push(hint("истории пока нет — сделайте первый коммит."));
      return false;
    }
    orderedLog(w, tips).forEach((c) => {
      const refs = refsFor(w, repo, c.id);
      const r = refs.length ? " (" + refs.join(", ") + ")" : "";
      if (one) lines.push(out(c.id.slice(0, 7) + r + " " + c.msg, "log"));
      else {
        lines.push(out("commit " + c.id + "0000000000000000000000".slice(0, 24) + r, "logh"));
        if (c.parents.length > 1) lines.push(out("Merge: " + c.parents.map((p) => p.slice(0, 7)).join(" ")));
        lines.push(out("Author: " + c.author.name + " <" + c.author.email + ">"));
        lines.push(out("Date:   " + new Date(c.time).toLocaleString("ru-RU")));
        lines.push(out(""));
        lines.push(out("    " + c.msg));
        lines.push(out(""));
      }
    });
    return true;
  }

  function resolveRef(w, repo, name) {
    if (!name) return null;
    if (name === "HEAD") return headId(repo);
    if (name in repo.branches) return repo.branches[name];
    if (name in repo.tracking) return repo.tracking[name];
    if (name.length >= 4) {
      const ids = Object.keys(w.objects).filter((id) => id.startsWith(name.toLowerCase()));
      if (ids.length === 1) return ids[0];
    }
    return null;
  }

  function gitShow(w, a, lines) {
    const repo = curRepo(w);
    const ref = a.filter((x) => !x.startsWith("-"))[0] || "HEAD";
    const id = resolveRef(w, repo, ref);
    if (!id) {
      lines.push(err("fatal: ambiguous argument '" + ref + "': unknown revision or path not in the working tree."));
      lines.push(hint("id коммита — первые 7 знаков из git log --oneline."));
      return false;
    }
    const c = w.objects[id];
    lines.push(out("commit " + c.id, "logh"));
    lines.push(out("Author: " + c.author.name + " <" + c.author.email + ">"));
    lines.push(out(""));
    lines.push(out("    " + c.msg));
    lines.push(out(""));
    const pt = treeOf(w, c.parents[0]);
    diffNames(pt, c.tree).forEach((p) => diffFile(p, pt[p], c.tree[p], lines));
    return true;
  }

  function diffFile(p, a, b, lines) {
    lines.push(out("diff --git a/" + p + " b/" + p, "logh"));
    const A = a === undefined ? [] : a.split("\n"), B = b === undefined ? [] : b.split("\n");
    let pre = 0;
    while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    let suf = 0;
    while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
    if (pre > 0) lines.push(out(" " + A[pre - 1]));
    A.slice(pre, A.length - suf).forEach((l) => lines.push(out("-" + l, "del")));
    B.slice(pre, B.length - suf).forEach((l) => lines.push(out("+" + l, "ins")));
    if (suf > 0) lines.push(out(" " + A[A.length - suf]));
  }

  function gitDiff(w, a, lines) {
    const repo = curRepo(w), wt = worktree(w);
    const staged = a.includes("--staged") || a.includes("--cached");
    const from = staged ? treeOf(w, headId(repo)) : repo.index;
    const to = staged ? repo.index : wt;
    const names = diffNames(from, to).filter((p) => staged || p in from);
    names.forEach((p) => diffFile(p, from[p], to[p], lines));
    if (!names.length && !staged && diffNames(treeOf(w, headId(repo)), repo.index).length) {
      lines.push(hint("пусто, потому что изменения уже добавлены (git add). Посмотреть их: git diff --staged"));
    }
    return true;
  }

  function validBranchName(n) {
    return n && !/[\s~^:?*\[\\]/.test(n) && !n.startsWith("-") && !n.endsWith(".") && !n.includes("..");
  }

  function gitBranch(w, a, lines) {
    const repo = curRepo(w);
    if (a.includes("-d") || a.includes("-D")) {
      const n = a.filter((x) => !x.startsWith("-"))[0];
      if (!(n in repo.branches)) { lines.push(err("error: branch '" + n + "' not found.")); return false; }
      if (n === repo.head) { lines.push(err("error: cannot delete branch '" + n + "' used by worktree")); return false; }
      if (a.includes("-d") && !isAncestor(w, repo.branches[n], headId(repo))) {
        lines.push(err("error: the branch '" + n + "' is not fully merged."));
        lines.push(hint("в ветке есть коммиты, которых нет в текущей. Сначала слейте её."));
        return false;
      }
      lines.push(out("Deleted branch " + n + " (was " + repo.branches[n].slice(0, 7) + ")."));
      delete repo.branches[n];
      return true;
    }
    const names = a.filter((x) => !x.startsWith("-"));
    if (!names.length) {
      const bs = new Set(Object.keys(repo.branches));
      if (!headId(repo)) bs.add(repo.head);
      [...bs].sort().forEach((b) => lines.push(out((b === repo.head ? "* " : "  ") + b, b === repo.head ? "cur" : "")));
      if (a.includes("-a") || a.includes("-r")) Object.keys(repo.tracking).sort().forEach((b) => lines.push(out("  remotes/" + b, "err")));
      return true;
    }
    const n = names[0];
    if (!headId(repo)) { lines.push(err("fatal: not a valid object name: '" + repo.head + "'")); lines.push(hint("ветку можно создать только после первого коммита.")); return false; }
    if (!validBranchName(n)) { lines.push(err("fatal: '" + n + "' is not a valid branch name")); lines.push(hint("в имени ветки не должно быть пробелов. Используйте дефис: имя-фамилия")); return false; }
    if (n in repo.branches) { lines.push(err("fatal: a branch named '" + n + "' already exists")); return false; }
    repo.branches[n] = headId(repo);
    lines.push(hint("ветка создана, но вы всё ещё в " + repo.head + ". Перейти: git checkout " + n));
    return true;
  }

  function gitCheckout(w, a, lines, verb) {
    const repo = curRepo(w);
    const create = a.includes("-b") || a.includes("-c") || a.includes("-B");
    const names = a.filter((x) => !x.startsWith("-"));
    let n = names[0];
    if (!n) { lines.push(err("fatal: missing branch name")); return false; }
    if (n === "-" ) { lines.push(err("Тренажёр не поддерживает checkout -")); return false; }
    if (create) {
      if (names.length > 1 && !resolveRef(w, repo, names[1])) {
        lines.push(err("fatal: '" + names[1] + "' is not a commit and a branch '" + n + "' cannot be created from it"));
        lines.push(hint("в имени ветки не должно быть пробелов. Используйте дефис: " + names.join("-")));
        return false;
      }
      if (!validBranchName(n)) { lines.push(err("fatal: '" + n + "' is not a valid branch name")); lines.push(hint("в имени ветки не должно быть пробелов. Используйте дефис: имя-фамилия")); return false; }
      if (n in repo.branches) {
        lines.push(err("fatal: a branch named '" + n + "' already exists"));
        lines.push(hint("ветка уже есть, просто перейдите в неё: git " + verb + " " + n));
        return false;
      }
      if (!headId(repo)) { repo.head = n; lines.push(out("Switched to a new branch '" + n + "'")); return true; }
      repo.branches[n] = headId(repo);
      repo.head = n;
      lines.push(out("Switched to a new branch '" + n + "'"));
      return true;
    }
    if (!(n in repo.branches)) {
      if (("origin/" + n) in repo.tracking) {
        const target = repo.tracking["origin/" + n];
        if (!switchTo(w, repo, target, lines)) return false;
        repo.branches[n] = target;
        repo.upstream[n] = "origin/" + n;
        repo.head = n;
        lines.push(out("branch '" + n + "' set up to track 'origin/" + n + "'."));
        lines.push(out("Switched to a new branch '" + n + "'"));
        return true;
      }
      const wt = worktree(w);
      if (verb === "checkout" && (n in wt || n === ".")) {
        return gitRestore(w, names, lines);
      }
      if (verb === "switch") lines.push(err("fatal: invalid reference: " + n));
      else lines.push(err("error: pathspec '" + n + "' did not match any file(s) known to git"));
      lines.push(hint("такой ветки нет. Список веток: git branch. Создать новую: git " + verb + (verb === "switch" ? " -c " : " -b ") + n));
      return false;
    }
    if (n === repo.head) { lines.push(out("Already on '" + n + "'")); return true; }
    if (repo.merging) { lines.push(err("error: you need to resolve your current index first")); return false; }
    if (!switchTo(w, repo, repo.branches[n], lines)) return false;
    repo.head = n;
    lines.push(out("Switched to branch '" + n + "'"));
    trackingLine(w, repo, lines);
    return true;
  }

  function switchTo(w, repo, target, lines) {
    const wt = worktree(w);
    const headT = treeOf(w, headId(repo)), newT = treeOf(w, target);
    const s = fileStatus(w);
    const dirty = s.staged.concat(s.unstaged).map((x) => x.p);
    const blocked = dirty.filter((p) => headT[p] !== newT[p]);
    const untrackedClash = s.untracked.filter((p) => p in newT && newT[p] !== wt[p]);
    if (blocked.length || untrackedClash.length) {
      if (blocked.length) {
        lines.push(err("error: Your local changes to the following files would be overwritten by checkout:"));
        blocked.forEach((p) => lines.push(err("\t" + p)));
        lines.push(err("Please commit your changes or stash them before you switch branches."));
      } else {
        lines.push(err("error: The following untracked working tree files would be overwritten by checkout:"));
        untrackedClash.forEach((p) => lines.push(err("\t" + p)));
      }
      lines.push(err("Aborting"));
      lines.push(hint("изменения нужно сначала сохранить. Если они для этой ветки — git add . и git commit -m \"...\". Если нет — унесите их в новую ветку: git checkout -b имя-ветки, и закоммитьте там."));
      return false;
    }
    const newIdx = clone(newT);
    const saveWt = {};
    dirty.forEach((p) => { saveWt[p] = wt[p]; if (repo.index[p] === undefined) delete newIdx[p]; else newIdx[p] = repo.index[p]; });
    Object.keys(headT).forEach((p) => { if (!(p in newT) && !dirty.includes(p)) delete wt[p]; });
    Object.keys(newT).forEach((p) => { if (!dirty.includes(p)) wt[p] = newT[p]; });
    dirty.forEach((p) => { if (saveWt[p] === undefined) delete wt[p]; else wt[p] = saveWt[p]; });
    repo.index = newIdx;
    return true;
  }

  function gitRestore(w, a, lines) {
    const repo = curRepo(w), wt = worktree(w);
    const staged = a.includes("--staged");
    const specs = a.filter((x) => !x.startsWith("-"));
    const head = treeOf(w, headId(repo));
    specs.forEach((sp) => {
      const ps = sp === "." ? Object.keys(Object.assign({}, repo.index, wt)) : [sp];
      ps.forEach((p) => {
        if (staged) { if (p in head) repo.index[p] = head[p]; else delete repo.index[p]; }
        else if (p in repo.index) wt[p] = repo.index[p];
      });
    });
    return true;
  }

  function gitRm(w, a, lines) {
    const repo = curRepo(w), wt = worktree(w);
    const cached = a.includes("--cached");
    const specs = a.filter((x) => !x.startsWith("-"));
    if (!specs.length) { lines.push(err("usage: git rm [--cached] <file>...")); return false; }
    for (const p of specs) {
      if (!(p in repo.index)) {
        lines.push(err("fatal: pathspec '" + p + "' did not match any files"));
        return false;
      }
    }
    specs.forEach((p) => {
      delete repo.index[p];
      if (!cached) delete wt[p];
      lines.push(out("rm '" + p + "'"));
    });
    if (cached) lines.push(hint("файл убран из git, но остался в папке."));
    return true;
  }

  function gitMerge(w, a, lines) {
    const repo = curRepo(w);
    if (a.includes("--abort")) {
      if (!repo.merging) { lines.push(err("fatal: There is no merge to abort (MERGE_HEAD missing).")); return false; }
      const t = treeOf(w, headId(repo));
      const wt = worktree(w);
      Object.keys(wt).forEach((p) => { if (p in repo.index || repo.unmerged.includes(p)) delete wt[p]; });
      Object.keys(t).forEach((p) => { wt[p] = t[p]; });
      repo.index = clone(t);
      repo.unmerged = [];
      repo.merging = null;
      lines.push(out("Слияние отменено, всё как до git merge."));
      return true;
    }
    if (repo.merging) {
      lines.push(err("error: Merging is not possible because you have unmerged files."));
      lines.push(hint("сначала закончите текущее слияние: исправьте файлы, git add, git commit."));
      return false;
    }
    const n = a.filter((x) => !x.startsWith("-"))[0];
    if (!n) { lines.push(err("fatal: No remote for the current branch.")); lines.push(hint("укажите ветку: git merge имя-ветки")); return false; }
    const id = resolveRef(w, repo, n);
    if (!id) {
      lines.push(err("merge: " + n + " - not something we can merge"));
      lines.push(hint("такой ветки нет. Список: git branch -a"));
      return false;
    }
    if (n === repo.head) { lines.push(out("Already up to date.")); return true; }
    return doMerge(w, id, n, lines);
  }

  function gitRemote(w, a, lines) {
    const repo = curRepo(w);
    if (a[0] === "add") {
      const name = a[1], url = a[2];
      if (!name || !url) { lines.push(err("usage: git remote add <name> <url>")); return false; }
      if (name in repo.remotes) { lines.push(err("error: remote " + name + " already exists.")); return false; }
      repo.remotes[name] = url.replace(/\.git$/, "").replace(/\/$/, "");
      return true;
    }
    const v = a.includes("-v");
    Object.keys(repo.remotes).forEach((r) => {
      if (v) {
        lines.push(out(r + "\t" + repo.remotes[r] + ".git (fetch)"));
        lines.push(out(r + "\t" + repo.remotes[r] + ".git (push)"));
      } else lines.push(out(r));
    });
    if (!Object.keys(repo.remotes).length) lines.push(hint("связи с GitHub нет. Её создаёт git clone или git remote add origin <ссылка>."));
    return true;
  }

  function remoteRepo(w, repo, name, lines) {
    const url = repo.remotes[name];
    if (!url) {
      lines.push(err("fatal: '" + name + "' does not appear to be a git repository"));
      lines.push(err("fatal: Could not read from remote repository."));
      lines.push(hint("у репозитория нет связи с GitHub под именем " + name + ". Проверьте: git remote -v"));
      return null;
    }
    const gh = w.github[url];
    if (!gh) {
      lines.push(err("remote: Repository not found."));
      lines.push(err("fatal: repository '" + url + "/' not found"));
      return null;
    }
    return gh;
  }

  function login(w, lines) {
    if (w.loggedIn) return;
    lines.push(out("[Открылось окно браузера: «Git Credential Manager — Sign in to GitHub»]", "note"));
    lines.push(out("[Вы нажали «Sign in with your browser» → «Authorize git-ecosystem». Вход выполнен.]", "note"));
    lines.push(hint("так бывает один раз на компьютере. Дальше git помнит вход."));
    w.loggedIn = true;
  }

  function gitPush(w, a, lines) {
    const repo = curRepo(w);
    const setUp = a.includes("-u") || a.includes("--set-upstream");
    const pos = a.filter((x) => !x.startsWith("-"));
    let remote = pos[0], branch = pos[1];
    if (!remote) {
      const up = repo.upstream[repo.head];
      if (!up) {
        if (!Object.keys(repo.remotes).length) {
          lines.push(err("fatal: No configured push destination."));
          lines.push(hint("у репозитория нет связи с GitHub. Её создаёт git clone."));
          return false;
        }
        lines.push(err("fatal: The current branch " + repo.head + " has no upstream branch."));
        lines.push(err("To push the current branch and set the remote as upstream, use"));
        lines.push(out(""));
        lines.push(err("    git push --set-upstream origin " + repo.head));
        lines.push(out(""));
        lines.push(hint("первый push новой ветки делается так: git push -u origin " + repo.head + ". Дальше — просто git push."));
        return false;
      }
      remote = up.split("/")[0];
      branch = up.slice(remote.length + 1);
    }
    if (!branch) branch = repo.head;
    const gh = remoteRepo(w, repo, remote, lines);
    if (!gh) return false;
    if (!(branch in repo.branches)) {
      lines.push(err("error: src refspec " + branch + " does not match any"));
      lines.push(hint(headId(repo) ? "такой ветки у вас нет. Текущая ветка: " + repo.head : "сначала сделайте хотя бы один коммит."));
      return false;
    }
    login(w, lines);
    const L = repo.branches[branch], R = gh.branches[branch];
    const url = repo.remotes[remote];
    if (R === L) { lines.push(out("Everything up-to-date")); if (setUp) repo.upstream[branch] = remote + "/" + branch; return true; }
    if (R && !isAncestor(w, R, L)) {
      lines.push(out("To " + url + ".git"));
      const known = repo.tracking[remote + "/" + branch] === R;
      lines.push(err(" ! [rejected]        " + branch + " -> " + branch + (known ? " (non-fast-forward)" : " (fetch first)")));
      lines.push(err("error: failed to push some refs to '" + url + ".git'"));
      lines.push(err("hint: Updates were rejected because the remote contains work that you do not"));
      lines.push(err("hint: have locally. Integrate the remote changes (e.g. 'git pull ...') before pushing again."));
      lines.push(hint("на GitHub есть чужие коммиты, которых у вас нет. Сначала git pull, потом снова git push."));
      return false;
    }
    const n = countBetween(w, R, L);
    lines.push(out("Enumerating objects: " + (n * 3) + ", done."));
    lines.push(out("Writing objects: 100% (" + (n * 3) + "/" + (n * 3) + "), done."));
    lines.push(out("To " + url + ".git"));
    if (!R) {
      lines.push(out(" * [new branch]      " + branch + " -> " + branch, "ok"));
      lines.push(out("remote:"));
      lines.push(out("remote: Create a pull request for '" + branch + "' on GitHub by visiting:"));
      lines.push(out("remote:      " + url + "/pull/new/" + branch));
    } else lines.push(out("   " + R.slice(0, 7) + ".." + L.slice(0, 7) + "  " + branch + " -> " + branch, "ok"));
    gh.branches[branch] = L;
    repo.tracking[remote + "/" + branch] = L;
    if (setUp) {
      repo.upstream[branch] = remote + "/" + branch;
      lines.push(out("branch '" + branch + "' set up to track '" + remote + "/" + branch + "'."));
    }
    return true;
  }

  function doFetch(w, repo, lines) {
    const gh = remoteRepo(w, repo, "origin", lines);
    if (!gh) return false;
    const url = repo.remotes.origin;
    let printed = false;
    Object.keys(gh.branches).forEach((b) => {
      const old = repo.tracking["origin/" + b], nw = gh.branches[b];
      if (old === nw) return;
      if (!printed) { lines.push(out("From " + url)); printed = true; }
      if (!old) lines.push(out(" * [new branch]      " + b + " -> origin/" + b));
      else lines.push(out("   " + old.slice(0, 7) + ".." + nw.slice(0, 7) + "  " + b + " -> origin/" + b));
      repo.tracking["origin/" + b] = nw;
    });
    return true;
  }

  function gitFetch(w, lines) {
    return doFetch(w, curRepo(w), lines);
  }

  function gitPull(w, a, lines) {
    const repo = curRepo(w);
    if (repo.merging) {
      lines.push(err("error: Pulling is not possible because you have unmerged files."));
      lines.push(hint("сначала закончите слияние: исправьте файлы с конфликтом, git add, git commit."));
      return false;
    }
    const pos = a.filter((x) => !x.startsWith("-"));
    let up;
    if (pos.length >= 2) up = pos[0] + "/" + pos[1];
    else up = repo.upstream[repo.head];
    if (!Object.keys(repo.remotes).length) {
      lines.push(err("fatal: No remote repository specified."));
      lines.push(hint("у репозитория нет связи с GitHub. Её создаёт git clone."));
      return false;
    }
    if (!up) {
      lines.push(err("There is no tracking information for the current branch."));
      lines.push(err("Please specify which branch you want to merge with."));
      lines.push(err("    git branch --set-upstream-to=origin/<branch> " + repo.head));
      lines.push(hint("ветка " + repo.head + " ещё не отправлена на GitHub. Сначала git push -u origin " + repo.head + ", или скажите явно: git pull origin main"));
      return false;
    }
    login(w, lines);
    if (!doFetch(w, repo, lines)) return false;
    const target = repo.tracking[up];
    if (!target) {
      lines.push(err("fatal: couldn't find remote ref " + up.split("/").slice(1).join("/")));
      return false;
    }
    const ours = headId(repo);
    const diverged = ours && !isAncestor(w, ours, target) && !isAncestor(w, target, ours);
    if (diverged && !a.includes("--no-rebase") && !("pull.rebase" in w.config)) {
      lines.push(err("hint: You have divergent branches and need to specify how to reconcile them."));
      lines.push(err("hint:   git config pull.rebase false  # merge"));
      lines.push(err("fatal: Need to specify how to reconcile divergent branches."));
      lines.push(hint("выполните один раз git config --global pull.rebase false и повторите git pull."));
      return false;
    }
    return doMerge(w, target, up, lines, "Merge branch '" + up.split("/").slice(1).join("/") + "' of " + repo.remotes.origin);
  }

  // ---------- действия «коллег» и редактор ----------

  function writeFile(w, path, text) {
    worktree(w)[path] = text;
  }

  // Коллега делает коммит прямо на GitHub в ветку branch.
  function teammatePush(w, url, branch, who, msg, changes) {
    const gh = w.github[url];
    const parent = gh.branches[branch] || null;
    const tree = clone(treeOf(w, parent));
    Object.keys(changes).forEach((p) => { if (changes[p] === null) delete tree[p]; else tree[p] = changes[p]; });
    gh.branches[branch] = makeCommit(w, msg, parent ? [parent] : [], tree, who);
    return gh.branches[branch];
  }

  // ---------- стартовые данные ----------

  const SCRIPT = [
    '"""Рисуем график по таблице CSV из папки data."""',
    "import sys",
    "import pandas as pd",
    "import matplotlib.pyplot as plt",
    "",
    'путь = sys.argv[1] if len(sys.argv) > 1 else "data/визиты_к_кормушке.csv"',
    "таблица = pd.read_csv(путь)",
    'цвет = "#E07A1F"  # поменяйте цвет',
    "таблица.plot(x=таблица.columns[0], color=цвет)",
    'plt.title(f"Данные из файла {путь}")  # поменяйте заголовок',
    'plt.savefig("график.png")',
  ].join("\n");

  const FEEDER = "дата,температура,визиты\n2025-11-03,4,12\n2025-11-04,2,15\n2025-11-05,-1,21\n2025-11-06,-3,27\n2025-11-07,0,19";
  const STEPS = "дата,шаги,минуты_на_дорогу\n2026-09-21,6400,35\n2026-09-22,8100,40\n2026-09-23,5200,30";
  const README = "# Учебный проект\n\nСкрипт рисует график по таблице из папки data.\n\nЗапуск: python 01_график.py";
  const GITIGNORE = "venv/\n__pycache__/\n*.png\n.env";

  const NASTYA = { name: "Аня Смирнова", email: "anya@example.com" };
  const PETYA = { name: "Миша Орлов", email: "misha@example.com" };
  const TEACHER = { name: "Руководитель", email: "teacher@example.com" };

  function me(w) {
    w.config["user.name"] = "Ученик";
    w.config["user.email"] = "uchenik@example.com";
    w.config["pull.rebase"] = "false";
    return w;
  }

  // Локальный проект без git.
  function worldProject(withGit) {
    const w = newWorld();
    w.home.dirs["проект"] = {
      files: { "01_график.py": SCRIPT, "README.md": README, "data/визиты_к_кормушке.csv": FEEDER },
      repo: null,
    };
    w.home.dirs["фото"] = { files: { "кот.jpg": "[фото]" }, repo: null };
    if (withGit) {
      me(w);
      const d = w.home.dirs["проект"];
      d.repo = newRepo();
      const c1 = makeCommit(w, "Добавил скрипт графика", [], { "01_график.py": SCRIPT }, w.config && { name: "Ученик", email: "uchenik@example.com" });
      const t2 = { "01_график.py": SCRIPT, "data/визиты_к_кормушке.csv": FEEDER };
      const c2 = makeCommit(w, "Добавил данные о кормушке", [c1], t2, { name: "Ученик", email: "uchenik@example.com" });
      const t3 = Object.assign({}, t2, { "README.md": README });
      const c3 = makeCommit(w, "Написал README", [c2], t3, { name: "Ученик", email: "uchenik@example.com" });
      d.repo.branches.main = c3;
      d.repo.index = clone(t3);
      w.cwd = "проект";
    }
    return w;
  }

  // «GitHub» с репозиторием git-praktika и (опционально) уже склонированной копией.
  function worldGithub(cloned) {
    const w = me(newWorld());
    const t1 = { "01_график.py": SCRIPT, "README.md": README, ".gitignore": GITIGNORE, "data/визиты_к_кормушке.csv": FEEDER, "data/пример_шаги.csv": STEPS };
    const c1 = makeCommit(w, "Учебный репозиторий: скрипт графика и данные", [], t1, TEACHER);
    w.github[PRAKTIKA_URL] = { branches: { main: c1 }, head: "main" };
    w.home.dirs["проект"] = { files: { "01_график.py": SCRIPT }, repo: null };
    if (cloned) {
      w.loggedIn = true;
      w.cwd = "";
      const l = [];
      gitClone(w, [PRAKTIKA_URL], l);
      w.cwd = "git-praktika";
    }
    return w;
  }

  // ---------- проверки для уровней ----------

  const H = {
    ran: (w, re) => w.history.some((h) => re.test(h.cmd)),
    ranOk: (w, re) => w.history.some((h) => h.ok && re.test(h.cmd)),
    failed: (w, re) => w.history.some((h) => !h.ok && re.test(h.cmd)),
    repo: (w, dir) => (w.home.dirs[dir] && w.home.dirs[dir].repo) || null,
    tip: (w, dir, b) => { const r = H.repo(w, dir); return r ? r.branches[b] || null : null; },
    tree: (w, id) => (id ? w.objects[id].tree : {}),
    commitsOn: (w, dir, b) => { const t = H.tip(w, dir, b); return t ? ancestors(w, t).size : 0; },
    clean: (w, dir) => { const save = w.cwd; w.cwd = dir; const r = curRepo(w) ? isClean(w) && !fileStatus(w).untracked.length : false; w.cwd = save; return r; },
    gh: (w) => w.github[PRAKTIKA_URL],
    otherBranch: (w, dir) => { const r = H.repo(w, dir); return r ? Object.keys(r.branches).filter((b) => b !== "main") : []; },
    noMarkers: (t) => t !== undefined && !/^(<<<<<<<|=======|>>>>>>>)/m.test(t),
    lastMsg: (w, id) => (id ? w.objects[id].msg : ""),
  };

  // ---------- уровни ----------

  const LEVELS = [
    // Блок 1. Основы
    {
      id: "l1", block: 1, title: "Представьтесь git",
      story: "Каждый коммит подписан автором. Перед первой работой git нужно один раз сказать, кто вы. На настоящем компьютере это делается тоже один раз.",
      setup: () => worldProject(false),
      goals: [
        { text: "Указать имя: git config --global user.name \"Имя Фамилия\"", test: (w) => !!w.config["user.name"] },
        { text: "Указать почту: git config --global user.email \"почта\"", test: (w) => !!w.config["user.email"] },
        { text: "Проверить настройки: git config --list", test: (w) => H.ranOk(w, /^git config (--global )?(--list|-l)/) },
      ],
      hints: ["Имя пишите в кавычках, если в нём есть пробел: git config --global user.name \"Аня Смирнова\"", "Почта — та же, что на GitHub."],
      solution: ['git config --global user.name "Тест Тестов"', 'git config --global user.email "test@example.com"', "git config --list"],
    },
    {
      id: "l2", block: 1, title: "Первый репозиторий",
      story: "Сейчас вы в домашней папке. Попробуйте git status прямо здесь и посмотрите на ошибку — она будет встречаться часто. Потом перейдите в папку проект и сделайте её репозиторием.",
      setup: () => me(worldProject(false)),
      goals: [
        { text: "Увидеть ошибку «not a git repository» в домашней папке", test: (w) => w.history.some((h) => !h.ok && /^git /.test(h.cmd) && /not a git repository/.test(h.text)) },
        { text: "Перейти в папку проект: cd проект", test: (w) => H.ranOk(w, /^cd (~\/)?проект/) },
        { text: "Создать репозиторий: git init", test: (w) => !!H.repo(w, "проект") },
        { text: "Посмотреть состояние: git status", test: (w) => w.history.some((h) => h.ok && h.cmd === "git status" && h.cwd === "проект") },
      ],
      hints: ["Посмотреть папки: ls", "Красные файлы в «Untracked files» git видит, но пока не хранит."],
      solution: ["git status", "ls", "cd проект", "git init", "git status"],
    },
    {
      id: "l3", block: 1, title: "Первый коммит",
      story: "Коммит — сохранённая версия с подписью. В него попадает только то, что вы отметили командой git add. Сохраните одним коммитом скрипт 01_график.py.",
      setup: () => { const w = me(worldProject(false)); w.cwd = "проект"; w.home.dirs["проект"].repo = newRepo(); return w; },
      goals: [
        { text: "Добавить скрипт в индекс: git add 01_график.py", test: (w) => { const r = H.repo(w, "проект"); return r && ("01_график.py" in r.index); } },
        { text: "Сделать коммит со скриптом: git commit -m \"Добавил скрипт\"", test: (w) => "01_график.py" in H.tree(w, H.tip(w, "проект", "main")) },
        { text: "Посмотреть git status после коммита", test: (w) => w.history.some((h, i) => h.cmd === "git status" && w.history.slice(0, i).some((x) => x.ok && /^git commit/.test(x.cmd))) },
      ],
      hints: ["Подпись коммита — в кавычках после -m.", "Посмотрите на схему справа: файл переезжает «папка → индекс → коммит»."],
      solution: ["git add 01_график.py", 'git commit -m "Добавил скрипт графика"', "git status"],
    },
    {
      id: "l4", block: 1, title: "Всё сразу",
      story: "Обычно добавляют все изменения разом: git add . (точка — «всё в этой папке»). Сохраните оставшиеся файлы вторым коммитом, чтобы git status сказал «working tree clean».",
      setup: () => {
        const w = me(worldProject(false)); w.cwd = "проект"; const d = w.home.dirs["проект"]; d.repo = newRepo();
        const c = makeCommit(w, "Добавил скрипт графика", [], { "01_график.py": SCRIPT }); d.repo.branches.main = c; d.repo.index = { "01_график.py": SCRIPT }; return w;
      },
      goals: [
        { text: "В истории 2 коммита", test: (w) => H.commitsOn(w, "проект", "main") >= 2 },
        { text: "Рабочая папка чистая (nothing to commit, working tree clean)", test: (w) => H.commitsOn(w, "проект", "main") >= 2 && H.clean(w, "проект") },
      ],
      hints: ["git add .  →  git commit -m \"Добавил данные и README\"  →  git status"],
      solution: ["git add .", 'git commit -m "Добавил данные и README"', "git status"],
    },
    {
      id: "l5", block: 1, title: "Забыл add",
      story: "Частая ошибка: поменять файл и сразу написать git commit. Здесь уже изменён README.md и появился новый файл с шагами. Попробуйте сначала закоммитить без add — и посмотрите, что скажет git. Потом сделайте правильно.",
      setup: () => {
        const w = worldProject(true);
        const f = w.home.dirs["проект"].files;
        f["README.md"] = README + "\n\nАвтор: ученик 7 класса";
        f["data/шаги.csv"] = STEPS;
        return w;
      },
      goals: [
        { text: "Попробовать git commit без add и увидеть отказ", test: (w) => H.failed(w, /^git commit/) },
        { text: "Сохранить оба изменения в новом коммите", test: (w) => { const t = H.tree(w, H.tip(w, "проект", "main")); return t["README.md"] && t["README.md"].includes("Автор") && ("data/шаги.csv" in t); } },
        { text: "Рабочая папка чистая", test: (w) => H.commitsOn(w, "проект", "main") >= 4 && H.clean(w, "проект") },
      ],
      hints: ["Что изменилось в файле: git diff", "Порядок всегда такой: git add → git commit."],
      solution: ['git commit -m "Обновил README"', "git diff", "git add .", 'git commit -m "Обновил README, добавил шаги"'],
    },
    {
      id: "l6", block: 1, title: "Машина времени",
      story: "История нужна, чтобы найти, когда и что поменяли. Посмотрите историю кратко, найдите коммит, в котором добавили данные о кормушке, и откройте его командой git show <id>.",
      setup: () => worldProject(true),
      goals: [
        { text: "Посмотреть историю: git log --oneline", test: (w) => H.ranOk(w, /^git log.*--oneline/) },
        { text: "Открыть коммит «Добавил данные о кормушке»: git show <первые 7 знаков id>", test: (w) => w.history.some((h) => h.ok && /^git show /.test(h.cmd) && /Добавил данные о кормушке/.test(h.text)) },
      ],
      hints: ["id — это 7 букв и цифр в начале строки git log --oneline, например a1b2c3d.", "Полная история с авторами и датами: git log"],
      solution: ["git log --oneline", (w) => "git show " + orderedLog(w, [H.tip(w, "проект", "main")]).find((c) => /кормушке/.test(c.msg)).id.slice(0, 7)],
    },
    // Блок 2. Ветки
    {
      id: "l7", block: 2, title: "Своя ветка",
      story: "Ветка — отдельная линия истории. В ней можно пробовать что угодно и не мешать остальным. Создайте ветку со своим именем (латиницей или кириллицей, без пробелов, через дефис), поменяйте цвет в скрипте и закоммитьте.",
      setup: () => worldProject(true),
      goals: [
        { text: "Создать ветку и перейти в неё: git checkout -b имя-фамилия", test: (w) => { const r = H.repo(w, "проект"); return r.head !== "main"; } },
        { text: "Изменить 01_график.py (edit 01_график.py — строка с цветом)", test: (w) => { const r = H.repo(w, "проект"); return w.home.dirs["проект"].files["01_график.py"] !== SCRIPT || H.otherBranch(w, "проект").some((b) => H.tree(w, r.branches[b])["01_график.py"] !== SCRIPT); } },
        { text: "Закоммитить изменение в своей ветке", test: (w) => { const r = H.repo(w, "проект"); return H.otherBranch(w, "проект").some((b) => r.branches[b] !== r.branches.main && H.tree(w, r.branches[b])["01_график.py"] !== SCRIPT); } },
      ],
      hints: ["В редакторе поменяйте #E07A1F на другой цвет, например #2E7DAF, и нажмите «Сохранить».", "Пробел в имени ветки не пройдёт: git checkout -b ivan-petrov"],
      solution: ["git checkout -b test-testov", (w) => { writeFile(w, "01_график.py", SCRIPT.replace("#E07A1F", "#2E7DAF")); return "git status"; }, "git add .", 'git commit -m "Поменял цвет графика"'],
    },
    {
      id: "l8", block: 2, title: "Прыжки между ветками",
      story: "У коллег свои ветки: птицы и шаги. Переключитесь в ветку шаги, найдите файл, которого нет в main, и прочитайте его. Затем вернитесь в main и убедитесь, что файла там нет — ветки не мешают друг другу.",
      setup: () => {
        const w = worldProject(true); const r = w.home.dirs["проект"].repo;
        const base = r.branches.main;
        const t1 = Object.assign({}, H.tree(w, base), { "data/шаги_ани.csv": STEPS });
        r.branches["шаги"] = makeCommit(w, "Добавила свои шаги", [base], t1, NASTYA);
        const t2 = Object.assign({}, H.tree(w, base), { "01_график.py": SCRIPT.replace("Данные из файла", "Птицы у кормушки") });
        r.branches["птицы"] = makeCommit(w, "Заголовок про птиц", [base], t2, PETYA);
        return w;
      },
      goals: [
        { text: "Посмотреть список веток: git branch", test: (w) => H.ranOk(w, /^git branch$/) },
        { text: "Перейти в ветку шаги", test: (w) => w.history.some((h) => h.ok && /^git (checkout|switch) шаги$/.test(h.cmd)) },
        { text: "Прочитать новый файл: cat data/шаги_ани.csv", test: (w) => H.ranOk(w, /^cat data\/шаги_ани\.csv/) },
        { text: "Вернуться в main", test: (w) => H.repo(w, "проект").head === "main" && H.ranOk(w, /^git (checkout|switch) main/) },
      ],
      hints: ["Файлы ветки: ls data", "Звёздочка в git branch показывает, где вы сейчас."],
      solution: ["git branch", "git checkout шаги", "ls data", "cat data/шаги_ани.csv", "git checkout main", "ls data"],
    },
    {
      id: "l9", block: 2, title: "Ветка без спроса",
      story: "Вы поменяли файл в main, а потом решили переключиться в другую ветку. Git не даст потерять изменения, если они мешают. Сначала посмотрите на отказ, затем правильно: создайте свою ветку с этими изменениями и закоммитьте их там.",
      setup: () => {
        const w = worldProject(true); const r = w.home.dirs["проект"].repo; const base = r.branches.main;
        const t2 = Object.assign({}, H.tree(w, base), { "01_график.py": SCRIPT.replace("Данные из файла", "Птицы у кормушки") });
        r.branches["птицы"] = makeCommit(w, "Заголовок про птиц", [base], t2, PETYA);
        w.home.dirs["проект"].files["01_график.py"] = SCRIPT.replace("Данные из файла", "Мой график");
        return w;
      },
      goals: [
        { text: "Попробовать git checkout птицы и получить отказ", test: (w) => w.history.some((h) => !h.ok && /^git (checkout|switch) птицы/.test(h.cmd)) },
        { text: "Создать свою ветку: git checkout -b ... (изменения переедут с вами)", test: (w) => H.otherBranch(w, "проект").some((b) => b !== "птицы") },
        { text: "Закоммитить «Мой график» в своей ветке, main не трогать", test: (w) => { const r = H.repo(w, "проект"); return H.tree(w, r.branches.main)["01_график.py"] === SCRIPT && H.otherBranch(w, "проект").some((b) => b !== "птицы" && (H.tree(w, r.branches[b])["01_график.py"] || "").includes("Мой график")); } },
      ],
      hints: ["Незакоммиченные изменения «едут» с вами в новую ветку, созданную через checkout -b.", "Порядок: git checkout -b мой-график → git add . → git commit -m \"...\". Коммитить до создания ветки нельзя — коммит попадёт в main."],
      trap: { test: (w) => H.tree(w, H.tip(w, "проект", "main"))["01_график.py"] !== SCRIPT, text: "Вы закоммитили изменения в main, а по заданию main трогать нельзя. Отменять коммиты мы пока не проходим — нажмите «Начать уровень заново» и сначала создайте ветку (git checkout -b …), а коммит сделайте уже в ней." },
      solution: ["git checkout птицы", "git checkout -b мой-график", "git add .", 'git commit -m "Мой заголовок графика"'],
      bad: ["git checkout птицы", "git add .", 'git commit -m "Мой график"', "git checkout -b my_branch"],
    },
    {
      id: "l10", block: 2, title: "Слияние",
      story: "Работа в ветке готова — её сливают в main. Для этого переходят в main и пишут git merge <ветка>. На GitHub это делает кнопка Merge в pull request, но внутри происходит то же самое.",
      setup: () => {
        const w = worldProject(true); const r = w.home.dirs["проект"].repo; const base = r.branches.main;
        const t1 = Object.assign({}, H.tree(w, base), { "data/шаги.csv": STEPS });
        const c1 = makeCommit(w, "Добавил шаги", [base], t1);
        const t2 = Object.assign({}, t1, { "01_график.py": SCRIPT.replace("#E07A1F", "#2F6B45") });
        r.branches["данные"] = makeCommit(w, "Зелёный цвет для шагов", [c1], t2);
        return w;
      },
      goals: [
        { text: "Посмотреть, что в ветке данные: git log --oneline данные", test: (w) => H.ranOk(w, /^git log.*данные/) },
        { text: "Слить ветку данные в main", test: (w) => { const r = H.repo(w, "проект"); return isAncestor(w, r.branches["данные"], r.branches.main); } },
        { text: "Проверить: в main появился файл data/шаги.csv", test: (w) => H.ranOk(w, /^(ls|cat)/) && "data/шаги.csv" in H.tree(w, H.tip(w, "проект", "main")) && H.repo(w, "проект").head === "main" },
      ],
      hints: ["Вы уже в main. git merge данные", "Fast-forward — значит, main просто «догнал» ветку, отдельный коммит не нужен."],
      solution: ["git log --oneline данные", "git merge данные", "ls data"],
    },
    // Блок 3. GitHub
    {
      id: "l11", block: 3, title: "Скачать с GitHub",
      story: "Руководитель создал на GitHub репозиторий курса. Скачайте его к себе командой git clone. Ссылка: " + PRAKTIKA_URL + ".git (на настоящем GitHub — кнопка «<> Code» → HTTPS).",
      setup: () => worldGithub(false),
      goals: [
        { text: "Склонировать репозиторий", test: (w) => !!H.repo(w, "git-praktika") },
        { text: "Перейти в папку git-praktika", test: (w) => w.cwd === "git-praktika" || w.history.some((h) => h.ok && /^cd (~\/)?git-praktika/.test(h.cmd)) },
        { text: "Проверить связь с GitHub: git remote -v", test: (w) => w.history.some((h) => h.ok && /^git remote -v/.test(h.cmd) && h.cwd === "git-praktika") },
      ],
      hints: ["git clone " + PRAKTIKA_URL + ".git", "origin — это короткое имя GitHub-копии, по нему делают push и pull."],
      solution: ["git clone " + PRAKTIKA_URL + ".git", "cd git-praktika", "git remote -v"],
    },
    {
      id: "l12", block: 3, title: "Первый push",
      story: "Отправьте свою работу на GitHub. В общий main напрямую не пишем — только в свою ветку. Создайте ветку, добавьте файл data/мои_шаги.csv (можно через edit) и отправьте. Первый push откроет окно входа в GitHub.",
      setup: () => { const w = worldGithub(true); w.loggedIn = false; return w; },
      goals: [
        { text: "Создать свою ветку", test: (w) => H.otherBranch(w, "git-praktika").length > 0 },
        { text: "Закоммитить новый файл в data/", test: (w) => { const r = H.repo(w, "git-praktika"); return H.otherBranch(w, "git-praktika").some((b) => Object.keys(H.tree(w, r.branches[b])).some((p) => p.startsWith("data/") && !(p in H.tree(w, r.branches.main)))); } },
        { text: "Отправить ветку: git push -u origin <ветка>", test: (w) => Object.keys(H.gh(w).branches).some((b) => b !== "main") },
        { text: "main на GitHub не тронут", test: (w) => Object.keys(H.gh(w).branches).some((b) => b !== "main") && countBetween(w, null, H.gh(w).branches.main) === 1 },
      ],
      hints: ["echo \"дата,шаги\" > data/мои_шаги.csv — создаёт файл с одной строкой", "Первый push новой ветки: git push -u origin имя-ветки. Просто git push выдаст подсказку."],
      trap: { test: (w) => countBetween(w, null, H.gh(w).branches.main) > 1, text: "Вы отправили работу в общий main на GitHub, а договорились — только в свою ветку. Нажмите «Начать уровень заново»: сначала git checkout -b имя-ветки, потом коммит и git push -u origin имя-ветки." },
      solution: ["git checkout -b test", 'echo "дата,шаги" > data/мои_шаги.csv', 'echo "2026-09-28,5000" >> data/мои_шаги.csv', "git add .", 'git commit -m "Добавил мои шаги"', "git push", "git push -u origin test"],
    },
    {
      id: "l13", block: 3, title: "Забрать чужое",
      story: "Пока вас не было, Аня и руководитель отправили в main новые файлы. У вас их ещё нет. Посмотрите git status, затем заберите изменения командой git pull.",
      setup: () => {
        const w = worldGithub(true);
        teammatePush(w, PRAKTIKA_URL, "main", NASTYA, "Добавила данные о температуре", { "data/температура.csv": "дата,температура\n2026-09-21,12\n2026-09-22,9" });
        teammatePush(w, PRAKTIKA_URL, "main", TEACHER, "Слил ветку Миши", { "data/миша_дорога.csv": "дата,минуты\n2026-09-21,25\n2026-09-22,31" });
        return w;
      },
      goals: [
        { text: "Забрать изменения: git pull", test: (w) => { const r = H.repo(w, "git-praktika"); return r.branches.main === H.gh(w).branches.main; } },
        { text: "Посмотреть историю, чьи это коммиты: git log", test: (w) => { const r = H.repo(w, "git-praktika"); return r.branches.main === H.gh(w).branches.main && w.history.some((h, i) => /^git log/.test(h.cmd) && h.ok && w.history.slice(0, i).some((x) => /^git pull/.test(x.cmd) && x.ok)); } },
      ],
      hints: ["git status пока пишет «up to date» — он не ходит в интернет. Правду покажет git pull (или git fetch и потом git status).", "Правило: git pull — перед началом работы."],
      solution: ["git status", "git pull", "git log --oneline", "ls data"],
    },
    {
      id: "l14", block: 3, title: "rejected: fetch first",
      story: "Вы с Мишей работаете в общей ветке команды. Вы сделали коммит, но Миша успел отправить свой раньше. Ваш push отклонят. Разберитесь: pull, затем снова push.",
      setup: () => {
        const w = worldGithub(true);
        const l = [];
        w.github[PRAKTIKA_URL].branches["команда-б"] = w.github[PRAKTIKA_URL].branches.main;
        curRepo(w).tracking["origin/команда-б"] = w.github[PRAKTIKA_URL].branches.main;
        gitCheckout(w, ["команда-б"], l, "checkout");
        writeFile(w, "README.md", README + "\n\nКоманда Б: Миша, Оля, Дима и я");
        gitAdd(w, ["."], l); gitCommit(w, ["-m", "Добавил состав команды"], l);
        teammatePush(w, PRAKTIKA_URL, "команда-б", PETYA, "Идея: бот для расписания", { "идея.md": "# Идея\nБот в MAX, который присылает расписание кружков." });
        w.history = [];
        return w;
      },
      goals: [
        { text: "Попробовать git push и получить rejected", test: (w) => w.history.some((h) => !h.ok && /^git push/.test(h.cmd) && /rejected/.test(h.text)) },
        { text: "Забрать чужой коммит: git pull", test: (w) => { const r = H.repo(w, "git-praktika"); return r.branches["команда-б"] && "идея.md" in H.tree(w, r.branches["команда-б"]); } },
        { text: "Отправить: на GitHub есть и ваш коммит, и коммит Миши", test: (w) => { const t = H.tree(w, H.gh(w).branches["команда-б"]); return "идея.md" in t && (t["README.md"] || "").includes("Команда Б"); } },
      ],
      hints: ["rejected (fetch first) = «на GitHub есть то, чего нет у вас». Лечится git pull.", "Если после pull открылся конфликт — смотрите блок 4. Здесь файлы разные, конфликта не будет."],
      solution: ["git push", "git pull", "git push"],
    },
    // Блок 4. Конфликты
    {
      id: "l15", block: 4, title: "Конфликт при слиянии",
      story: "Две ветки поменяли одну и ту же строку заголовка по-разному. Git не знает, какой вариант правильный, и спрашивает вас. Слейте ветку птицы в main, затем ветку шаги — и разрешите конфликт.",
      setup: () => {
        const w = worldProject(true); const r = w.home.dirs["проект"].repo; const base = r.branches.main;
        const bt = H.tree(w, base);
        r.branches["птицы"] = makeCommit(w, "Заголовок графика про птиц", [base], Object.assign({}, bt, { "01_график.py": SCRIPT.replace("Данные из файла {путь}", "Птицы и погода: {путь}") }), PETYA);
        r.branches["шаги"] = makeCommit(w, "Заголовок графика про измерения", [base], Object.assign({}, bt, { "01_график.py": SCRIPT.replace("Данные из файла {путь}", "Мои измерения за неделю: {путь}") }), NASTYA);
        return w;
      },
      goals: [
        { text: "Слить птицы в main (пройдёт без вопросов)", test: (w) => { const r = H.repo(w, "проект"); return isAncestor(w, r.branches["птицы"], r.branches.main); } },
        { text: "Слить шаги и увидеть CONFLICT", test: (w) => w.history.some((h) => /CONFLICT/.test(h.text)) },
        { text: "Исправить файл: оставить один заголовок, убрать метки <<<<<<< ======= >>>>>>>", test: (w) => { const r = H.repo(w, "проект"); return isAncestor(w, r.branches["шаги"], r.branches.main) && H.noMarkers(H.tree(w, r.branches.main)["01_график.py"]); } },
        { text: "Закончить слияние: git add и git commit", test: (w) => { const r = H.repo(w, "проект"); const c = w.objects[r.branches.main]; return c.parents.length === 2 && !r.merging && H.noMarkers(c.tree["01_график.py"]); } },
      ],
      hints: ["edit 01_график.py — найдите блок между <<<<<<< и >>>>>>>. Всё между <<<<<<< и ======= — версия main, между ======= и >>>>>>> — версия ветки.", "Удалите три строки-метки и лишний вариант. Можно написать свой, общий заголовок.", "Передумали? git merge --abort вернёт всё как было."],
      solution: ["git merge птицы", "git merge шаги", "git status",
        (w) => { writeFile(w, "01_график.py", SCRIPT.replace("Данные из файла {путь}", "Птицы и мои измерения: {путь}")); return "cat 01_график.py"; },
        "git add 01_график.py", 'git commit -m "Объединил заголовки"'],
      bad: ["git merge птицы", "git merge шаги", "git add .", 'git commit -m "как есть"'],
    },
    {
      id: "l16", block: 4, title: "Конфликт при pull",
      story: "Вы и Аня поправили одну и ту же строку README в ветке команда-а. Аня отправила раньше. Отправьте свою правку: push отклонят, pull даст конфликт — разрешите его и отправьте итог.",
      setup: () => {
        const w = worldGithub(true); const l = [];
        w.github[PRAKTIKA_URL].branches["команда-а"] = w.github[PRAKTIKA_URL].branches.main;
        curRepo(w).tracking["origin/команда-а"] = w.github[PRAKTIKA_URL].branches.main;
        gitCheckout(w, ["команда-а"], l, "checkout");
        writeFile(w, "README.md", README.replace("# Учебный проект", "# Проект: распознаём птиц у кормушки"));
        gitAdd(w, ["."], l); gitCommit(w, ["-m", "Название проекта"], l);
        teammatePush(w, PRAKTIKA_URL, "команда-а", NASTYA, "Название проекта", { "README.md": README.replace("# Учебный проект", "# Проект: нейросеть считает птиц") });
        w.history = [];
        return w;
      },
      goals: [
        { text: "git push → rejected, git pull → CONFLICT", test: (w) => w.history.some((h) => /^git pull/.test(h.cmd) && /CONFLICT/.test(h.text)) },
        { text: "Разрешить конфликт в README.md и закоммитить", test: (w) => { const r = H.repo(w, "git-praktika"); const c = w.objects[r.branches["команда-а"]]; return c.parents.length === 2 && H.noMarkers(c.tree["README.md"]); } },
        { text: "Отправить итог на GitHub", test: (w) => { const id = H.gh(w).branches["команда-а"]; const c = w.objects[id]; return c.parents.length === 2 && H.noMarkers(c.tree["README.md"]); } },
      ],
      hints: ["Порядок: git push → git pull → edit README.md → git add README.md → git commit -m \"...\" → git push", "Договоритесь с Аней, какое название оставить, — git за вас не решит."],
      solution: ["git push", "git pull",
        (w) => { writeFile(w, "README.md", README.replace("# Учебный проект", "# Проект: нейросеть считает птиц у кормушки")); return "git add README.md"; },
        'git commit -m "Объединил названия"', "git push"],
    },
    // Блок 5. Сценарии
    {
      id: "l17", block: 5, title: "Что не кладём в git",
      story: "Скрипт рисует картинку график_*.png. Её не нужно хранить в git: она создаётся заново при каждом запуске. Запустите скрипт, посмотрите git status, допишите *.png в .gitignore и закоммитьте .gitignore.",
      setup: () => {
        const w = worldProject(true); const d = w.home.dirs["проект"];
        const t = Object.assign({}, H.tree(w, d.repo.branches.main), { ".gitignore": "venv/\n__pycache__/" });
        d.repo.branches.main = makeCommit(w, "Добавил .gitignore", [d.repo.branches.main], t);
        d.repo.index = clone(t); d.files[".gitignore"] = "venv/\n__pycache__/";
        return w;
      },
      goals: [
        { text: "Запустить скрипт: python 01_график.py", test: (w) => H.ranOk(w, /^py(thon3?)? 01_график\.py/) },
        { text: "Дописать *.png в .gitignore и закоммитить .gitignore", test: (w) => /^\*\.png$/m.test(H.tree(w, H.tip(w, "проект", "main"))[".gitignore"] || "") },
        { text: "Картинка не попала ни в один коммит, папка чистая", test: (w) => { const tip = H.tip(w, "проект", "main"); const any = [...ancestors(w, tip)].some((c) => Object.keys(w.objects[c].tree).some((p) => p.endsWith(".png"))); return H.ranOk(w, /^py/) && !any && H.clean(w, "проект"); } },
      ],
      hints: ["echo \"*.png\" >> .gitignore — допишет строку в конец файла", "После этого git status перестанет показывать картинку."],
      solution: ["python 01_график.py", "git status", 'echo "*.png" >> .gitignore', "git status", "git add .gitignore", 'git commit -m "Картинки не храним"', "git status"],
      bad: ["python 01_график.py", "git add .", 'git commit -m "всё"'],
    },
    {
      id: "l18", block: 5, title: "Занятие целиком",
      story: "Повторим всё, что будет на занятии в настоящем терминале. Скачайте репозиторий, сделайте свою ветку, добавьте файл data/имя_что-измерял.csv с заголовком и 7 строками измерений, закоммитьте и отправьте на GitHub. Картинку не коммитим.",
      setup: () => worldGithub(false),
      goals: [
        { text: "Склонировать и перейти в папку", test: (w) => !!H.repo(w, "git-praktika") && (w.cwd === "git-praktika" || H.ranOk(w, /^cd (~\/)?git-praktika/)) },
        { text: "Своя ветка", test: (w) => H.otherBranch(w, "git-praktika").length > 0 },
        { text: "На GitHub в вашей ветке есть новый CSV в data/ с заголовком и 7+ строками", test: (w) => { const gh = H.gh(w); return Object.keys(gh.branches).some((b) => b !== "main" && Object.entries(H.tree(w, gh.branches[b])).some(([p, t]) => p.startsWith("data/") && p.endsWith(".csv") && !(p in H.tree(w, gh.branches.main)) && t.split("\n").filter((s) => s.trim()).length >= 8)); } },
        { text: "Скрипт запущен, а картинка не закоммичена", test: (w) => { const gh = H.gh(w); const bs = Object.keys(gh.branches).filter((b) => b !== "main"); return H.ranOk(w, /^py/) && bs.length > 0 && bs.every((b) => !Object.keys(H.tree(w, gh.branches[b])).some((p) => p.endsWith(".png"))); } },
      ],
      hints: ["edit data/ваня_шаги.csv — откроет новый файл. Первая строка: дата,шаги. Дальше 7 строк вида 2026-09-21,6400", "python 01_график.py data/ваня_шаги.csv — проверить, что файл читается", "git push -u origin имя-ветки"],
      solution: ["git clone " + PRAKTIKA_URL + ".git", "cd git-praktika", "git checkout -b test-testov",
        (w) => { writeFile(w, "data/тест_шаги.csv", "дата,шаги\n2026-09-21,1\n2026-09-22,2\n2026-09-23,3\n2026-09-24,4\n2026-09-25,5\n2026-09-26,6\n2026-09-27,7"); return "python 01_график.py data/тест_шаги.csv"; },
        "git status", "git add .", 'git commit -m "Добавил свои шаги"', "git push -u origin test-testov"],
    },
  ];

  const BLOCKS = {
    1: "Основы: add и commit",
    2: "Ветки",
    3: "GitHub: clone, push, pull",
    4: "Конфликты",
    5: "Сценарии",
  };

  function trapped(level, w) {
    try { return !!(level.trap && level.trap.test(w)); } catch (e) { return false; }
  }

  function levelDone(level, w) {
    return level.goals.every((g) => { try { return !!g.test(w); } catch (e) { return false; } });
  }
  function goalStates(level, w) {
    return level.goals.map((g) => { try { return !!g.test(w); } catch (e) { return false; } });
  }

  // Код прохождения: руководитель может проверить его на вкладке «Руководителю».
  function progressCode(name, count) {
    const s = "git-trenazher|" + (name || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ") + "|" + count;
    return hash(s).slice(0, 6).toUpperCase();
  }

  const api = {
    ORG, PRAKTIKA_URL, LEVELS, BLOCKS, run, writeFile, levelDone, goalStates, trapped, progressCode,
    curRepo, worktree, fileStatus, treeOf, headId, ancestors, isIgnored, clone, newWorld, tokenize, mergeText,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GitSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
