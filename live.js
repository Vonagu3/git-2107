// Связь тренажёра с руководителем: личный ключ ученика, отправка событий, состояние опроса.
// Supabase-проект Otbor_2107. Таблицы и права — Урок_2_git/supabase_git_live.sql.
// Ключ anon публичный: с ним можно только отправить событие с выданным ключом и прочитать номер вопроса.
(function (root) {
  "use strict";
  const URL0 = "https://hpmidxaovjlcjlitqjvl.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwbWlkeGFvdmpsY2psaXRxanZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTI3OTYsImV4cCI6MjEwNDg4ODc5Nn0.UKlF5r7JHroaNgS8wXbRkjNPjGJ2hKufxyR-tlKAWmI";
  const KEY_STORE = "gt-key";

  const clean = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function setKey(k) {
    try { k ? localStorage.setItem(KEY_STORE, clean(k)) : localStorage.removeItem(KEY_STORE); } catch (e) {}
  }
  const headers = { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" };

  async function rpc(name, body) {
    const r = await fetch(URL0 + "/rest/v1/rpc/" + name, { method: "POST", headers: headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  async function keyOk(k) {
    return !!(await rpc("git_key_ok", { p_key: clean(k) }));
  }
  // Отправить событие; без ключа или без сети тихо возвращает false.
  async function submit(kind, payload) {
    const k = getKey();
    if (!k) return false;
    try { return !!(await rpc("git_submit", { p_key: k, p_kind: kind, p_payload: payload })); } catch (e) { return false; }
  }
  async function quiz() {
    const r = await fetch(URL0 + "/rest/v1/git_quiz?select=session,q,revealed&id=eq.1", { headers: headers, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return (await r.json())[0] || null;
  }

  root.GitLive = { URL: URL0, ANON: ANON, clean: clean, getKey: getKey, setKey: setKey, keyOk: keyOk, submit: submit, quiz: quiz };
})(typeof globalThis !== "undefined" ? globalThis : this);
