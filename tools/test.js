/* ロジックの単体テスト。
 *
 *   node tools/test.js
 *
 * 実装は index.html 内の IIFE に閉じているため外から呼べない。
 * ここでは本体のソースから必要な部分を切り出して Node 上で評価し、
 * production のコードを一切変えずに振る舞いを検証する。
 * 本体を書き換えると切り出しに失敗して落ちるので、気づかずにずれることはない。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* ---- 本体から検証対象を切り出す ---- */
function slice(from, to, label) {
  const a = script.indexOf(from), b = script.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error('切り出し失敗: ' + label);
  return script.slice(a, b);
}
function fn(name) {
  const re = new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}', 'm');
  const m = script.match(re);
  if (!m) throw new Error('関数が見つからない: ' + name);
  return m[0];
}

// 文言・定数・DEF_STATE・load・各ユーティリティまで
const core = slice('const T={', "let cur='home';", 'core');
// VOICE_KINDS は音声の節（上記より後ろ）で定義されているが load() が参照するので併せて取る
const voiceKinds = script.match(/const VOICE_KINDS=\[[^\]]*\];/);
if (!voiceKinds) throw new Error('VOICE_KINDS が見つからない');
const body = voiceKinds[0] + '\n' + core + '\n' + fn('nextPhase') + '\n';

const store = {};
const localStorageStub = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
// S は let 宣言のみで、load() を呼ぶまで undefined。fmt などが S.lang を見るため先に初期化する
const make = run => new Function('localStorage', 'run', body +
  '\nload();' +
  '\nreturn {phasesOf,BARS,roundSec,roundsFor,clamp,fmt,presetById,label,' +
  'PRESETS,CHIPS,MIN_R,MAX_R,PREPS,PREP_IN,PREP_EX,PREP_GAP,DEF_STATE,load,nextPhase,' +
  'getS:()=>S};')(localStorageStub, run);

let failed = 0, passed = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; } else { failed++; }
  console.log((ok ? '  OK  ' : '  NG  ') + name + (ok ? '' : '\n        期待 ' + JSON.stringify(want) + '\n        実際 ' + JSON.stringify(got)));
}
function ok(name, cond, note) {
  if (cond) { passed++; } else { failed++; }
  console.log((cond ? '  OK  ' : '  NG  ') + name + (note ? '  — ' + note : ''));
}

const A = make({});

/* ========== 1ラウンドの構造 ========== */
console.log('\n[1ラウンドの構造]');
const p488 = A.PRESETS[0];
const ph = A.phasesOf(p488);
eq('6フェーズある', ph.length, 6);
eq('種類の並びが 吸→止→吐→吸→止→吐', ph.map(x => x.k),
   ['inhale', 'hold', 'exhale', 'inhale', 'hold', 'exhale']);
eq('秒数の並び (4-8-8)', ph.map(x => x.dur), [4, 8, 8, 4, 8, 8]);
eq('止めるの向きが左右で反転', ph.filter(x => x.k === 'hold').map(x => x.dir), ['ltr', 'rtl']);
eq('バーの割り当て', ph.map(x => x.bar), ['left', 'top', 'right', 'right', 'top', 'left']);
ok('BARS がフェーズ数と一致', A.BARS.length === ph.length, A.BARS.length + '件');
eq('1ラウンドの長さ = (吸+止+吐)×2', A.roundSec(p488), 40);

/* 仕様書の所要時間と一致するか */
console.log('\n[所要時間が仕様どおり]');
[['4-8-8', 8, '5分20秒'], ['6-12-12', 8, '8分'], ['4-16-8', 8, '7分28秒']].forEach(([id, r, want]) => {
  const p = A.PRESETS.find(x => x.id === id);
  eq(id + ' × ' + r + 'ラウンド', A.fmt(A.roundSec(p) * r), want);
  eq(id + ' の既定ラウンド数', p.def, r);
});

/* ========== フェーズ送り ========== */
console.log('\n[フェーズ送り]');
function walk(durs, rounds, limit = 200) {
  const run = { ph: durs.map(d => ({ dur: d })), idx: 0, round: 0, rounds };
  const M = make(run);
  const seen = [];
  if (run.ph[run.idx].dur > 0) seen.push([run.round, run.idx]);
  let n = 0;
  while (M.nextPhase() && n++ < limit) seen.push([run.round, run.idx]);
  return seen;
}
const normal = walk([4, 8, 8, 4, 8, 8], 2);
eq('2ラウンドで12フェーズ', normal.length, 12);
eq('ラウンド境界で idx が 0 に戻る', normal[6], [1, 0]);
eq('最後は 1ラウンド目の最終フェーズ', normal[normal.length - 1], [1, 5]);

const zero = walk([4, 0, 8, 4, 0, 8], 2);
eq('止める=0秒は飛ばされ 2ラウンドで8フェーズ', zero.length, 8);
ok('0秒フェーズに滞在しない', zero.every(([, i]) => i !== 1 && i !== 4), zero.map(x => x[1]).join(','));

