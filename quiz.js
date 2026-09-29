// Опрос «Как устроен Git» для урока онлайн: вопросы и их отрисовка.
// Используется и учеником (вкладка «Урок»), и руководителем (teacher.html).
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const ZONES = ["Рабочая папка", "Индекс", "Коммиты", "GitHub"];
  const ZONE_HINT = ["файлы в VS Code", "корзина для коммита", "история на компьютере", "общая копия в интернете"];
  const me = (t) => ({ t: t, who: "qz-me" });
  const them = (t) => ({ t: t, who: "qz-them" });

  const F1 = '"""Считаем, сколько птиц прилетает к кормушке."""\nimport pandas as pd\n\nданные = pd.read_csv("визиты.csv")\nprint("Всего визитов:", данные["визиты"].sum())\nprint("В среднем за день:", данные["визиты"].mean())';
  const F2 = F1.replace('print("В среднем за день:", данные["визиты"].mean())', 'print("В среднем за день:", round(данные["визиты"].mean(), 1))\nprint("Больше всего:", данные["визиты"].max())');
  const F3 = F2.replace('данные = pd.read_csv("визиты.csv")', 'данные = pd.read_csv("визиты_ноябрь.csv")  # новый файл!');
  const F4 = F3.replace('print("Больше всего:", данные["визиты"].max())', 'print("Больше всего:", данные["визиты"].max())\n# print("Холодные дни:", данные[данные["температура"] < 0])  # не работает??');

  const QUIZ = [
    {
      text: "Это папка проекта одноклассника. Какой файл — последняя рабочая версия?",
      files: [["проект_финал.py", F1], ["проект_финал_2.py", F2], ["проект_финал_настоящий.py", F3], ["проект_финал_ИСПРАВЛЕН_Вася.py", F4]],
      options: ["проект_финал.py", "проект_финал_2.py", "проект_финал_настоящий.py", "проект_финал_ИСПРАВЛЕН_Вася.py"],
      correct: null,
      explain: "Точно не знает никто: нет дат, авторов и объяснений, что поменялось. «Настоящий» читает другой файл данных, у Васи строка закомментирована с пометкой «не работает??». Git решает это: файл один, а все версии — в истории, у каждой автор, дата и подпись.",
    },
    {
      text: "Вы поменяли шаги.csv в VS Code и сохранили. Где сейчас новая версия?",
      state: [[me("версия 2 ✎")], [], [me("версия 1")], [me("версия 1")]],
      zones: true, correct: 0,
      explain: "Только в рабочей папке. Git видит изменение — git status покажет modified, — но ничего не сохранил.",
    },
    {
      text: "Выполнили git add . — куда попала версия 2?",
      state: [[me("версия 2")], [], [me("версия 1")], [me("версия 1")]],
      zones: true, correct: 1,
      explain: "В индекс — «корзину» для следующего коммита. Это ещё не сохранение в истории.",
    },
    {
      text: "Выполнили git commit -m \"Добавил среду\". Где теперь версия 2 сохранена в истории?",
      state: [[me("версия 2")], [me("версия 2")], [me("версия 1")], [me("версия 1")]],
      zones: true, correct: 2,
      explain: "В коммитах на вашем компьютере, в скрытой папке .git. Индекс снова пуст — его содержимое стало коммитом.",
    },
    {
      text: "Аня открывает репозиторий на GitHub. Видит ли она вашу версию 2?",
      state: [[me("версия 2")], [], [me("версия 2"), me("версия 1")], [me("версия 1")]],
      options: ["Да, коммит сразу виден всем", "Нет, коммит пока только на моём компьютере", "Видит, но только в ветке main"],
      correct: 1,
      explain: "Коммит живёт у вас, пока вы его не отправили. GitHub о нём ничего не знает.",
    },
    {
      text: "Что сделать, чтобы Аня увидела вашу версию?",
      options: ["git add .", "git commit -m \"...\"", "git push", "git pull"],
      correct: 2,
      explain: "git push отправляет ваши коммиты на GitHub. git pull — наоборот, забирает чужие.",
    },
    {
      text: "Вы поменяли файл и сразу написали git commit -m \"Поправил\", без git add. Что будет?",
      state: [[me("версия 3 ✎")], [], [me("версия 2"), me("версия 1")], [me("версия 2")]],
      options: ["Сохранится версия 3", "Git скажет, что сохранять нечего", "Файл отправится на GitHub", "Git удалит изменения"],
      correct: 1,
      explain: "no changes added to commit: индекс пуст, в коммит нечего класть. Изменения не пропали — они в рабочей папке, нужен git add.",
    },
    {
      text: "Пока вы работали, Аня отправила на GitHub свой коммит. Вы делаете git push. Что будет?",
      state: [[me("версия 3")], [], [me("версия 3"), me("версия 2")], [them("данные Ани"), me("версия 2")]],
      options: ["Всё отправится, коммит Ани пропадёт", "Git откажет: rejected (fetch first)", "GitHub сам соединит версии"],
      correct: 1,
      explain: "На GitHub есть коммит, которого у вас нет. Git не даёт затереть чужую работу и отказывает.",
    },
    {
      text: "Push отклонён. Как правильно поступить?",
      options: ["git push --force", "git pull, затем git push", "Удалить папку и скачать заново", "Попросить Аню удалить свой коммит"],
      correct: 1,
      explain: "git pull заберёт коммит Ани и соединит его с вашим, после этого push пройдёт. --force стёр бы работу Ани.",
    },
    {
      text: "Какая команда в любой момент покажет, что изменилось, и ничего не сломает?",
      options: ["git push", "git status", "git reset --hard", "git commit"],
      correct: 1,
      explain: "git status только смотрит. Вводите его сколько угодно — перед add, после commit, когда не понимаете, что происходит.",
    },
    {
      text: "Вы в своей ветке ivan-petrov сделали 3 коммита. Что с веткой main?",
      options: ["В main тоже появились 3 коммита", "main не изменился, пока ветку не сольют", "main удалился"],
      correct: 1,
      explain: "Ветка — отдельная линия истории. В main работа попадёт только после слияния: git merge или кнопка Merge в pull request.",
    },
    {
      text: "Правильный порядок работы на каждый день:",
      options: ["pull → правки → add → commit → push", "правки → commit → add → push", "push → правки → pull → commit", "add → commit → правки → push"],
      correct: 0,
      explain: "Сначала забрать чужое, потом работать, потом сохранить и отправить своё.",
    },
    {
      text: "Интернет пропал. Где лежит история коммитов вашего проекта?",
      options: ["В скрытой папке .git внутри проекта", "Только на GitHub", "В настройках VS Code", "Нигде — без интернета git не работает"],
      correct: 0,
      explain: "Вся история — у вас в папке .git. Коммитить можно без интернета, он нужен только для push и pull.",
    },
  ];

  function optionsOf(q) {
    return q.zones ? ZONES : q.options;
  }

  // o: { selected, revealed, counts: [n...], showCounts, clickable, index, total }
  function render(q, o) {
    o = o || {};
    const opts = optionsOf(q);
    let h = '<div class="qz">';
    if (o.index != null) h += '<div class="qz-n">Вопрос ' + (o.index + 1) + " из " + (o.total || QUIZ.length) + (q.correct === null ? " · голосование" : "") + "</div>";
    h += '<div class="qz-text">' + esc(q.text) + "</div>";
    if (q.files) {
      h += '<div class="qz-files">' + q.files.map((f) => '<details class="qz-file"><summary>' + esc(f[0]) + "</summary><pre>" + esc(f[1]) + "</pre></details>").join("") + "</div>";
    }
    if (q.state) {
      h += '<div class="qz-zones">' + q.state.map((items, i) =>
        '<div class="qz-zone"><b>' + ZONES[i] + "</b><small>" + ZONE_HINT[i] + "</small>" +
        (items.length ? items.map((p) => '<span class="qz-pill ' + p.who + '">' + esc(p.t) + "</span>").join("") : '<span class="qz-empty">пусто</span>') +
        "</div>").join("") + "</div>";
    }
    const counts = o.counts || [];
    const sum = counts.reduce((a, b) => a + (b || 0), 0) || 1;
    h += '<div class="qz-opts' + (q.zones ? " zones" : "") + '">';
    opts.forEach((t, i) => {
      let cls = "qz-opt";
      if (o.selected === i) cls += " sel";
      if (o.revealed && q.correct !== null) cls += i === q.correct ? " ok" : o.selected === i ? " no" : "";
      h += '<button class="' + cls + '" data-a="' + i + '"' + (o.clickable ? "" : " disabled") + ">";
      if (o.showCounts) h += '<span class="qz-bar" style="width:' + Math.round(((counts[i] || 0) / sum) * 100) + '%"></span>';
      h += '<span class="qz-l">' + "АБВГДЕ"[i] + "</span><span class=\"qz-t\">" + esc(t) + "</span>";
      if (o.showCounts) h += '<span class="qz-c">' + (counts[i] || 0) + "</span>";
      h += "</button>";
    });
    h += "</div>";
    if (o.revealed) h += '<div class="qz-explain">' + (q.correct === null ? "" : "<b>Ответ: " + esc(opts[q.correct]) + ".</b> ") + esc(q.explain) + "</div>";
    return h + "</div>";
  }

  root.GitQuiz = { QUIZ: QUIZ, ZONES: ZONES, render: render, optionsOf: optionsOf };
})(typeof globalThis !== "undefined" ? globalThis : this);
