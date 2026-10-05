/* 整合性の点検。
 *
 *   node tools/check.js
 *
 * 文言・画面遷移・保存データ・音声ファイルなど、別々の場所に書かれていて
 * ずれやすいものを突き合わせる。1件でも食い違えば終了コード1で落ちる。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let failed = 0;
function check(name, ok, note) {
  console.log((ok ? '  OK  ' : '  NG  ') + name + (note ? '  — ' + note : ''));
  if (!ok) failed++;
}

/* ---- 構文 ---- */
try { new Function(script); check('index.html の JS 構文', true); }
catch (e) { check('index.html の JS 構文', false, e.message); }
try { new Function(sw); check('sw.js の構文', true); }
catch (e) { check('sw.js の構文', false, e.message); }

/* ---- 画面遷移 ---- */
const screens = [...html.matchAll(/section class="screen[^"]*" id="([a-z]+)"/g)].map(m => m[1]);
const reach = new Set([...html.matchAll(/data-go="([a-z]+)"/g)].map(m => m[1]));
// go(...) の引数に現れる文字列（三項演算子なども拾う）
for (const m of script.matchAll(/go\(([^)]*)\)/g)) {
  for (const s of m[1].matchAll(/'([a-z]+)'/g)) reach.add(s[1]);
}
check('遷移先がすべて実在する画面',
  [...reach].every(r => screens.includes(r)),
  [...reach].filter(r => !screens.includes(r)).join(',') || undefined);
check('到達できない画面が無い',
  screens.every(s => reach.has(s)),
  screens.filter(s => !reach.has(s)).join(',') || screens.length + '画面');

/* ---- 文言 ---- */
const used = new Set([
  ...[...html.matchAll(/data-i="([^"]+)"/g)].map(m => m[1]),
  ...[...script.matchAll(/\bt\('([^']+)'\)/g)].map(m => m[1]),
  // 動的に組み立てるキー
  'vk.warm', 'vk.space', 'vk.male', 'vk.warmD', 'vk.spaceD', 'vk.maleD',
].filter(k => k.includes('.')));
const jaBlock = script.match(/ja:\{([\s\S]*?)\n\},\nen:/)[1];
const enBlock = script.match(/en:\{([\s\S]*?)\n\}\}/)[1];
const keysOf = b => new Set([...b.matchAll(/'([a-zA-Z]+\.[A-Za-z0-9]+)':/g)].map(m => m[1]));
const ja = keysOf(jaBlock), en = keysOf(enBlock);
check('使用中の文言キーが ja に揃っている',
  [...used].every(k => ja.has(k)), [...used].filter(k => !ja.has(k)).join(',') || undefined);
check('使用中の文言キーが en に揃っている',
  [...used].every(k => en.has(k)), [...used].filter(k => !en.has(k)).join(',') || undefined);
check('ja と en のキーが一致', ja.size === en.size && [...ja].every(k => en.has(k)),
  ja.size + ' / ' + en.size);