eq('1ラウンド指定なら6フェーズ', walk([4, 8, 8, 4, 8, 8], 1).length, 6);

/* 全フェーズ0秒でも無限ループしない（異常時の保険） */
const guard = walk([0, 0, 0, 0, 0, 0], 3);
ok('全フェーズ0秒でも停止する', guard.length < 200, guard.length + '回で終了');

/* ========== 残り秒の表示 ========== */
console.log('\n[残り秒の表示]');
const shown = (dur, e) => Math.max(1, Math.ceil(dur - e));
eq('開始直後は dur を表示', shown(4, 0), 4);
eq('1.0秒経過で 3', shown(4, 1.0), 3);
eq('3.5秒経過で 1', shown(4, 3.5), 1);
eq('終了間際でも 0 を出さない', shown(4, 3.999), 1);

/* ========== 時間の表記 ========== */
console.log('\n[時間の表記]');
A.getS().lang = 'ja';
eq('40秒', A.fmt(40), '40秒');
eq('ちょうど3分は秒を出さない', A.fmt(180), '3分');
eq('2分48秒', A.fmt(168), '2分48秒');
A.getS().lang = 'en';
eq('英語 40 sec', A.fmt(40), '40 sec');
eq('英語 3 min', A.fmt(180), '3 min');
eq('英語 2 min 48 sec', A.fmt(168), '2 min 48 sec');
A.getS().lang = 'ja';

/* ========== 保存データの検証 ========== */
console.log('\n[保存データの検証]');
const KNOWN = Object.keys(A.DEF_STATE);
function loadWith(raw) {
  for (const k of Object.keys(store)) delete store[k];
  if (raw !== undefined) store['nadi'] = raw;
  const M = make({});
  M.load();
  return M.getS();
}
const cases = [
  ['正常', JSON.stringify({ lang: 'en', theme: 'light', fs: 'l', voiceKind: 'male' }),
    s => s.lang === 'en' && s.theme === 'light' && s.voiceKind === 'male'],
  ['プロトタイプ汚染', '{"__proto__":{"x":1}}', () => ({}).x === undefined],
  ['未知のキー', JSON.stringify({ evil: 1, lang: 'ja' }),
    s => Object.keys(s).every(k => KNOWN.includes(k))],
  ['不正な型', JSON.stringify({ lang: 1, theme: [], rounds: 'x', history: 'x' }),
    s => s.lang === 'ja' && s.theme === 'dark' && typeof s.rounds === 'object' && Array.isArray(s.history)],
  ['範囲外', JSON.stringify({ rounds: { '4-8-8': 9999 }, custom: { inhale: -5, hold: 1e9, exhale: 0 } }),
    s => s.rounds['4-8-8'] === A.MAX_R && s.custom.inhale >= 1 && s.custom.hold <= 40 && s.custom.exhale >= 1],
  ['不正な声の種類', JSON.stringify({ voiceKind: '../../etc/passwd' }), s => s.voiceKind === 'warm'],
  ['不正な日付', JSON.stringify({ streak: { count: 3, last: 'bad' } }), s => s.streak.last === null],
  ['巨大な履歴', JSON.stringify({ history: Array.from({ length: 999 }, () => ({ preset: 'x', rounds: 1, sec: 1, date: '2026-01-01', time: '00:00' })) }),
    s => s.history.length <= 200],
  ['壊れたJSON', '{not json', s => s.lang === 'ja'],
  ['配列', '[1,2,3]', s => s.lang === 'ja'],
  ['保存なし', undefined, s => s.lang === 'ja' && s.onboarded === false],
];
for (const [name, raw, check] of cases) {
  let r;
  try { r = check(loadWith(raw)); } catch (e) { r = false; }
  ok(name, r);
}

/* ========== 範囲の整合 ========== */
console.log('\n[範囲の整合]');
ok('ラウンド数チップがすべて有効範囲内',
  A.CHIPS.every(c => c >= A.MIN_R && c <= A.MAX_R), A.CHIPS.join(','));
ok('既定ラウンド数がすべて有効範囲内',
  A.PRESETS.every(p => p.def >= A.MIN_R && p.def <= A.MAX_R));
eq('clamp が下限で止まる', A.clamp(-99, A.MIN_R, A.MAX_R), A.MIN_R);
eq('clamp が上限で止まる', A.clamp(999, A.MIN_R, A.MAX_R), A.MAX_R);
eq('clamp が数値でない入力を既定に落とす', A.clamp('abc', A.MIN_R, A.MAX_R), A.MIN_R);
ok('準備時間の選択肢に「なし」がある', A.PREPS.includes(0), A.PREPS.join('/'));
eq('導入呼吸は 吸う:吐く = 1:2', A.PREP_EX / A.PREP_IN, 2);

console.log('');
console.log('  ' + passed + ' 件成功' + (failed ? ' / ' + failed + ' 件失敗' : ''));
if (failed) process.exit(1);
