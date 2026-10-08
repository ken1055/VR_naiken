/**
 * sheet_viewer_url.gs — 物件一覧スプレッドシートで共有 URL（C 列）を自動生成する Google Apps Script
 *
 * 列の約束:
 *   A: 物件名（表示名。省略可）
 *   B: GCS のフォルダ URL / gs:// パス / バケット内のフォルダ名（どれでも可）
 *      例) https://storage.googleapis.com/vr_naiken_properties/10月1日/部屋/point_cloud.compressed.ply
 *          https://storage.cloud.google.com/vr_naiken_properties/10月1日/部屋/
 *          gs://vr_naiken_properties/10月1日/部屋
 *          10月1日/部屋
 *   C: 共有 URL（自動）  → https://ken1055.github.io/VR_naiken/?f=10%E6%9C%881%E6%97%A5/%E9%83%A8%E5%B1%8B
 *
 * 生成するのは短縮形 ?f=<バケット内フォルダ>（src/main.js、2026-10-05 以降のビューア）。
 * 物件名がフォルダ名の末尾と同じなら &t= も付けない（ビューアが末尾フォルダ名を表示名にする）。
 *
 * 使い方: スプレッドシートの 拡張機能 → Apps Script に貼り付けて保存。
 *   - A/B 列を編集すると onEdit が C 列を更新する
 *   - 既存の行をまとめて作り直すときはエディタから regenerateAll を実行
 *
 * 旧スクリプトとの違い:
 *   - getValue() → getDisplayValue(): 「10月1日」のような物件名をシートが日付として
 *     解釈すると getValue() は Date になり、URL に "Thu Oct 01 2026 00:00:00 GMT+0900 (日本標準時)"
 *     が入っていた。表示文字列をそのまま使う。
 *   - ?url=<URL 全体をエンコード> → ?f=<フォルダ>（短い。ファイル名まで書いてあれば自動で落とす）
 */
var VIEWER_BASE = 'https://ken1055.github.io/VR_naiken/';
var BUCKET      = 'vr_naiken_properties';
var COL_TITLE = 1, COL_SRC = 2, COL_OUT = 3;

function onEdit(e) {
  var col = e.range.getColumn();
  if (col !== COL_TITLE && col !== COL_SRC) return;
  var sheet = e.range.getSheet();
  var first = e.range.getRow(), n = e.range.getNumRows();   // 複数行の貼り付けにも対応
  for (var r = first; r < first + n; r++) {
    if (r === 1) continue;   // ヘッダー行
    updateRow_(sheet, r);
  }
}

/** 全行の C 列を作り直す（エディタから手動実行） */
function regenerateAll() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var last  = sheet.getLastRow();
  for (var r = 2; r <= last; r++) updateRow_(sheet, r);
}

function updateRow_(sheet, row) {
  var title = String(sheet.getRange(row, COL_TITLE).getDisplayValue() || '').trim();
  var src   = String(sheet.getRange(row, COL_SRC).getDisplayValue() || '').trim();
  sheet.getRange(row, COL_OUT).setValue(src ? buildViewerUrl_(src, title) : '');
}

/** B 列の値と物件名から共有 URL を組み立てる */
function buildViewerUrl_(src, title) {
  var path = bucketPath_(src);
  if (path === null) {
    // バケット外の URL は従来形式のまま（ビューア側の許可リストで弾かれることがある）
    return VIEWER_BASE + '?url=' + encodeURIComponent(src) +
      (title ? '&title=' + encodeURIComponent(title) : '');
  }
  var segs = path.split('/');
  var url  = VIEWER_BASE + '?f=' + segs.map(encodeURIComponent).join('/');
  var last = segs[segs.length - 1];
  if (/\.(ply|splat)$/i.test(last) && segs.length >= 2) last = segs[segs.length - 2];
  if (title && title !== last) url += '&t=' + encodeURIComponent(title);
  return url;
}

/**
 * B 列の値から「バケット内のパス」を取り出す。バケット外・不正なら null。
 * 標準のファイル名（manifest.json / point_cloud.compressed.ply / point_cloud.ply）は
 * フォルダ指定に丸める（ビューアが自動で探す）。それ以外のファイル名はそのまま残す。
 */
function bucketPath_(src) {
  var s = String(src).trim().replace(/[?#].*$/, '');
  var m = s.match(/^(?:https?:\/\/(?:storage\.googleapis\.com|storage\.cloud\.google\.com)\/|gs:\/\/)([^\/]+)\/(.*)$/);
  var path;
  if (m) {
    if (m[1] !== BUCKET) return null;
    path = m[2];
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    return null;                 // 他のホスト
  } else {
    path = s;                    // フォルダ名だけ書いてある
  }
  try { path = decodeURIComponent(path); } catch (err) { /* 生の % を含む名前はそのまま */ }
  path = path.replace(/^\/+|\/+$/g, '');
  path = path.replace(/\/(manifest\.json|point_cloud(\.compressed)?\.ply)$/i, '');
  if (!path) return null;
  var bad = path.split('/').some(function (p) { return p === '' || p === '.' || p === '..'; });
  return bad ? null : path;
}
