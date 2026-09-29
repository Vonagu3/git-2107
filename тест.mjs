// Прогон уровней: эталонное решение должно засчитываться, пустое и «плохое» — нет.
// Запуск: node тест.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const S = require("./engine.js");

let fail = 0;
function play(level, steps, verbose) {
  const w = level.setup();
  for (const st of steps) {
    const cmd = typeof st === "function" ? st(w) : st;
    const r = S.run(w, cmd);
    if (verbose) console.log("  $ " + cmd + "\n" + r.lines.map((l) => "    " + l.text).join("\n"));
  }
  return w;
}
for (const lv of S.LEVELS) {
  const fresh = lv.setup();
  const startDone = S.levelDone(lv, fresh);
  const w = play(lv, lv.solution);
  const ok = S.levelDone(lv, w);
  let badOk = false;
  if (lv.bad) badOk = S.levelDone(lv, play(lv, lv.bad));
  const good = ok && !startDone && !badOk;
  if (!good) fail++;
  console.log((good ? "OK  " : "FAIL") + " " + lv.id + " " + lv.title +
    (startDone ? " [засчитан сразу]" : "") + (badOk ? " [засчитан плохой путь]" : "") +
    (ok ? "" : " цели: " + S.goalStates(lv, w).map((x) => (x ? "✔" : "✘")).join("")));
  if (!ok || process.argv.includes("-v")) play(lv, lv.solution, true);
}
// merge по строкам
const m = S.mergeText("a\nb\nc", "A\nb\nc", "a\nb\nC", "HEAD", "x");
if (m.conflict || m.text !== "A\nb\nC") { fail++; console.log("FAIL mergeText разные строки", m); }
console.log(fail ? "\nОшибок: " + fail : "\nВсе уровни проходят.");
process.exit(fail ? 1 : 0);
