/**
 * ui.js — VR 内見ビューア UI モジュール（プロダクション版）
 * ローディング表示・エラートースト・操作説明のみ
 */
window.UI = (function () {
    'use strict';

    var CSS = [
        '#vr-naiken-ui *, #vr-naiken-ui *::before, #vr-naiken-ui *::after {',
        '  box-sizing: border-box; margin: 0; padding: 0; }',

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

        '#vr-loading-msg {',
        '  color: rgba(240,244,248,0.65);',
        '  font-size: 12.5px; max-width: 280px; text-align: center; line-height: 1.6; }',

        /* トースト */
        '#vr-toast-container {',
        '  position: fixed; top: 16px; right: 16px; z-index: 300;',
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

        /* 上下移動ボタン */
        '#vr-move-btns {',
        '  position: fixed; bottom: 20px; right: 60px; z-index: 120;',
        '  display: flex; flex-direction: column; gap: 8px; }',
        '.vr-move-btn {',
        '  width: 48px; height: 48px; border-radius: 50%;',
        '  background: rgba(0,4,12,0.85);',
        '  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
        '  border: 1px solid rgba(0,212,170,0.2);',
        '  color: rgba(0,212,170,0.7); font-size: 20px; line-height: 1;',
        '  cursor: pointer; display: flex; align-items: center; justify-content: center;',
        '  user-select: none; -webkit-user-select: none; touch-action: none;',
        '  transition: background 0.1s, border-color 0.1s, color 0.1s; }',
        '.vr-move-btn.pressed {',
        '  background: rgba(0,212,170,0.18);',
        '  border-color: rgba(0,212,170,0.55); color: #00D4AA; }',

        /* ステータスバー */
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
    ].join('\n');

    var _elLoading     = null;
    var _elLoadingMsg  = null;
    var _elToastCont   = null;
    var _elHelpOverlay = null;
    var _helpTimer     = null;
    var _elStatusBar   = null;
    var _callbacks     = {};

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

    return {
        init: function (app, callbacks) {
            _callbacks = callbacks || {};

            var style = document.createElement('style');
            style.textContent = CSS;
            document.head.appendChild(style);

            var root = el('div', { id: 'vr-naiken-ui' });
            document.body.appendChild(root);

            // スピナー
            _elLoadingMsg = el('div', { id: 'vr-loading-msg', textContent: '読み込み中...' });
            _elLoading = el('div', { id: 'vr-loading', className: 'hidden' }, [
                el('div', { className: 'vr-spinner' }),
                _elLoadingMsg,
            ]);
            root.appendChild(_elLoading);

            // トースト
            _elToastCont = el('div', { id: 'vr-toast-container' });
            root.appendChild(_elToastCont);

            // 操作説明
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

            // 上下移動ボタン
            var btnUp   = el('button', { className: 'vr-move-btn', title: '上昇', textContent: '↑' });
            var btnDown = el('button', { className: 'vr-move-btn', title: '下降', textContent: '↓' });
            root.appendChild(el('div', { id: 'vr-move-btns' }, [btnUp, btnDown]));

            function bindMoveBtn(btn, dir) {
                function start(e) {
                    e.preventDefault();
                    btn.classList.add('pressed');
                    if (window.CameraController) CameraController.setVertical(dir);
                }
                function end(e) {
                    e.preventDefault();
                    btn.classList.remove('pressed');
                    if (window.CameraController) CameraController.setVertical(0);
                }
                btn.addEventListener('touchstart',  start, { passive: false });
                btn.addEventListener('touchend',    end,   { passive: false });
                btn.addEventListener('touchcancel', end,   { passive: false });
                btn.addEventListener('mousedown',   start);
                btn.addEventListener('mouseup',     end);
                btn.addEventListener('mouseleave',  end);
            }
            bindMoveBtn(btnUp,   1);
            bindMoveBtn(btnDown, -1);

            // ステータスバー
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

        showStatus: function (msg) {
            if (!_elStatusBar) return;
            _elStatusBar.textContent = msg;
            _elStatusBar.classList.remove('hidden');
        },

        hideStatus: function () {
            if (_elStatusBar) _elStatusBar.classList.add('hidden');
        },

        showHelp:         function ()    { showHelp(); },
        showTooltip:      function (msg) { this.showInfo(msg); },
        updateCallbacks:  function (cb)  { Object.assign(_callbacks, cb); },

        // 以下はプロダクション版では非表示（互換性のためスタブとして残す）
        setTitle:         function () {},
        hideEmptyState:   function () {},
        showShareButton:  function () {},
        showColliderBtn:  function () {},
        showPanel:        function () {},
        setVRButtonState: function () {},
    };
}());