/* ---- 保存データ ---- */
const stateKeys = [...script.matchAll(/^  ([a-zA-Z]+):/gm)].map(m => m[1]);
const defBlock = script.match(/const DEF_STATE=\{([\s\S]*?)\n\};/)[1];
const defKeys = [...defBlock.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map(m => m[1]);
const loadBlock = script.match(/function load\(\)\{([\s\S]*?)\n\}/)[1];
const unchecked = defKeys.filter(k => !new RegExp('S\\.' + k + '\\s*=|S\\.' + k + '\\[').test(loadBlock));
check('保存データの全キーを load() で検証',
  unchecked.length === 0, unchecked.join(',') || defKeys.length + 'キー');

/* ---- 音声ファイル ---- */
const kinds = JSON.parse(script.match(/const VOICE_KINDS=(\[[^\]]*\])/)[1].replace(/'/g, '"'));
// VOICE_FILE の定義ブロックを取り出してから値だけ集める。
// キーに '.' が含まれる（vo.inL など）ので、キー側を緩く受ける必要がある。
const voiceFileBlock = script.match(/const VOICE_FILE=\{([\s\S]*?)\n\};/)[1];
const names = [...voiceFileBlock.matchAll(/:\s*'([a-z-]+)'/g)].map(m => m[1]);
const phrases = JSON.parse(fs.readFileSync(path.join(__dirname, 'voice-phrases.json'), 'utf8'));
const langs = Object.keys(phrases);
check('文言定義とコードの対応表が一致',
  names.length === Object.keys(phrases.ja).length &&
  names.every(n => n in phrases.ja), names.length + ' / ' + Object.keys(phrases.ja).length);

// 声の種類ごとに対応言語が違う（録音した肉声は日本語のみ）のでその表も見る。
const vlBlock = script.match(/const VOICE_LANGS=\{([\s\S]*?)\};/)[1];
const voiceLangs = {};
for (const m of vlBlock.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
  voiceLangs[m[1]] = m[2].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
}
check('対応言語表が声の種類と一致',
  kinds.length === Object.keys(voiceLangs).length && kinds.every(k => k in voiceLangs),
  kinds.map(k => k + '(' + voiceLangs[k].join('/') + ')').join(' '));
check('対応言語がすべて文言定義に存在',
  Object.values(voiceLangs).every(ls => ls.every(l => langs.includes(l))));

const missing = [];
let total = 0;
for (const k of kinds) for (const l of voiceLangs[k]) for (const n of names) {
  total++;
  if (!fs.existsSync(path.join(ROOT, 'audio', k, l, n + '.mp3'))) missing.push(k + '/' + l + '/' + n);
}
check('音声ファイルが実在する', missing.length === 0,
  missing.slice(0, 5).join(',') || total + '件');

// 対応していない言語のファイルを置いたままにしない（読み上げに落ちる前提が崩れる）
const stray = [];
for (const k of kinds) for (const l of langs) {
  if (voiceLangs[k].includes(l)) continue;
  if (fs.existsSync(path.join(ROOT, 'audio', k, l))) stray.push(k + '/' + l);
}
check('対応外の言語のファイルが残っていない', stray.length === 0, stray.join(',') || undefined);

/* Service Worker のキャッシュ対象と実構成の照合 */
const swSets = {};
const swBlock = sw.match(/const VOICE_SETS = \[([\s\S]*?)\];/)[1];
for (const m of swBlock.matchAll(/kind:\s*'(\w+)',\s*langs:\s*\[([^\]]*)\]/g)) {
  swSets[m[1]] = m[2].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
}
const swNames = JSON.parse('[' + sw.match(/for \(const n of \[([\s\S]*?)\]\)/)[1].replace(/'/g, '"') + ']');
check('SW のキャッシュ対象が本体の構成と一致',
  Object.keys(swSets).length === kinds.length &&
  kinds.every(k => swSets[k] && swSets[k].join() === voiceLangs[k].join()) &&
  swNames.length === names.length && swNames.every(n => names.includes(n)),
  Object.keys(swSets).join('/') + ' × ' + swNames.length + '件');

/* ---- 表示と実装の食い違い ---- */
const mr = script.match(/const MIN_R=(\d+), MAX_R=(\d+)/);
check('ラウンド数の説明文を定数から生成',
  /'sheet\.roundsHint':'\{min\}/.test(script) && /\{max\}/.test(script),
  mr[1] + '〜' + mr[2]);
check('比率バーが 0% を表現できる', /\.ratio>div\{[\s\S]*?min-width:0/.test(html));
check('カスタムの既定ラウンド数が一元化', /def:DEF_STATE\.rounds\.custom/.test(script));

/* ---- アクセシビリティ ---- */
// クリックだけ付けた div は、キーボードでも支援技術でも到達できない。
// 対話要素は button であることを機械的に担保する。
check('クリック専用の div が残っていない',
  !/<div class="row[^"]*" data-tg=/.test(html) && !/<div class="pick-item"/.test(html));
check('通知トグルが role=switch', (html.match(/role="switch"/g) || []).length === 15,
  (html.match(/role="switch"/g) || []).length + '件');
check('トグルの状態を aria-checked で伝える', /setAttribute\('aria-checked',on\)/.test(script));
check('プリセット選択が radiogroup/radio', /setAttribute\('role','radiogroup'\)/.test(script) && /role="radio"/.test(script));
check('チップに選択状態がある', /aria-pressed/.test(script));
// 声の選択は初回設定と通知設定の2箇所に出す。id だと1つしか持てないので class で揃える。
check('声の選択が初回設定と通知設定の両方にある',
  (html.match(/class="chips vk-chips"/g) || []).length === 2 &&
  (html.match(/class="rds vk-desc"/g) || []).length === 2,
  (html.match(/class="chips vk-chips"/g) || []).length + '箇所');
check('アイコンのみのボタンに名前がある',
  (html.match(/data-aria=/g) || []).length >= 5 && /setAttribute\('aria-label'/.test(script),
  (html.match(/data-aria=/g) || []).length + '件');
// button の中に button を置くと不正なHTMLになり、支援技術の読み取りも壊れる。
// 静的マークアップ部分（script を除く）で開閉と入れ子を数える。
const staticHtml = html.replace(/<script>[\s\S]*?<\/script>/, '');
const nest = (() => {
  let d = 0, bad = 0;
  for (const m of staticHtml.matchAll(/<button\b|<\/button>/g)) {
    if (m[0] === '</button>') d--; else { if (d > 0) bad++; d++; }
  }
  return { bad, d };
})();
check('静的HTMLに button の入れ子が無い', nest.bad === 0 && nest.d === 0,
  '入れ子' + nest.bad + ' / 開閉差' + nest.d);
// 動的生成側：プリセットの選択部分(psel)より後ろにチップを置いていること
const presetTpl = script.match(/el\.innerHTML=([\s\S]*?)el\.addEventListener/)[1];
check('プリセットの選択ボタンとチップが兄弟関係',
  presetTpl.indexOf("</button>'") < presetTpl.indexOf('data-r='),
  'psel を閉じてからチップ');

/* ---- 自衛 ---- */
check('フレーム埋め込みへの自衛がある', /self!==top/.test(script));
check('SW が same-origin に限定されている', /origin !== self\.location\.origin/.test(sw));
check('振動が使えない端末を考慮している', /canVibe/.test(script));

/* ---- 版の整合 ---- */
const ver = script.match(/const APP_VERSION='([^']+)'/)[1];
const cache = sw.match(/const CACHE = '([^']+)'/)[1];
check('版番号とキャッシュ名が設定済み', !!ver && !!cache, ver + ' / ' + cache);

console.log('');
if (failed) { console.log('  ' + failed + '件の不整合'); process.exit(1); }
console.log('  不整合なし');
