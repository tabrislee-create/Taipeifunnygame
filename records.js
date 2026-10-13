// Play records (user 2026-10-13): trial build only, levels 1-5.  Kept ONLY in the player's own browser (localStorage) - nothing is sent anywhere, so no consent prompt.
// One entry per run (character select 確定 -> victory / 回主選單 after dying / leaving the page), the latest 100 are kept.
// Loaded by the landing page before the game (its 遊玩記錄 button); the game calls REC.start / levelStart / died / finish.  Every storage access is wrapped: without storage the game plays normally, just unrecorded.
var REC = (function () {
  var KEY = 'tpfun_demo_records_v1', KEEP = 100;
  var on = !!window.DEMO_BUILD || /[?&]demo=1/.test(location.search);
  var cur = null;   // id of the run being played in this page (records left 'playing' by an earlier page were abandoned)
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && Array.isArray(d.runs)) return d; } catch (e) {}
    return { total: 0, runs: [] };
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  function find(d) { for (var i = 0; i < d.runs.length; i++) if (d.runs[i].id === cur) return d.runs[i]; return null; }
  function eqNames() {
    var out = [];
    try { ['weapon', 'armor', 'boots'].concat([0, 1]).forEach(function (k) { var id = typeof k === 'number' ? RUN.inv.charms[k] : RUN.inv[k], it = id && GAME_DATA.equipment[id]; if (it) out.push(it.name_zh); }); } catch (e) {}
    return out;
  }
  // copy the live run's numbers into its record (and change it with fn), then store
  function upd(fn) {
    if (!on || !cur) return;
    var d = load(), r = find(d); if (!r) return;
    r.sec = Math.round((Date.now() - r.id) / 1000);
    if (typeof RUN !== 'undefined') { r.kills = RUN.kills || 0; r.coins = RUN.coins || 0; r.eq = eqNames(); }
    if (fn) fn(r);
    save(d);
  }
  function start(charId, charName, hard) {
    if (!on) return;
    var d = load();
    d.runs.forEach(function (r) { if (r.res === 'playing') r.res = 'quit'; });
    cur = Date.now();
    d.total = (d.total || 0) + 1;
    d.runs.push({ id: cur, n: d.total, ch: charId, chName: charName, hard: !!hard, res: 'playing', lv: 1, sec: 0, deaths: 0, deathsAt: {}, kills: 0, coins: 0, eq: [], deadNow: false });
    if (d.runs.length > KEEP) d.runs = d.runs.slice(-KEEP);
    save(d);
  }
  function levelStart(lv) { upd(function (r) { if (lv > r.lv) r.lv = lv; r.deadNow = false; }); }
  function died(lv) { upd(function (r) { r.deaths++; r.deathsAt[lv] = (r.deathsAt[lv] || 0) + 1; r.deadNow = true; }); }
  function finish(res) { upd(function (r) { r.res = res; }); cur = null; }   // res: 'clear' | 'dead'
  window.addEventListener('pagehide', function () { upd(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) upd(); });

  // result text of one record (a run left 'playing' / 'quit' right after dying counts as dying there)
  function resultText(r) {
    if (r.res === 'clear') return '通關';
    if (r.res === 'playing' && r.id === cur) return '進行中';
    if (r.res === 'dead' || r.deadNow) return '倒在第 ' + r.lv + ' 關';
    return '第 ' + r.lv + ' 關離開';
  }
  function summary() {
    var d = load(), s = { total: d.total || 0, kept: d.runs.length, clears: 0, hardClears: 0, best: 0, fastest: 0, sec: 0, byChar: {}, deathsAt: {}, runs: d.runs.slice().reverse() };
    d.runs.forEach(function (r) {
      var c = s.byChar[r.ch] || (s.byChar[r.ch] = { name: r.chName, runs: 0, clears: 0 });
      c.runs++; s.sec += r.sec || 0; if (r.lv > s.best) s.best = r.lv;
      if (r.res === 'clear') { s.clears++; c.clears++; if (r.hard) s.hardClears++; if (!s.fastest || r.sec < s.fastest) s.fastest = r.sec; }
      for (var k in r.deathsAt) s.deathsAt[k] = (s.deathsAt[k] || 0) + r.deathsAt[k];
    });
    var worst = 0; for (var k in s.deathsAt) if (!worst || s.deathsAt[k] > s.deathsAt[worst]) worst = k;
    s.worst = worst ? { lv: +worst, n: s.deathsAt[worst] } : null;
    return s;
  }
  // the line on the result screen: this run's number and the best level reached so far (this run included)
  function endLine() {
    if (!on) return '';
    var d = load(), r = cur && find(d), best = 0;
    d.runs.forEach(function (x) { if (x.lv > best) best = x.lv; });
    if (!r) return '';
    return '第 ' + r.n + ' 次挑戰｜最遠紀錄：第 ' + best + ' 關';
  }
  function clear() { cur = null; try { localStorage.removeItem(KEY); } catch (e) {} }
  return { on: on, start: start, levelStart: levelStart, died: died, finish: finish, summary: summary, resultText: resultText, endLine: endLine, clear: clear };
})();
