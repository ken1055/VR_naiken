/**
 * ui.js — VR 内見ビューア UI モジュール
 * window.UI としてグローバル定義
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
        '  background: rgba(6,6,16,0.82);',
        '  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);',
        '  border-bottom: 1px solid rgba(255,255,255,0.06);',
        '  font-family: system-ui, -apple-system, sans-serif;',
        '  user-select: none; }',
        '#vr-header h1 {',
        '  font-size: 13.5px; font-weight: 600; flex: 1;',
        '  letter-spacing: -0.2px; white-space: nowrap;',
        '  color: rgba(248,250,252,0.92); }',

        /* ボタン共通 */
        '.vr-btn {',
        '  display: inline-flex; align-items: center; gap: 5px;',
        '  padding: 5px 14px; border-radius: 99px;',
        '  border: 1px solid rgba(255,255,255,0.13);',
        '  background: rgba(255,255,255,0.07);',
        '  color: rgba(248,250,252,0.75); font-size: 12.5px; font-weight: 500;',
        '  cursor: pointer; transition: all 0.15s; white-space: nowrap;',
        '  font-family: system-ui, -apple-system, sans-serif; }',
        '.vr-btn:hover {',
        '  background: rgba(255,255,255,0.13);',
        '  border-color: rgba(255,255,255,0.25); color: #f8fafc; }',
        '.vr-btn:active { transform: scale(0.96); }',
        '.vr-btn:disabled { opacity: 0.3; cursor: not-allowed; }',
        '.vr-btn--primary {',
        '  background: linear-gradient(135deg,#6366f1,#4f46e5);',
        '  border-color: transparent; color: #fff;',
        '  box-shadow: 0 2px 14px rgba(99,102,241,0.35); }',
        '.vr-btn--primary:hover {',
        '  background: linear-gradient(135deg,#818cf8,#6366f1);',
        '  box-shadow: 0 4px 22px rgba(99,102,241,0.5);',
        '  border-color: transparent; color: #fff; }',
        '.vr-btn--vr-active {',
        '  background: linear-gradient(135deg,#10b981,#059669);',
        '  border-color: transparent; color: #fff; }',

        /* パネル */
        '#vr-load-panel {',
        '  position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);',
        '  z-index: 90; width: min(460px, 92vw);',
        '  background: rgba(8,8,20,0.97);',
        '  backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);',
        '  border: 1px solid rgba(255,255,255,0.08);',
        '  border-radius: 20px; padding: 24px;',
        '  font-family: system-ui, -apple-system, sans-serif; color: #f8fafc;',
        '  box-shadow: 0 40px 100px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04); }',
        '#vr-load-panel.hidden { display: none; }',

        /* パネルヘッダー行 */
        '#vr-panel-header {',
        '  display: flex; align-items: center; justify-content: space-between;',
        '  margin-bottom: 20px; }',
        '#vr-panel-header h2 {',
        '  font-size: 15.5px; font-weight: 600; letter-spacing: -0.3px; }',
        '#vr-panel-close {',
        '  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;',
        '  border: none; background: rgba(255,255,255,0.07);',
        '  color: rgba(248,250,252,0.45); font-size: 15px; cursor: pointer;',
        '  display: flex; align-items: center; justify-content: center;',
        '  transition: all 0.15s; line-height: 1; padding-bottom: 1px; }',
        '#vr-panel-close:hover { background: rgba(255,255,255,0.14); color: #f8fafc; }',

        /* タブ（セグメントコントロール） */
        '#vr-tabs {',
        '  display: flex; gap: 2px; margin-bottom: 18px;',
        '  background: rgba(255,255,255,0.05); border-radius: 10px; padding: 3px; }',
        '.vr-tab {',
        '  flex: 1; padding: 7px 10px; font-size: 12.5px; font-weight: 500;',
        '  cursor: pointer; color: rgba(248,250,252,0.4);',
        '  border-radius: 8px; text-align: center; transition: all 0.15s; }',
        '.vr-tab.active { background: rgba(255,255,255,0.1); color: #f8fafc; }',
        '.vr-tab-content { display: none; }',
        '.vr-tab-content.active { display: block; }',

        /* URL フォーム */
        '#vr-url-form { display: flex; flex-direction: column; gap: 10px; }',
        '#vr-url-input {',
        '  width: 100%; padding: 11px 14px;',
        '  background: rgba(255,255,255,0.05);',
        '  border: 1px solid rgba(255,255,255,0.1);',
        '  border-radius: 10px; color: #f8fafc; font-size: 13px;',
        '  outline: none; transition: all 0.15s;',
        '  font-family: system-ui, -apple-system, sans-serif; }',
        '#vr-url-input:focus {',
        '  border-color: rgba(99,102,241,0.6);',
        '  background: rgba(99,102,241,0.05);',
        '  box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }',
        '#vr-url-input::placeholder { color: rgba(248,250,252,0.25); }',
        '#vr-load-url-btn {',
        '  padding: 11px; width: 100%;',
        '  background: linear-gradient(135deg,#6366f1,#4f46e5);',
        '  border: none; border-radius: 10px;',
        '  color: #fff; font-size: 13.5px; font-weight: 600;',
        '  cursor: pointer; transition: all 0.15s;',
        '  box-shadow: 0 4px 18px rgba(99,102,241,0.32);',
        '  font-family: system-ui, -apple-system, sans-serif; letter-spacing: 0.1px; }',
        '#vr-load-url-btn:hover {',
        '  background: linear-gradient(135deg,#818cf8,#6366f1);',
        '  box-shadow: 0 6px 26px rgba(99,102,241,0.48);',
        '  transform: translateY(-1px); }',
        '#vr-load-url-btn:active { transform: translateY(0); }',
        '.vr-url-hint {',
        '  font-size: 11px; color: rgba(248,250,252,0.3); line-height: 1.65;',
        '  padding: 10px 12px; border-radius: 8px;',
        '  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); }',
        '.vr-url-hint a { color: rgba(129,140,248,0.85); text-decoration: none; }',
        '.vr-url-hint code {',
        '  font-size: 10px; background: rgba(255,255,255,0.07);',
        '  padding: 1px 5px; border-radius: 4px; word-break: break-all; }',

        /* ドロップゾーン */
        '#vr-dropzone {',
        '  border: 1.5px dashed rgba(255,255,255,0.1);',
        '  border-radius: 12px; padding: 36px 20px;',
        '  text-align: center; cursor: pointer;',
        '  transition: all 0.2s; color: rgba(248,250,252,0.38);',
        '  font-size: 13px; background: rgba(255,255,255,0.02); }',
        '#vr-dropzone:hover, #vr-dropzone.dragover {',
        '  border-color: rgba(99,102,241,0.5);',
        '  background: rgba(99,102,241,0.06); color: #f8fafc; }',
        '#vr-dropzone .drop-icon { font-size: 26px; margin-bottom: 10px; display: block; opacity: 0.6; }',
        '#vr-dropzone .drop-sub { font-size: 11px; margin-top: 5px; opacity: 0.55; }',

        /* LCC フォルダ読み込みセクション */
        '#vr-lcc-section { margin-top: 14px; }',
        '#vr-lcc-divider {',
        '  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;',
        '  color: rgba(248,250,252,0.2); font-size: 11px; }',
        '#vr-lcc-divider::before, #vr-lcc-divider::after {',
        '  content: ""; flex: 1;',
        '  border-top: 1px solid rgba(255,255,255,0.07); }',
        '#vr-lcc-btn {',
        '  width: 100%; padding: 10px;',
        '  background: rgba(139,92,246,0.1);',
        '  border: 1px dashed rgba(139,92,246,0.35);',
        '  border-radius: 10px;',
        '  color: rgba(196,181,253,0.85); font-size: 13px; font-weight: 500;',
        '  cursor: pointer; transition: all 0.15s;',
        '  font-family: system-ui, sans-serif; }',
        '#vr-lcc-btn:hover {',
        '  background: rgba(139,92,246,0.18);',
        '  border-color: rgba(139,92,246,0.6); color: #fff; }',
        '#vr-lcc-hint {',
        '  margin-top: 8px; font-size: 11px;',
        '  color: rgba(248,250,252,0.25); line-height: 1.6; }',

        /* スピナー */
        '#vr-loading {',
        '  position: fixed; inset: 0; z-index: 200;',
        '  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;',
        '  background: rgba(4,4,12,0.88); backdrop-filter: blur(10px);',
        '  color: rgba(248,250,252,0.85); font-family: system-ui, sans-serif;',
        '  font-size: 13px; letter-spacing: 0.2px; }',
        '#vr-loading.hidden { display: none; }',
        '.vr-spinner {',
        '  width: 34px; height: 34px;',
        '  border: 2.5px solid rgba(255,255,255,0.08);',
        '  border-top-color: #6366f1; border-radius: 50%;',
        '  animation: vr-spin 0.7s linear infinite; }',
        '@keyframes vr-spin { to { transform: rotate(360deg); } }',

        /* トースト */
        '#vr-toast-container {',
        '  position: fixed; top: 58px; right: 16px; z-index: 300;',
        '  display: flex; flex-direction: column; gap: 8px; pointer-events: none; }',
        '.vr-toast {',
        '  padding: 11px 16px; border-radius: 10px;',
        '  background: rgba(220,38,38,0.92); backdrop-filter: blur(12px);',
        '  color: #fff; font-family: system-ui, sans-serif;',
        '  font-size: 13px; max-width: 300px; line-height: 1.5;',
        '  box-shadow: 0 8px 28px rgba(0,0,0,0.35);',
        '  animation: vr-ti 0.2s ease, vr-to 0.35s ease 3.65s forwards; }',
        '.vr-toast--info { background: rgba(99,102,241,0.92); }',
        '@keyframes vr-ti { from { opacity:0; transform: translateX(14px); } to { opacity:1; transform: none; } }',
        '@keyframes vr-to { from { opacity:1; } to { opacity:0; transform: translateX(14px); } }',

        /* 操作説明 */
        '#vr-help-overlay {',
        '  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);',
        '  z-index: 110; white-space: nowrap;',
        '  padding: 12px 20px; border-radius: 14px;',
        '  background: rgba(6,6,18,0.92);',
        '  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);',
        '  border: 1px solid rgba(255,255,255,0.07);',
        '  box-shadow: 0 8px 36px rgba(0,0,0,0.5);',
        '  color: rgba(248,250,252,0.65); font-family: system-ui, sans-serif;',
        '  font-size: 11.5px; line-height: 1.85; pointer-events: none;',
        '  transition: opacity 0.5s; }',
        '#vr-help-overlay.fade-out { opacity: 0; }',
        '#vr-help-overlay.hidden { display: none; }',
        '#vr-help-overlay table { border-collapse: collapse; }',
        '#vr-help-overlay td { padding: 0 12px 0 0; }',
        '#vr-help-overlay td:first-child {',
        '  color: rgba(129,140,248,0.9); font-weight: 600;',
        '  font-size: 10.5px; letter-spacing: 0.4px; text-transform: uppercase; }',

        /* ヘルプボタン */
        '#vr-help-btn {',
        '  position: fixed; bottom: 20px; right: 20px; z-index: 120;',
        '  width: 30px; height: 30px; border-radius: 50%;',
        '  background: rgba(6,6,18,0.88);',
        '  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
        '  border: 1px solid rgba(255,255,255,0.1);',
        '  color: rgba(248,250,252,0.5); font-size: 13px; font-weight: 700;',
        '  cursor: pointer; display: flex; align-items: center; justify-content: center;',
        '  transition: all 0.15s; }',
        '#vr-help-btn:hover {',
        '  background: rgba(99,102,241,0.28);',
        '  border-color: rgba(99,102,241,0.45); color: #f8fafc; }',

        /* シェアボタン */
        '#vr-share-btn.hidden { display: none; }',
        '#vr-share-btn {',
        '  background: rgba(16,185,129,0.12);',
        '  border-color: rgba(16,185,129,0.28); color: rgba(167,243,208,0.9); }',
        '#vr-share-btn:hover {',
        '  background: rgba(16,185,129,0.22);',
        '  border-color: rgba(16,185,129,0.5); color: #fff; }',
        '#vr-share-btn.copied {',
        '  background: rgba(16,185,129,0.28);',
        '  border-color: rgba(16,185,129,0.6); color: #fff; }',

        /* フルスクリーンボタン */
        '#vr-fullscreen-btn { padding: 5px 9px; min-width: 0; letter-spacing: 0; }',

        /* エンプティステート */
        '#vr-empty-state {',
        '  position: fixed; inset: 0; z-index: 50;',
        '  display: flex; flex-direction: column;',
        '  align-items: center; justify-content: center; gap: 10px;',
        '  font-family: system-ui, -apple-system, sans-serif;',
        '  pointer-events: none; }',
        '#vr-empty-state.hidden { display: none; }',
        '.vr-empty-title {',
        '  font-size: 16px; font-weight: 600; letter-spacing: -0.3px;',
        '  color: rgba(248,250,252,0.28); }',
        '.vr-empty-sub {',
        '  font-size: 12px; color: rgba(248,250,252,0.16); }',

        /* モバイル: タッチターゲット拡大 + iOS自動ズーム防止 */
        '@media (hover: none) and (pointer: coarse) {',
        '  .vr-btn { padding: 8px 16px; min-height: 42px; }',
        '  #vr-fullscreen-btn { padding: 8px 12px; }',
        '  #vr-url-input { padding: 13px 14px; font-size: 16px; }',
        '  #vr-load-url-btn { padding: 14px; }',
        '  #vr-dropzone { padding: 44px 20px; } }',
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
    var _elLCCInput    = null;

    var _elShareBtn   = null;
    var _elEmptyState = null;
    var _elTitleEl    = null;

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

    function triggerLCCLoad(files) {
        if (!files || files.length === 0) return;
        if (_callbacks.onLCCLoaded) _callbacks.onLCCLoaded(files);
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

            var openBtn = el('button', { className: 'vr-btn vr-btn--primary', textContent: 'シーンを開く' });
            openBtn.addEventListener('click', function () {
                if (_elPanel) _elPanel.classList.toggle('hidden');
            });

            _elVRBtn = el('button', { className: 'vr-btn', textContent: 'VR', disabled: 'disabled' });
            _elVRBtn.addEventListener('click', function () {
                if (!_elVRBtn.disabled && _callbacks.onVRRequested) _callbacks.onVRRequested();
            });

            _elShareBtn = el('button', { id: 'vr-share-btn', className: 'vr-btn hidden', textContent: 'URLをコピー' });
            _elShareBtn.addEventListener('click', function () {
                navigator.clipboard.writeText(window.location.href).then(function () {
                    _elShareBtn.textContent = 'コピー完了!';
                    _elShareBtn.classList.add('copied');
                    setTimeout(function () {
                        _elShareBtn.textContent = 'URLをコピー';
                        _elShareBtn.classList.remove('copied');
                    }, 2000);
                }).catch(function () {
                    window.UI.showError('クリップボードへのコピーに失敗しました');
                });
            });

            var fsBtn = el('button', { id: 'vr-fullscreen-btn', className: 'vr-btn', title: 'フルスクリーン', textContent: '全画面' });
            fsBtn.addEventListener('click', function () {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(function () {});
                } else {
                    document.exitFullscreen().catch(function () {});
                }
            });

            _elTitleEl = el('h1', { textContent: 'VR 内見ビューア' });

            root.appendChild(el('div', { id: 'vr-header' }, [
                _elTitleEl,
                fileInput, openBtn, _elShareBtn, _elVRBtn, fsBtn,
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

            // LCC フォルダ読み込みセクション
            _elLCCInput = el('input', { type: 'file', style: 'display:none' });
            _elLCCInput.setAttribute('webkitdirectory', '');
            _elLCCInput.setAttribute('multiple', '');
            _elLCCInput.addEventListener('change', function () {
                if (_elLCCInput.files.length > 0) triggerLCCLoad(_elLCCInput.files);
                _elLCCInput.value = '';
            });

            var lccBtn = el('button', { id: 'vr-lcc-btn', textContent: 'LCC フォルダを開く (portalcam)' });
            lccBtn.addEventListener('click', function () { _elLCCInput.click(); });

            paneFile.appendChild(el('div', { id: 'vr-lcc-section' }, [
                el('div', { id: 'vr-lcc-divider', textContent: 'または LCC 形式' }),
                _elLCCInput,
                lccBtn,
                el('div', { id: 'vr-lcc-hint',
                    textContent: 'LCC フォルダ（*.lcc / data.bin を含む）を選択してください。旧形式（meta.lcc / Data.bin）も対応しています。'
                }),
            ]));

            // canvas 全体にもドロップ対応（app が null の場合は document.body に対して設定）
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
            _elLoadingMsg = el('div', { textContent: '読み込み中...' });
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
                '<tr><td>W/A/S/D</td><td>前後左右移動</td></tr>',
                '<tr><td>Space</td><td>上昇</td></tr>',
                '<tr><td>Ctrl</td><td>下降</td></tr>',
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
                el('div', { className: 'vr-empty-title', textContent: '3D シーンが読み込まれていません' }),
                el('div', { className: 'vr-empty-sub', textContent: '上の「シーンを開く」からファイルまたは URL を読み込んでください' }),
            ]);
            root.appendChild(_elEmptyState);

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

        setTitle: function (title) {
            if (_elTitleEl) _elTitleEl.textContent = title;
        },

        hideEmptyState: function () {
            if (_elEmptyState) _elEmptyState.classList.add('hidden');
        },

        showShareButton: function () {
            if (_elShareBtn) _elShareBtn.classList.remove('hidden');
        },
    };
}());
