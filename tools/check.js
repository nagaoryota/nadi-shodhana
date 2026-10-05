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

const missing = [];
for (const k of kinds) for (const l of langs) for (const n of names) {
  const f = path.join(ROOT, 'audio', k, l, n + '.mp3');
  if (!fs.existsSync(f)) missing.push(k + '/' + l + '/' + n);
}
check('音声ファイルが実在する', missing.length === 0,
  missing.slice(0, 5).join(',') || (kinds.length * langs.length * names.length) + '件');

/* Service Worker のキャッシュ対象と実ファイルの照合 */
const swKinds = JSON.parse((sw.match(/for \(const kind of (\[[^\]]*\])/) || [])[1].replace(/'/g, '"'));
const swNames = JSON.parse('[' + sw.match(/for \(const n of \[([\s\S]*?)\]\)/)[1].replace(/'/g, '"') + ']');
check('SW のキャッシュ対象が音声の実構成と一致',
  swKinds.length === kinds.length && swKinds.every(k => kinds.includes(k)) &&
  swNames.length === names.length && swNames.every(n => names.includes(n)),
  swKinds.join('/') + ' × ' + swNames.length + '件');

/* ---- 表示と実装の食い違い ---- */
const mr = script.match(/const MIN_R=(\d+), MAX_R=(\d+)/);
check('ラウンド数の説明文を定数から生成',
  /'sheet\.roundsHint':'\{min\}/.test(script) && /\{max\}/.test(script),
  mr[1] + '〜' + mr[2]);
check('比率バーが 0% を表現できる', /\.ratio>div\{[\s\S]*?min-width:0/.test(html));
check('カスタムの既定ラウンド数が一元化', /def:DEF_STATE\.rounds\.custom/.test(script));

/* ---- 版の整合 ---- */
const ver = script.match(/const APP_VERSION='([^']+)'/)[1];
const cache = sw.match(/const CACHE = '([^']+)'/)[1];
check('版番号とキャッシュ名が設定済み', !!ver && !!cache, ver + ' / ' + cache);

console.log('');
if (failed) { console.log('  ' + failed + '件の不整合'); process.exit(1); }
console.log('  不整合なし');
