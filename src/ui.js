/**
 * ui.js — VR 内見ビューア UI モジュール (LCC Studio ライクリデザイン)
 * window.UI としてグローバル定義
 *
 * カラーパレット:
 *   背景:        #060810 (ほぼ黒)
 *   アクセント:   #00D4AA (ティール - XGRIDS ブランド近似)
 *   ヘッダー bg:  rgba(0,4,12,0.88) + blur
 *   パネル bg:    rgba(4,8,20,0.98)
 *   テキスト:     #F0F4F8
 *   サブテキスト: rgba(240,244,248,0.45)
 *   ボーダー:     rgba(0,212,170,0.12)
 */
window.UI = (function () {
    'use strict';

    // ---- CSS ----
    var CSS = [
        '#vr-naiken-ui *, #vr-naiken-ui *::before, #vr-naiken-ui *::after {',
        '  box-sizing: border-box; margin: 0; padding: 0; }',

        /* ヘッダー */
        '#vr-header {',
        '  position: fixed; top: 0; left: 0; right: 0; z-index: 100;',
        '  display: flex; align-items: center; gap: 8px;',
        '  padding: 10px 16px;',
        '  background: rgba(0,4,12,0.88);',
        '  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);',
        '  border-bottom: 1px solid rgba(0,212,170,0.12);',
        '  font-family: system-ui, -apple-system, sans-serif;',
        '  user-select: none; }',

        /* ロゴ・アイコン */
        '#vr-logo {',
        '  width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;',
        '  background: linear-gradient(135deg, #00D4AA, #00A88A);',
        '  display: flex; align-items: center; justify-content: center;',
        '  font-size: 11px; font-weight: 800; color: #060810; letter-spacing: -0.5px; }',

        '#vr-header h1 {',
        '  font-size: 14px; font-weight: 700; flex: 1;',
        '  letter-spacing: -0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
        '  color: #F0F4F8;',
        '  transition: color 0.3s; }',
        '#vr-header h1.has-scene {',
        '  color: #00D4AA; }',

        /* ボタン共通 */
        '.vr-btn {',
        '  display: inline-flex; align-items: center; gap: 5px;',
        '  padding: 5px 14px; border-radius: 99px;',
        '  border: 1px solid rgba(0,212,170,0.18);',
        '  background: rgba(0,212,170,0.06);',
        '  color: rgba(240,244,248,0.7); font-size: 12.5px; font-weight: 500;',
        '  cursor: pointer; transition: all 0.15s; white-space: nowrap;',
        '  font-family: system-ui, -apple-system, sans-serif; }',
        '.vr-btn:hover {',
        '  background: rgba(0,212,170,0.13);',
        '  border-color: rgba(0,212,170,0.35); color: #F0F4F8; }',
        '.vr-btn:active { transform: scale(0.96); }',
        '.vr-btn:disabled { opacity: 0.28; cursor: not-allowed; }',

        /* プライマリボタン（シーンを開く） */
        '.vr-btn--primary {',
        '  background: linear-gradient(135deg, #00D4AA, #00A88A);',
        '  border-color: transparent; color: #060810; font-weight: 700;',
        '  box-shadow: 0 2px 16px rgba(0,212,170,0.3); }',
        '.vr-btn--primary:hover {',
        '  background: linear-gradient(135deg, #00E8BB, #00C49A);',
        '  box-shadow: 0 4px 24px rgba(0,212,170,0.45);',
        '  border-color: transparent; color: #060810; }',

        '.vr-btn--vr-active {',
        '  background: linear-gradient(135deg,#10b981,#059669);',
        '  border-color: transparent; color: #fff; }',

        /* パネル */
        '#vr-load-panel {',
        '  position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);',
        '  z-index: 90; width: min(480px, 94vw);',
        '  background: rgba(4,8,20,0.98);',
        '  backdrop-filter: blur(32px); -webkit-backdrop-filter: blur(32px);',
        '  border: 1px solid rgba(0,212,170,0.14);',
        '  border-radius: 24px; padding: 28px;',
        '  font-family: system-ui, -apple-system, sans-serif; color: #F0F4F8;',
        '  box-shadow: 0 0 0 1px rgba(0,212,170,0.06), 0 48px 120px rgba(0,0,0,0.8); }',
        '#vr-load-panel.hidden { display: none; }',

        /* パネルヘッダー行 */
        '#vr-panel-header {',
        '  display: flex; align-items: center; justify-content: space-between;',
        '  margin-bottom: 22px; }',
        '#vr-panel-header h2 {',
        '  font-size: 16px; font-weight: 700; letter-spacing: -0.4px;',
        '  color: #F0F4F8; }',
        '#vr-panel-close {',
        '  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;',
        '  border: 1px solid rgba(0,212,170,0.15);',
        '  background: rgba(0,212,170,0.06);',
        '  color: rgba(240,244,248,0.4); font-size: 16px; cursor: pointer;',
        '  display: flex; align-items: center; justify-content: center;',
        '  transition: all 0.15s; line-height: 1; padding-bottom: 1px; }',
        '#vr-panel-close:hover {',
        '  background: rgba(0,212,170,0.14); color: #F0F4F8;',
        '  border-color: rgba(0,212,170,0.35); }',

        /* タブ（セグメントコントロール） */
        '#vr-tabs {',
        '  display: flex; gap: 2px; margin-bottom: 20px;',
        '  background: rgba(0,212,170,0.05); border-radius: 12px;',
        '  padding: 3px; border: 1px solid rgba(0,212,170,0.08); }',
        '.vr-tab {',
        '  flex: 1; padding: 8px 10px; font-size: 12.5px; font-weight: 600;',
        '  cursor: pointer; color: rgba(240,244,248,0.38);',
        '  border-radius: 10px; text-align: center; transition: all 0.18s; }',
        '.vr-tab.active {',
        '  background: rgba(0,212,170,0.12);',
        '  color: #00D4AA; }',
        '.vr-tab-content { display: none; }',
        '.vr-tab-content.active { display: block; }',

        /* URL フォーム */
        '#vr-url-form { display: flex; flex-direction: column; gap: 10px; }',
        '#vr-url-input {',
        '  width: 100%; padding: 11px 14px;',
        '  background: rgba(0,212,170,0.04);',
        '  border: 1px solid rgba(0,212,170,0.12);',
        '  border-radius: 12px; color: #F0F4F8; font-size: 13px;',
        '  outline: none; transition: all 0.15s;',
        '  font-family: system-ui, -apple-system, sans-serif; }',
        '#vr-url-input:focus {',
        '  border-color: rgba(0,212,170,0.5);',
        '  background: rgba(0,212,170,0.07);',
        '  box-shadow: 0 0 0 3px rgba(0,212,170,0.1); }',
        '#vr-url-input::placeholder { color: rgba(240,244,248,0.22); }',
        '#vr-load-url-btn {',
        '  padding: 12px; width: 100%;',
        '  background: linear-gradient(135deg, #00D4AA, #00A88A);',
        '  border: none; border-radius: 12px;',
        '  color: #060810; font-size: 13.5px; font-weight: 700;',
        '  cursor: pointer; transition: all 0.15s;',
        '  box-shadow: 0 4px 20px rgba(0,212,170,0.28);',
        '  font-family: system-ui, -apple-system, sans-serif; letter-spacing: 0.1px; }',
        '#vr-load-url-btn:hover {',
        '  background: linear-gradient(135deg, #00E8BB, #00C49A);',
        '  box-shadow: 0 6px 28px rgba(0,212,170,0.42);',
        '  transform: translateY(-1px); }',
        '#vr-load-url-btn:active { transform: translateY(0); }',
        '.vr-url-hint {',
        '  font-size: 11px; color: rgba(240,244,248,0.28); line-height: 1.65;',
        '  padding: 10px 12px; border-radius: 10px;',
        '  background: rgba(0,212,170,0.03);',
        '  border: 1px solid rgba(0,212,170,0.07); }',
        '.vr-url-hint a { color: rgba(0,212,170,0.8); text-decoration: none; }',
        '.vr-url-hint code {',
        '  font-size: 10px; background: rgba(0,212,170,0.08);',
        '  padding: 1px 5px; border-radius: 4px; word-break: break-all; }',

        /* ドロップゾーン */
        '#vr-dropzone {',
        '  border: 1.5px dashed rgba(0,212,170,0.18);',
        '  border-radius: 14px; padding: 38px 20px;',
        '  text-align: center; cursor: pointer;',
        '  transition: all 0.2s; color: rgba(240,244,248,0.35);',
        '  font-size: 13px; background: rgba(0,212,170,0.03); }',
        '#vr-dropzone:hover, #vr-dropzone.dragover {',
        '  border-color: rgba(0,212,170,0.5);',
        '  background: rgba(0,212,170,0.07); color: #F0F4F8; }',
        '#vr-dropzone .drop-icon {',
        '  font-size: 28px; margin-bottom: 10px; display: block;',
        '  opacity: 0.5; }',
        '#vr-dropzone .drop-sub { font-size: 11px; margin-top: 5px; opacity: 0.5; }',

        /* フォルダ一括読み込みセクション */
        '#vr-folder-section { margin-top: 16px; }',
        '#vr-folder-divider {',
        '  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;',
        '  color: rgba(0,212,170,0.35); font-size: 11px; font-weight: 600;',
        '  letter-spacing: 0.6px; text-transform: uppercase; }',
        '#vr-folder-divider::before, #vr-folder-divider::after {',
        '  content: ""; flex: 1;',
        '  border-top: 1px solid rgba(0,212,170,0.1); }',
        '#vr-folder-btn {',
        '  width: 100%; padding: 12px 16px;',
        '  background: rgba(0,212,170,0.08);',
        '  border: 1.5px solid rgba(0,212,170,0.25);',
        '  border-radius: 12px;',
        '  color: #00D4AA; font-size: 13.5px; font-weight: 700;',
        '  cursor: pointer; transition: all 0.15s;',
        '  font-family: system-ui, sans-serif;',
        '  display: flex; align-items: center; justify-content: center; gap: 8px; }',
        '#vr-folder-btn:hover {',
        '  background: rgba(0,212,170,0.16);',
        '  border-color: rgba(0,212,170,0.5);',
        '  box-shadow: 0 4px 20px rgba(0,212,170,0.2);',
        '  transform: translateY(-1px); }',
        '#vr-folder-btn:active { transform: translateY(0); }',
        '#vr-folder-hint {',
        '  margin-top: 8px; font-size: 11px;',
        '  color: rgba(240,244,248,0.22); line-height: 1.65;',
        '  padding: 0 2px; }',

        /* スピナー */
        '#vr-loading {',
        '  position: fixed; inset: 0; z-index: 200;',
        '  display: flex; flex-direction: column;',
        '  align-items: center; justify-content: center; gap: 18px;',
        '  background: rgba(0,4,12,0.9);',
        '  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
        '  color: rgba(240,244,248,0.8);',
        '  font-family: system-ui, sans-serif;',
        '  font-size: 13px; letter-spacing: 0.2px; }',
        '#vr-loading.hidden { display: none; }',

        /* スピナー本体（二重リング） */
        '.vr-spinner {',
        '  position: relative; width: 40px; height: 40px; }',
        '.vr-spinner::before, .vr-spinner::after {',
        '  content: ""; position: absolute; border-radius: 50%; }',
        '.vr-spinner::before {',
        '  inset: 0;',
        '  border: 3px solid rgba(0,212,170,0.12);',
        '  border-top-color: #00D4AA;',
        '  animation: vr-spin 0.75s linear infinite; }',
        '.vr-spinner::after {',
        '  inset: 6px;',
        '  border: 2px solid rgba(0,212,170,0.07);',
        '  border-bottom-color: rgba(0,212,170,0.5);',
        '  animation: vr-spin 1.4s linear infinite reverse; }',
        '@keyframes vr-spin { to { transform: rotate(360deg); } }',

        /* ローディングメッセージ */
        '#vr-loading-msg {',
        '  color: rgba(240,244,248,0.65);',
        '  font-size: 12.5px; max-width: 280px; text-align: center;',
        '  line-height: 1.6; }',

        /* トースト */
        '#vr-toast-container {',
        '  position: fixed; top: 58px; right: 16px; z-index: 300;',
        '  display: flex; flex-direction: column; gap: 8px; pointer-events: none; }',
        '.vr-toast {',
        '  padding: 12px 18px; border-radius: 12px;',
        '  background: rgba(220,50,50,0.94);',
        '  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
        '  border: 1px solid rgba(255,100,100,0.2);',
        '  color: #fff; font-family: system-ui, sans-serif;',
        '  font-size: 13px; max-width: 320px; line-height: 1.5;',
        '  box-shadow: 0 8px 32px rgba(0,0,0,0.4);',
        '  animation: vr-ti 0.22s ease, vr-to 0.35s ease 3.65s forwards; }',
        '.vr-toast--info {',
        '  background: rgba(0,40,32,0.96);',
        '  border-color: rgba(0,212,170,0.25); color: #00D4AA; }',
        '@keyframes vr-ti { from { opacity:0; transform: translateX(16px); } to { opacity:1; transform: none; } }',
        '@keyframes vr-to { from { opacity:1; } to { opacity:0; transform: translateX(16px); } }',

        /* 操作説明 */
        '#vr-help-overlay {',
        '  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);',
        '  z-index: 110; white-space: nowrap;',
        '  padding: 12px 20px; border-radius: 16px;',
        '  background: rgba(0,4,12,0.94);',
        '  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);',
        '  border: 1px solid rgba(0,212,170,0.1);',
        '  box-shadow: 0 8px 40px rgba(0,0,0,0.5);',
        '  color: rgba(240,244,248,0.6);',
        '  font-family: system-ui, sans-serif;',
        '  font-size: 11.5px; line-height: 1.9; pointer-events: none;',
        '  transition: opacity 0.5s; }',
        '#vr-help-overlay.fade-out { opacity: 0; }',
        '#vr-help-overlay.hidden { display: none; }',
        '#vr-help-overlay table { border-collapse: collapse; }',
        '#vr-help-overlay td { padding: 0 14px 0 0; }',
        '#vr-help-overlay td:first-child {',
        '  color: #00D4AA; font-weight: 700;',
        '  font-size: 10.5px; letter-spacing: 0.5px; text-transform: uppercase;',
        '  min-width: 100px; }',

        /* ヘルプボタン */
        '#vr-help-btn {',
        '  position: fixed; bottom: 20px; right: 20px; z-index: 120;',
        '  width: 32px; height: 32px; border-radius: 50%;',
        '  background: rgba(0,4,12,0.9);',
        '  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
        '  border: 1px solid rgba(0,212,170,0.15);',
        '  color: rgba(0,212,170,0.55); font-size: 14px; font-weight: 700;',
        '  cursor: pointer; display: flex; align-items: center; justify-content: center;',
        '  transition: all 0.15s; }',
        '#vr-help-btn:hover {',
        '  background: rgba(0,212,170,0.12);',
        '  border-color: rgba(0,212,170,0.4); color: #00D4AA; }',

        /* コライダートグルボタン */
        '#vr-collider-btn.hidden { display: none; }',
        '#vr-collider-btn.collider-on {',
        '  background: rgba(0,212,170,0.15);',
        '  border-color: rgba(0,212,170,0.45); color: #00D4AA; }',

        /* シェアボタン */
        '#vr-share-btn.hidden { display: none; }',
        '#vr-share-btn {',
        '  background: rgba(0,212,170,0.08);',
        '  border-color: rgba(0,212,170,0.22); color: rgba(0,212,170,0.85); }',
        '#vr-share-btn:hover {',
        '  background: rgba(0,212,170,0.16);',
        '  border-color: rgba(0,212,170,0.45); color: #00D4AA; }',
        '#vr-share-btn.copied {',
        '  background: rgba(0,212,170,0.22);',
        '  border-color: rgba(0,212,170,0.55); color: #00D4AA; }',

        /* フルスクリーンボタン */
        '#vr-fullscreen-btn { padding: 5px 9px; min-width: 0; }',

        /* ステータスバー（バックグラウンド処理の進捗表示）*/
        '#vr-status-bar {',
        '  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);',
        '  z-index: 115; white-space: nowrap;',
        '  padding: 8px 18px; border-radius: 99px;',
        '  background: rgba(0,4,12,0.92);',
        '  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
        '  border: 1px solid rgba(0,212,170,0.2);',
        '  color: rgba(0,212,170,0.9); font-size: 12px;',
        '  font-family: system-ui, sans-serif; pointer-events: none;',
        '  transition: opacity 0.3s; }',
        '#vr-status-bar.hidden { display: none; }',

        /* エンプティステート */
        '#vr-empty-state {',
        '  position: fixed; inset: 0; z-index: 50;',
        '  display: flex; flex-direction: column;',
        '  align-items: center; justify-content: center; gap: 12px;',
        '  font-family: system-ui, -apple-system, sans-serif;',
        '  pointer-events: none; }',
        '#vr-empty-state.hidden { display: none; }',
        '.vr-empty-icon {',
        '  font-size: 40px; opacity: 0.12; margin-bottom: 4px; }',
        '.vr-empty-title {',
        '  font-size: 15px; font-weight: 700; letter-spacing: -0.3px;',
        '  color: rgba(240,244,248,0.22); }',
        '.vr-empty-sub {',
        '  font-size: 12px; color: rgba(240,244,248,0.12);',
        '  max-width: 260px; text-align: center; line-height: 1.7; }',

        /* モバイル対応 */
        '@media (hover: none) and (pointer: coarse) {',
        '  .vr-btn { padding: 8px 16px; min-height: 44px; }',
        '  #vr-fullscreen-btn { padding: 8px 12px; }',
        '  #vr-url-input { padding: 13px 14px; font-size: 16px; }',
        '  #vr-load-url-btn { padding: 14px; }',
        '  #vr-dropzone { padding: 48px 20px; }',
        '  #vr-folder-btn { padding: 14px 16px; } }',
    ].join('\n');

    // ---- 内部状態 ----
    var _elPanel       = null;
    var _elDropzone    = null;
    var _elURLInput    = null;
    var _elLoading     = null;
    var _elLoadingMsg  = null;
    var _elToastCont   = null;
    var _elVRBtn       = null;
    var _elHelpOverlay = null;
    var _helpTimer     = null;
    var _callbacks     = {};
    var _elShareBtn    = null;
    var _elEmptyState  = null;
    var _elTitleEl     = null;
    var _elStatusBar   = null;
    var _elColliderBtn = null;

    // ---- ユーティリティ ----
    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'className') node.className = attrs[k];
                else if (k === 'textContent') node.textContent = attrs[k];
                else if (k === 'innerHTML') node.innerHTML = attrs[k];
                else node.setAttribute(k, attrs[k]);
            });
        }
        (children || []).forEach(function (c) {
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function showHelp() {
        if (!_elHelpOverlay) return;
        _elHelpOverlay.classList.remove('hidden', 'fade-out');
        if (_helpTimer) clearTimeout(_helpTimer);
        _helpTimer = setTimeout(function () {
            _elHelpOverlay.classList.add('fade-out');
            setTimeout(function () { _elHelpOverlay.classList.add('hidden'); }, 650);
        }, 5000);
    }

    function triggerLoad(file) {
        if (!file) return;
        var ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'ply' && ext !== 'splat') {
            window.UI.showError('.ply または .splat ファイルを選択してください');
            return;
        }
        if (_callbacks.onFileLoaded) _callbacks.onFileLoaded(file);
        if (_elPanel) _elPanel.classList.add('hidden');
    }

    function triggerURLLoad(url) {
        url = (url || '').trim();
        if (!url) { window.UI.showError('URL を入力してください'); return; }
        if (_callbacks.onURLLoaded) _callbacks.onURLLoaded(url);
        if (_elPanel) _elPanel.classList.add('hidden');
    }

    // ---- 公開 API ----
    return {
        init: function (app, callbacks) {
            _callbacks = callbacks || {};

            var style = document.createElement('style');
            style.textContent = CSS;
            document.head.appendChild(style);

            var root = el('div', { id: 'vr-naiken-ui' });
            document.body.appendChild(root);

            // ===== ヘッダー =====
            var fileInput = el('input', { type: 'file', accept: '.ply,.splat', style: 'display:none' });
            fileInput.addEventListener('change', function () {
                if (fileInput.files[0]) triggerLoad(fileInput.files[0]);
                fileInput.value = '';
            });

            var openBtn = el('button', {
                className: 'vr-btn vr-btn--primary',
                textContent: 'シーンを開く'
            });
            openBtn.addEventListener('click', function () {
                if (_elPanel) _elPanel.classList.toggle('hidden');
            });

            _elColliderBtn = el('button', {
                id: 'vr-collider-btn',
                className: 'vr-btn hidden',
                textContent: '床 OFF'
            });
            _elColliderBtn.addEventListener('click', function () {
                if (!window.Collider || !Collider.isReady()) return;
                var next = !Collider.isEnabled();
                Collider.setEnabled(next);
                _elColliderBtn.textContent = '床 ' + (next ? 'ON' : 'OFF');
                _elColliderBtn.classList.toggle('collider-on', next);
            });

            _elVRBtn = el('button', { className: 'vr-btn', textContent: 'VR', disabled: 'disabled' });
            _elVRBtn.addEventListener('click', function () {
                if (!_elVRBtn.disabled && _callbacks.onVRRequested) _callbacks.onVRRequested();
            });

            _elShareBtn = el('button', {
                id: 'vr-share-btn',
                className: 'vr-btn hidden',
                textContent: 'URL をコピー'
            });
            _elShareBtn.addEventListener('click', function () {
                navigator.clipboard.writeText(window.location.href).then(function () {
                    _elShareBtn.textContent = 'コピー完了!';
                    _elShareBtn.classList.add('copied');
                    setTimeout(function () {
                        _elShareBtn.textContent = 'URL をコピー';
                        _elShareBtn.classList.remove('copied');
                    }, 2000);
                }).catch(function () {
                    window.UI.showError('クリップボードへのコピーに失敗しました');
                });
            });

            var fsBtn = el('button', {
                id: 'vr-fullscreen-btn',
                className: 'vr-btn',
                title: 'フルスクリーン',
                textContent: '全画面'
            });
            fsBtn.addEventListener('click', function () {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(function () {});
                } else {
                    document.exitFullscreen().catch(function () {});
                }
            });

            var logoEl = el('div', { id: 'vr-logo', textContent: '3D' });
            _elTitleEl = el('h1', { textContent: 'VR 内見ビューア' });

            root.appendChild(el('div', { id: 'vr-header' }, [
                logoEl,
                _elTitleEl,
                fileInput, openBtn, _elShareBtn, _elColliderBtn, _elVRBtn, fsBtn,
            ]));

            // ===== ロードパネル =====
            _elPanel = el('div', { id: 'vr-load-panel' });

            // タブ
            var tabURL  = el('div', { className: 'vr-tab active', textContent: 'URL から開く' });
            var tabFile = el('div', { className: 'vr-tab',         textContent: 'ローカルファイル' });
            var tabBar  = el('div', { id: 'vr-tabs' }, [tabURL, tabFile]);

            var paneURL  = el('div', { className: 'vr-tab-content active', id: 'vr-pane-url' });
            var paneFile = el('div', { className: 'vr-tab-content',        id: 'vr-pane-file' });

            tabURL.addEventListener('click', function () {
                tabURL.classList.add('active');  tabFile.classList.remove('active');
                paneURL.classList.add('active'); paneFile.classList.remove('active');
            });
            tabFile.addEventListener('click', function () {
                tabFile.classList.add('active');  tabURL.classList.remove('active');
                paneFile.classList.add('active'); paneURL.classList.remove('active');
            });

            // --- URL タブ ---
            _elURLInput = el('input', {
                id: 'vr-url-input',
                type: 'text',
                placeholder: 'https://example.com/scene.ply'
            });

            var loadURLBtn = el('button', { id: 'vr-load-url-btn', textContent: '読み込む' });
            loadURLBtn.addEventListener('click', function () {
                triggerURLLoad(_elURLInput.value);
            });
            _elURLInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') triggerURLLoad(_elURLInput.value);
            });

            var urlForm = el('div', { id: 'vr-url-form' }, [
                _elURLInput,
                loadURLBtn,
                el('div', { className: 'vr-url-hint', innerHTML:
                    '.ply / .splat ファイルの直接 URL を貼り付けてください。<br>' +
                    'Google Cloud Storage や AWS S3 など CORS を設定したストレージが使えます。<br>' +
                    'Google Drive の場合は <strong>「リンクを知っている全員」</strong> に共有し、<br>' +
                    '<code>https://drive.usercontent.google.com/download?id=ファイルID&export=download</code><br>' +
                    'の形式の URL を使用してください。'
                }),
            ]);
            paneURL.appendChild(urlForm);

            // --- ファイルタブ ---
            _elDropzone = el('div', { id: 'vr-dropzone' }, [
                el('div', { className: 'drop-icon', textContent: '↑' }),
                el('div', { textContent: 'クリックまたはドラッグ＆ドロップ' }),
                el('div', { className: 'drop-sub', textContent: '.ply / .splat に対応' }),
            ]);
            _elDropzone.addEventListener('click', function () { fileInput.click(); });
            _elDropzone.addEventListener('dragover', function (e) {
                e.preventDefault(); _elDropzone.classList.add('dragover');
            });
            _elDropzone.addEventListener('dragleave', function () {
                _elDropzone.classList.remove('dragover');
            });
            _elDropzone.addEventListener('drop', function (e) {
                e.preventDefault();
                _elDropzone.classList.remove('dragover');
                if (e.dataTransfer.files[0]) triggerLoad(e.dataTransfer.files[0]);
            });
            paneFile.appendChild(_elDropzone);

            // フォルダ一括読み込みセクション
            var folderInput = el('input', { type: 'file', style: 'display:none' });
            folderInput.setAttribute('webkitdirectory', '');
            folderInput.setAttribute('multiple', '');
            folderInput.addEventListener('change', function () {
                if (folderInput.files.length > 0) {
                    if (_callbacks.onFolderLoaded) _callbacks.onFolderLoaded(folderInput.files);
                    if (_elPanel) _elPanel.classList.add('hidden');
                }
                folderInput.value = '';
            });

            var folderBtn = el('button', {
                id: 'vr-folder-btn',
                textContent: 'シーンフォルダを開く'
            });
            folderBtn.addEventListener('click', function () { folderInput.click(); });

            paneFile.appendChild(el('div', { id: 'vr-folder-section' }, [
                el('div', { id: 'vr-folder-divider', textContent: 'フォルダから一括読み込み' }),
                folderInput,
                folderBtn,
                el('div', { id: 'vr-folder-hint',
                    textContent: '.ply / .splat を含むフォルダを選択してください。カメラ位置 (.json) とコリジョン (.hmap.json または .voxel.json + .voxel.bin) が同じフォルダにあれば自動で読み込まれます。'
                }),
            ]));

            // canvas 全体にもドロップ対応
            var dropTarget = (app && app.graphicsDevice && app.graphicsDevice.canvas)
                || document.getElementById('application-canvas')
                || document.body;
            dropTarget.addEventListener('dragover', function (e) { e.preventDefault(); });
            dropTarget.addEventListener('drop', function (e) {
                e.preventDefault();
                if (e.dataTransfer.files[0]) triggerLoad(e.dataTransfer.files[0]);
            });

            var panelClose = el('button', { id: 'vr-panel-close', title: '閉じる', textContent: '×' });
            panelClose.addEventListener('click', function () { _elPanel.classList.add('hidden'); });
            _elPanel.appendChild(el('div', { id: 'vr-panel-header' }, [
                el('h2', { textContent: 'シーンを開く' }),
                panelClose,
            ]));
            _elPanel.appendChild(tabBar);
            _elPanel.appendChild(paneURL);
            _elPanel.appendChild(paneFile);
            root.appendChild(_elPanel);

            // ===== スピナー =====
            _elLoadingMsg = el('div', { id: 'vr-loading-msg', textContent: '読み込み中...' });
            _elLoading = el('div', { id: 'vr-loading', className: 'hidden' }, [
                el('div', { className: 'vr-spinner' }),
                _elLoadingMsg,
            ]);
            root.appendChild(_elLoading);

            // ===== トースト =====
            _elToastCont = el('div', { id: 'vr-toast-container' });
            root.appendChild(_elToastCont);

            // ===== 操作説明 =====
            var _isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
            var _helpRows = _isTouchDevice ? [
                '<tr><td>1本指ドラッグ</td><td>視点回転</td></tr>',
                '<tr><td>2本指ドラッグ</td><td>前後左右移動</td></tr>',
                '<tr><td>2本指ピンチ</td><td>速度変更</td></tr>',
            ] : [
                '<tr><td>左右ドラッグ</td><td>視点回転</td></tr>',
                '<tr><td>W / A / S / D</td><td>前後左右移動</td></tr>',
                '<tr><td>Q</td><td>上昇</td></tr>',
                '<tr><td>E</td><td>下降</td></tr>',
                '<tr><td>ホイール</td><td>移動速度変更</td></tr>',
                '<tr><td>F</td><td>原点リセット</td></tr>',
            ];
            _elHelpOverlay = el('div', { id: 'vr-help-overlay',
                innerHTML: '<table>' + _helpRows.join('') + '</table>' });
            root.appendChild(_elHelpOverlay);

            var helpBtn = el('button', { id: 'vr-help-btn', title: '操作説明', textContent: '?' });
            helpBtn.addEventListener('click', showHelp);
            root.appendChild(helpBtn);

            _elEmptyState = el('div', { id: 'vr-empty-state' }, [
                el('div', { className: 'vr-empty-icon', textContent: '⬡' }),
                el('div', { className: 'vr-empty-title', textContent: '3D シーンが読み込まれていません' }),
                el('div', { className: 'vr-empty-sub',  textContent: '上の「シーンを開く」からファイルまたは URL を読み込んでください' }),
            ]);
            root.appendChild(_elEmptyState);

            _elStatusBar = el('div', { id: 'vr-status-bar', className: 'hidden' });
            root.appendChild(_elStatusBar);

            showHelp();
        },

        showLoading: function (msg) {
            if (!_elLoading) return;
            _elLoadingMsg.textContent = msg || '読み込み中...';
            _elLoading.classList.remove('hidden');
        },

        hideLoading: function () {
            if (_elLoading) _elLoading.classList.add('hidden');
        },

        showError: function (msg) {
            if (!_elToastCont) { console.error('[UI]', msg); return; }
            var toast = el('div', { className: 'vr-toast', textContent: msg });
            _elToastCont.appendChild(toast);
            setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 4100);
        },

        showInfo: function (msg) {
            if (!_elToastCont) return;
            var toast = el('div', { className: 'vr-toast vr-toast--info', textContent: msg });
            _elToastCont.appendChild(toast);
            setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 4100);
        },

        showTooltip: function (msg) { this.showInfo(msg); },

        setVRButtonState: function (state) {
            if (!_elVRBtn) return;
            _elVRBtn.classList.remove('vr-btn--primary', 'vr-btn--vr-active');
            _elVRBtn.removeAttribute('disabled');
            if (state === 'available') {
                _elVRBtn.classList.add('vr-btn--primary');
                _elVRBtn.textContent = 'VR';
            } else if (state === 'active') {
                _elVRBtn.classList.add('vr-btn--vr-active');
                _elVRBtn.textContent = 'VR 終了';
            } else {
                _elVRBtn.setAttribute('disabled', 'disabled');
                _elVRBtn.textContent = 'VR';
            }
        },

        showPanel: function () {
            if (_elPanel) _elPanel.classList.remove('hidden');
        },

        updateCallbacks: function (newCallbacks) {
            Object.assign(_callbacks, newCallbacks);
        },

        /**
         * ヘッダータイトルを更新する
         * シーン名が設定された場合はアクセントカラーで表示
         * @param {string} title
         */
        setTitle: function (title) {
            if (_elTitleEl) {
                _elTitleEl.textContent = title;
                _elTitleEl.classList.add('has-scene');
            }
        },

        hideEmptyState: function () {
            if (_elEmptyState) _elEmptyState.classList.add('hidden');
        },

        showShareButton: function () {
            if (_elShareBtn) _elShareBtn.classList.remove('hidden');
        },

        showColliderBtn: function () {
            if (!_elColliderBtn) return;
            var on = window.Collider && Collider.isEnabled();
            _elColliderBtn.textContent = '床 ' + (on ? 'ON' : 'OFF');
            _elColliderBtn.classList.toggle('collider-on', on);
            _elColliderBtn.classList.remove('hidden');
        },

        showStatus: function (msg) {
            if (!_elStatusBar) return;
            _elStatusBar.textContent = msg;
            _elStatusBar.classList.remove('hidden');
        },

        hideStatus: function () {
            if (_elStatusBar) _elStatusBar.classList.add('hidden');
        },
    };
}());
