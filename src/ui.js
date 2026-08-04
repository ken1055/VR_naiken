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
        '  position: fixed; inset: 0; z-index: 260;',
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

        /* トースト（場所メニューのボタンと重ならないよう少し下から表示）*/
        '#vr-toast-container {',
        '  position: fixed; top: 68px; right: 16px; z-index: 300;',
        '  display: flex; flex-direction: column; gap: 8px; pointer-events: none; }',
        /* #vr-naiken-ui * リセットに負けないよう親 ID を付ける（padding が効かなくなる）*/
        '#vr-toast-container .vr-toast {',
        '  padding: 12px 18px; border-radius: 12px;',
        '  background: rgba(220,50,50,0.94);',
        '  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
        '  border: 1px solid rgba(255,100,100,0.2);',
        '  color: #fff; font-family: system-ui, sans-serif;',
        '  font-size: 13px; max-width: 320px; line-height: 1.5;',
        '  box-shadow: 0 8px 32px rgba(0,0,0,0.4);',
        '  animation: vr-ti 0.22s ease, vr-to 0.35s ease 3.65s forwards; }',
        '#vr-toast-container .vr-toast--info {',
        '  background: rgba(0,40,32,0.96);',
        '  border-color: rgba(0,212,170,0.25); color: #00D4AA; }',
        '@keyframes vr-ti { from { opacity:0; transform: translateX(16px); } to { opacity:1; transform: none; } }',
        '@keyframes vr-to { from { opacity:1; } to { opacity:0; transform: translateX(16px); } }',

        /* 操作説明 */
        '#vr-help-overlay {',
        '  position: fixed; top: 20px; left: 50%; transform: translateX(-50%);',
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

        /* 初期位置に戻るボタン（ヘルプボタンの上に重ねて配置）*/
        '#vr-home-btn {',
        '  position: fixed; bottom: 60px; right: 20px; z-index: 120;',
        '  width: 32px; height: 32px; border-radius: 50%;',
        '  background: rgba(0,4,12,0.9);',
        '  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
        '  border: 1px solid rgba(0,212,170,0.15);',
        '  color: rgba(0,212,170,0.55);',
        '  cursor: pointer; display: flex; align-items: center; justify-content: center;',
        '  transition: all 0.15s; }',
        '#vr-home-btn:hover {',
        '  background: rgba(0,212,170,0.12);',
        '  border-color: rgba(0,212,170,0.4); color: #00D4AA; }',
        '#vr-home-btn svg { width: 16px; height: 16px; display: block; }',

        /* バーチャルジョイスティック */
        '#vr-joystick-base {',
        '  position: fixed; left: 32px; bottom: 60px; z-index: 120;',
        '  width: 110px; height: 110px; border-radius: 50%;',
        '  background: rgba(0,4,12,0.55);',
        '  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);',
        '  border: 2px solid rgba(0,212,170,0.2);',
        '  touch-action: none; }',
        '#vr-joystick-knob {',
        '  position: absolute; width: 48px; height: 48px; border-radius: 50%;',
        '  top: 50%; left: 50%; transform: translate(-50%, -50%);',
        '  background: rgba(0,212,170,0.35);',
        '  border: 2px solid rgba(0,212,170,0.75);',
        '  pointer-events: none;',
        '  transition: transform 0.05s; }',

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

        /* テレポート導線は「〇〇へ移動」ボタン 1 つに統一する
           （場所名ラベルとボタンが縦に並ぶと、どちらが押せるのか分からないため）*/
        '#vr-teleport-prompt {',
        '  position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);',
        '  z-index: 130; display: flex; align-items: center;',
        '  transition: opacity 0.3s; white-space: nowrap; }',
        '#vr-teleport-prompt.hidden { display: none; }',
        '#vr-teleport-btn {',
        '  padding: 12px 30px; border-radius: 99px;',
        '  background: rgba(0,212,170,0.16);',
        '  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
        '  border: 1.5px solid rgba(0,212,170,0.5);',
        '  color: #00D4AA; font-size: 14px; font-weight: 700;',
        '  max-width: 78vw; overflow: hidden; text-overflow: ellipsis;',
        '  box-shadow: 0 6px 24px rgba(0,0,0,0.45);',
        '  cursor: pointer; font-family: system-ui, sans-serif; transition: all 0.15s; }',
        '#vr-teleport-btn:hover {',
        '  background: rgba(0,212,170,0.26); border-color: rgba(0,212,170,0.8); }',

        '#vr-fade-overlay {',
        '  position: fixed; inset: 0; z-index: 250; background: #000;',
        '  opacity: 0; pointer-events: none; transition: opacity 0.4s; }',
        '#vr-fade-overlay.active { opacity: 1; pointer-events: all; }',

        /* 360度モード用「元の部屋に戻る」ボタン */
        '#vr-back-btn {',
        '  position: fixed; top: 20px; left: 20px; z-index: 130;',
        '  padding: 10px 20px; border-radius: 99px;',
        '  background: rgba(0,4,12,0.92);',
        '  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
        '  border: 1.5px solid rgba(0,212,170,0.45);',
        '  color: #00D4AA; font-size: 13px; font-weight: 700;',
        '  cursor: pointer; font-family: system-ui, sans-serif; transition: all 0.15s;',
        '  display: flex; align-items: center; gap: 6px; }',
        '#vr-back-btn:hover {',
        '  background: rgba(0,212,170,0.18); border-color: rgba(0,212,170,0.75); }',
        '#vr-back-btn.hidden { display: none; }',

        /* 場所一覧メニュー（右上ハンバーガー）*/
        '#vr-places-btn {',
        '  position: fixed; top: 20px; right: 20px; z-index: 140;',
        '  width: 40px; height: 40px; border-radius: 12px;',
        '  background: rgba(0,4,12,0.9);',
        '  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
        '  border: 1px solid rgba(0,212,170,0.25);',
        '  color: rgba(0,212,170,0.8); cursor: pointer;',
        '  display: none; align-items: center; justify-content: center;',
        '  transition: all 0.15s; }',
        '#vr-places-btn.visible { display: flex; }',
        '#vr-places-btn:hover, #vr-places-btn.open {',
        '  background: rgba(0,212,170,0.12);',
        '  border-color: rgba(0,212,170,0.5); color: #00D4AA; }',
        '#vr-places-btn svg { width: 20px; height: 20px; display: block; }',

        '#vr-places-panel {',
        '  position: fixed; top: 68px; right: 20px; z-index: 140;',
        '  min-width: 190px; max-width: 280px; max-height: 60vh; overflow-y: auto;',
        '  padding: 8px; border-radius: 14px;',
        '  background: rgba(0,4,12,0.94);',
        '  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);',
        '  border: 1px solid rgba(0,212,170,0.2);',
        '  box-shadow: 0 8px 40px rgba(0,0,0,0.5);',
        '  display: none; flex-direction: column; gap: 2px; }',
        '#vr-places-panel.open { display: flex; }',
        '#vr-places-title {',
        '  padding: 6px 12px 8px; font-size: 10.5px; font-weight: 700;',
        '  color: rgba(0,212,170,0.55); letter-spacing: 0.5px;',
        '  font-family: system-ui, sans-serif; }',
        /* 先頭の #vr-naiken-ui * リセット（ID込みで特異性が高い）に負けないよう ID を付ける */
        '#vr-places-panel .vr-place-item {',
        '  padding: 10px 12px; border-radius: 9px; border: none; text-align: left;',
        '  background: transparent; color: rgba(240,244,248,0.85);',
        '  font-size: 13px; font-family: system-ui, sans-serif; cursor: pointer;',
        '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
        '  transition: background 0.12s, color 0.12s; }',
        '#vr-places-panel .vr-place-item:hover {',
        '  background: rgba(0,212,170,0.12); color: #00D4AA; }',

        /* パノラマモード中は移動UIを隠す */
        'body.pano-mode #vr-joystick-base,',
        'body.pano-mode #vr-move-btns,',
        'body.pano-mode #vr-home-btn,',
        'body.pano-mode #vr-help-overlay { display: none !important; }',

        /* ウォークモード中は上下移動ボタンを隠す（高さは床に固定追従）*/
        'body.walk-mode #vr-move-btns { display: none !important; }',

        /* スマホ: 「〇〇へ移動」ボタンがジョイスティック（left 32 / bottom 60 / 110px 角、
           上端は下から 170px）に重なるため、その上へ逃がす。
           ジョイスティックを出さないパノラマモードでは元の高さのままにする。*/
        '@media (hover: none) and (pointer: coarse) {',
        '  body:not(.pano-mode) #vr-teleport-prompt { bottom: 186px; }',
        '}',
    ].join('\n');

    var _elLoading     = null;
    var _elLoadingMsg  = null;
    var _elToastCont   = null;
    var _elHelpOverlay = null;
    var _helpTimer     = null;
    var _elStatusBar      = null;
    var _elTeleportPrompt = null;
    var _elTeleportBtn    = null;
    var _elFadeOverlay    = null;
    var _teleportClick    = null;
    var _elBackBtn        = null;
    var _backClick        = null;
    var _elPlacesBtn      = null;
    var _elPlacesPanel    = null;
    var _callbacks        = {};

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

    function _togglePlacesPanel(force) {
        if (!_elPlacesPanel) return;
        var open = (force !== undefined) ? !!force : !_elPlacesPanel.classList.contains('open');
        _elPlacesPanel.classList.toggle('open', open);
        if (_elPlacesBtn) _elPlacesBtn.classList.toggle('open', open);
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
                '<tr><td>左ジョイスティック</td><td>前後左右移動</td></tr>',
                '<tr><td>画面ドラッグ</td><td>視点回転（移動と同時に可）</td></tr>',
                '<tr><td>↑ / ↓ ボタン</td><td>上昇・下降</td></tr>',
            ] : [
                '<tr><td>左右ドラッグ</td><td>視点回転</td></tr>',
                '<tr><td>W / A / S / D</td><td>前後左右移動</td></tr>',
                '<tr><td>Q</td><td>上昇</td></tr>',
                '<tr><td>E</td><td>下降</td></tr>',
                '<tr><td>ホイール</td><td>移動速度変更</td></tr>',
            ];
            _elHelpOverlay = el('div', { id: 'vr-help-overlay',
                innerHTML: '<table>' + _helpRows.join('') + '</table>' });
            root.appendChild(_elHelpOverlay);

            var helpBtn = el('button', { id: 'vr-help-btn', title: '操作説明', textContent: '?' });
            helpBtn.addEventListener('click', showHelp);
            root.appendChild(helpBtn);

            // 初期位置に戻るボタン（家アイコン）
            var homeBtn = el('button', { id: 'vr-home-btn', title: '初期位置に戻る',
                innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
                    '<polyline points="9 22 9 12 15 12 15 22"/></svg>' });
            homeBtn.addEventListener('click', function () {
                if (window.CameraController && CameraController.resetToHome) {
                    CameraController.resetToHome();
                    if (window.UI && UI.showInfo) UI.showInfo('初期位置に戻りました');
                }
            });
            root.appendChild(homeBtn);

            // スマホのみ: バーチャルジョイスティック + 上下ボタン
            if (_isTouchDevice) {
                var joyBase = el('div', { id: 'vr-joystick-base' });
                var joyKnob = el('div', { id: 'vr-joystick-knob' });
                joyBase.appendChild(joyKnob);
                root.appendChild(joyBase);

                var _joyActive = false;
                var _joyTouchId = null;
                var _joyCx = 0, _joyCy = 0;
                var JOY_MAX = 32;

                joyBase.addEventListener('touchstart', function (e) {
                    e.preventDefault();
                    if (_joyActive) return;
                    var t = e.changedTouches[0];
                    _joyActive  = true;
                    _joyTouchId = t.identifier;
                    var r = joyBase.getBoundingClientRect();
                    _joyCx = r.left + r.width  / 2;
                    _joyCy = r.top  + r.height / 2;
                }, { passive: false });

                joyBase.addEventListener('touchmove', function (e) {
                    e.preventDefault();
                    var t = null;
                    for (var i = 0; i < e.changedTouches.length; i++) {
                        if (e.changedTouches[i].identifier === _joyTouchId) {
                            t = e.changedTouches[i]; break;
                        }
                    }
                    if (!t) return;
                    var dx   = t.clientX - _joyCx;
                    var dy   = t.clientY - _joyCy;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    var clamped = Math.min(dist, JOY_MAX);
                    var ang  = Math.atan2(dy, dx);
                    var kx   = Math.cos(ang) * clamped;
                    var ky   = Math.sin(ang) * clamped;
                    joyKnob.style.transform =
                        'translate(calc(-50% + ' + kx + 'px), calc(-50% + ' + ky + 'px))';
                    var nx = dist > 1 ? Math.max(-1, Math.min(1, dx / JOY_MAX)) : 0;
                    var ny = dist > 1 ? Math.max(-1, Math.min(1, dy / JOY_MAX)) : 0;
                    if (window.CameraController) CameraController.setJoystick(nx, ny);
                }, { passive: false });

                function joyEnd(e) {
                    e.preventDefault();
                    _joyActive  = false;
                    _joyTouchId = null;
                    joyKnob.style.transform = 'translate(-50%, -50%)';
                    if (window.CameraController) CameraController.setJoystick(0, 0);
                }
                joyBase.addEventListener('touchend',    joyEnd, { passive: false });
                joyBase.addEventListener('touchcancel', joyEnd, { passive: false });

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
                }
                bindMoveBtn(btnUp,   1);
                bindMoveBtn(btnDown, -1);
            }

            // ステータスバー
            _elStatusBar = el('div', { id: 'vr-status-bar', className: 'hidden' });
            root.appendChild(_elStatusBar);

            // テレポートプロンプト（「〇〇へ移動」ボタン 1 つ）
            _elTeleportBtn    = el('button', { id: 'vr-teleport-btn', textContent: 'ここへ移動' });
            _elTeleportPrompt = el('div', { id: 'vr-teleport-prompt', className: 'hidden' },
                [_elTeleportBtn]);
            _elTeleportBtn.addEventListener('click', function () {
                if (_teleportClick) _teleportClick();
            });
            root.appendChild(_elTeleportPrompt);

            // フェードオーバーレイ
            _elFadeOverlay = el('div', { id: 'vr-fade-overlay' });
            root.appendChild(_elFadeOverlay);

            // 「元の部屋に戻る」ボタン (360度画像表示時のみ可視化)
            _elBackBtn = el('button', { id: 'vr-back-btn', className: 'hidden',
                innerHTML: '<span style="font-size:15px;line-height:1;">←</span> 元の部屋に戻る' });
            _elBackBtn.addEventListener('click', function () {
                if (_backClick) _backClick();
            });
            root.appendChild(_elBackBtn);

            // 場所一覧メニュー（テレポートポイントのあるシーンでのみ表示）
            _elPlacesBtn = el('button', { id: 'vr-places-btn', title: '場所一覧',
                innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2" stroke-linecap="round">' +
                    '<line x1="4" y1="6" x2="20" y2="6"/>' +
                    '<line x1="4" y1="12" x2="20" y2="12"/>' +
                    '<line x1="4" y1="18" x2="20" y2="18"/></svg>' });
            _elPlacesPanel = el('div', { id: 'vr-places-panel' });
            _elPlacesBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                _togglePlacesPanel();
            });
            // パネル外タップで閉じる
            document.addEventListener('pointerdown', function (e) {
                if (!_elPlacesPanel.classList.contains('open')) return;
                if (_elPlacesPanel.contains(e.target) || _elPlacesBtn.contains(e.target)) return;
                _togglePlacesPanel(false);
            });
            root.appendChild(_elPlacesBtn);
            root.appendChild(_elPlacesPanel);

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

        setTeleportPrompt: function (point, onClick) {
            if (!_elTeleportPrompt) return;
            if (!point) {
                _elTeleportPrompt.classList.add('hidden');
                _teleportClick = null;
                return;
            }
            // 場所名をボタン文言に埋め込む（例: 「浴室へ移動」）。
            // 既存シーンのラベルは「トイレへ」のように助詞付きで保存されているため、
            // 末尾の「へ」「に」を落としてから繋ぐ（「トイレへへ移動」を防ぐ）。
            // すでに「〜移動」で終わるラベルはそのまま使う。
            var label = (point.label || '').trim();
            if (!label) {
                _elTeleportBtn.textContent = 'ここへ移動';
            } else if (/移動$/.test(label)) {
                _elTeleportBtn.textContent = label;
            } else {
                _elTeleportBtn.textContent = label.replace(/[へに]$/, '') + 'へ移動';
            }
            _teleportClick = onClick;
            _elTeleportPrompt.classList.remove('hidden');
        },

        showFade: function () {
            if (_elFadeOverlay) _elFadeOverlay.classList.add('active');
        },

        hideFade: function () {
            if (_elFadeOverlay) _elFadeOverlay.classList.remove('active');
        },

        showHelp:         function ()    { showHelp(); },
        showTooltip:      function (msg) { this.showInfo(msg); },
        updateCallbacks:  function (cb)  { Object.assign(_callbacks, cb); },

        /**
         * 360度モード ON/OFF。ON のときは移動UIを隠す。
         */
        setPanoMode: function (on) {
            if (on) document.body.classList.add('pano-mode');
            else    document.body.classList.remove('pano-mode');
        },

        /**
         * ウォークモード ON/OFF。上下移動ボタンを隠し、操作説明から上下移動の行を除く。
         */
        setWalkMode: function (on) {
            if (on) document.body.classList.add('walk-mode');
            else    document.body.classList.remove('walk-mode');
            if (!_elHelpOverlay) return;
            var touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
            var rows;
            if (touch) {
                rows = [
                    '<tr><td>左ジョイスティック</td><td>前後左右移動</td></tr>',
                    '<tr><td>画面ドラッグ</td><td>視点回転（移動と同時に可）</td></tr>',
                ];
                if (!on) rows.push('<tr><td>↑ / ↓ ボタン</td><td>上昇・下降</td></tr>');
            } else {
                rows = [
                    '<tr><td>左右ドラッグ</td><td>視点回転</td></tr>',
                    '<tr><td>W / A / S / D</td><td>前後左右移動</td></tr>',
                ];
                if (!on) {
                    rows.push('<tr><td>Q</td><td>上昇</td></tr>');
                    rows.push('<tr><td>E</td><td>下降</td></tr>');
                }
                rows.push('<tr><td>ホイール</td><td>移動速度変更</td></tr>');
            }
            _elHelpOverlay.innerHTML = '<table>' + rows.join('') + '</table>';
        },

        /**
         * 場所一覧メニュー（右上ハンバーガー）の内容を設定する。
         * @param {Array|null} points   テレポートポイント配列。空 / null でボタンごと非表示
         * @param {Function}   onSelect (point) => void 項目選択時に呼ばれる
         */
        setPlacesMenu: function (points, onSelect) {
            if (!_elPlacesBtn || !_elPlacesPanel) return;
            _togglePlacesPanel(false);
            _elPlacesPanel.innerHTML = '';
            if (!points || !points.length) {
                _elPlacesBtn.classList.remove('visible');
                return;
            }
            _elPlacesPanel.appendChild(
                el('div', { id: 'vr-places-title', textContent: '場所を選択' }));
            points.forEach(function (pt, i) {
                var item = el('button', { className: 'vr-place-item',
                    textContent: pt.label || ('場所 ' + (i + 1)) });
                item.addEventListener('click', function () {
                    _togglePlacesPanel(false);
                    if (onSelect) onSelect(pt);
                });
                _elPlacesPanel.appendChild(item);
            });
            _elPlacesBtn.classList.add('visible');
        },

        /**
         * 「元の部屋に戻る」ボタンの表示制御
         * @param {Function|null} onClick  null で非表示
         * @param {string}        [label]  ボタン文言を上書き
         */
        setBackButton: function (onClick, label) {
            if (!_elBackBtn) return;
            if (!onClick) {
                _elBackBtn.classList.add('hidden');
                _backClick = null;
                return;
            }
            if (label) {
                _elBackBtn.innerHTML = '<span style="font-size:15px;line-height:1;">←</span> ' + label;
            }
            _backClick = onClick;
            _elBackBtn.classList.remove('hidden');
        },

        // 以下はプロダクション版では非表示（互換性のためスタブとして残す）
        setTitle:         function () {},
        hideEmptyState:   function () {},
        showShareButton:  function () {},
        showColliderBtn:  function () {},
        showPanel:        function () {},
        setVRButtonState: function () {},
    };
}());
