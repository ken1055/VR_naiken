/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * 平面スクロール式ビューア。画像をHTMLオーバーレイで表示し、マウスドラッグや
 * ピンチで自由にスクロール/ズームできる。equirectangular の歪みは画像本来の
 * 見え方として残るが、3D球面投影による視差の歪みは発生しない。
 *
 * 既存の create / dispose / getCenter / loadFromURL / loadFromFile API は
 * シグネチャを維持。app / asset 引数は互換性のために受け取るだけ。
 */
window.PanoRenderer = (function () {
    'use strict';

    var _overlay = null;
    var _img     = null;
    var _state   = {
        imgW: 0,    imgH: 0,
        viewW: 0,   viewH: 0,
        offsetX: 0, offsetY: 0,
        scale: 1,   minScale: 1, maxScale: 1,
        dragging: false,
        lastX: 0,   lastY: 0,
        pinchDist: 0
    };

    function _apply() {
        if (!_img) return;
        _img.style.transform =
            'translate3d(' + _state.offsetX + 'px,' + _state.offsetY + 'px,0)'
            + ' scale(' + _state.scale + ')';
    }

    // 画像が画面からはみ出さないように位置をクランプする
    function _clamp() {
        var w = _state.imgW * _state.scale;
        var h = _state.imgH * _state.scale;
        if (h <= _state.viewH) {
            _state.offsetY = (_state.viewH - h) / 2;
        } else {
            if (_state.offsetY > 0) _state.offsetY = 0;
            if (_state.offsetY + h < _state.viewH) _state.offsetY = _state.viewH - h;
        }
        if (w <= _state.viewW) {
            _state.offsetX = (_state.viewW - w) / 2;
        } else {
            if (_state.offsetX > 0) _state.offsetX = 0;
            if (_state.offsetX + w < _state.viewW) _state.offsetX = _state.viewW - w;
        }
    }

    function _recomputeScales() {
        // 最小スケール: 画面の縦方向が画像の縦幅以下に収まる程度
        var fitH = _state.viewH / _state.imgH;
        var fitW = _state.viewW / _state.imgW;
        _state.minScale = Math.min(fitH, fitW * 0.5);  // 引いて見られるようにする
        _state.maxScale = Math.max(fitH, fitW) * 8;
    }

    function _onLoad() {
        if (!_img || !_overlay) return;
        _state.imgW  = _img.naturalWidth;
        _state.imgH  = _img.naturalHeight;
        _state.viewW = _overlay.clientWidth;
        _state.viewH = _overlay.clientHeight;
        _recomputeScales();
        // 初期は画面の縦に合わせる (パノラマの上下が見切れない最大表示)
        _state.scale   = _state.viewH / _state.imgH;
        _state.offsetX = (_state.viewW - _state.imgW * _state.scale) / 2;
        _state.offsetY = (_state.viewH - _state.imgH * _state.scale) / 2;
        _clamp();
        _apply();
    }

    function _zoomAt(mx, my, factor) {
        var newScale = _state.scale * factor;
        if (newScale < _state.minScale) newScale = _state.minScale;
        if (newScale > _state.maxScale) newScale = _state.maxScale;
        var k = newScale / _state.scale;
        _state.offsetX = mx - (mx - _state.offsetX) * k;
        _state.offsetY = my - (my - _state.offsetY) * k;
        _state.scale = newScale;
        _clamp();
        _apply();
    }

    // ---- マウス ----
    function _onMouseDown(e) {
        _state.dragging = true;
        _state.lastX    = e.clientX;
        _state.lastY    = e.clientY;
        _overlay.style.cursor = 'grabbing';
        e.preventDefault();
    }
    function _onMouseMove(e) {
        if (!_state.dragging || !_overlay) return;
        _state.offsetX += e.clientX - _state.lastX;
        _state.offsetY += e.clientY - _state.lastY;
        _state.lastX = e.clientX;
        _state.lastY = e.clientY;
        _clamp();
        _apply();
    }
    function _onMouseUp() {
        if (!_state.dragging) return;
        _state.dragging = false;
        if (_overlay) _overlay.style.cursor = 'grab';
    }
    function _onWheel(e) {
        e.preventDefault();
        var rect = _overlay.getBoundingClientRect();
        var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        _zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }

    // ---- タッチ ----
    function _touchDist(t0, t1) {
        var dx = t0.clientX - t1.clientX;
        var dy = t0.clientY - t1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    function _onTouchStart(e) {
        if (e.touches.length === 1) {
            _state.dragging = true;
            _state.lastX = e.touches[0].clientX;
            _state.lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            _state.dragging = false;
            _state.pinchDist = _touchDist(e.touches[0], e.touches[1]);
        }
        e.preventDefault();
    }
    function _onTouchMove(e) {
        if (e.touches.length === 1 && _state.dragging) {
            _state.offsetX += e.touches[0].clientX - _state.lastX;
            _state.offsetY += e.touches[0].clientY - _state.lastY;
            _state.lastX = e.touches[0].clientX;
            _state.lastY = e.touches[0].clientY;
            _clamp();
            _apply();
        } else if (e.touches.length === 2) {
            var d = _touchDist(e.touches[0], e.touches[1]);
            if (_state.pinchDist > 0) {
                var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                var rect = _overlay.getBoundingClientRect();
                _zoomAt(mx - rect.left, my - rect.top, d / _state.pinchDist);
            }
            _state.pinchDist = d;
        }
        e.preventDefault();
    }
    function _onTouchEnd(e) {
        if (e.touches.length < 2) _state.pinchDist = 0;
        if (e.touches.length === 0) _state.dragging = false;
    }

    function _onResize() {
        if (!_overlay || !_img) return;
        _state.viewW = _overlay.clientWidth;
        _state.viewH = _overlay.clientHeight;
        _recomputeScales();
        if (_state.scale < _state.minScale) _state.scale = _state.minScale;
        _clamp();
        _apply();
    }

    function _createOverlay() {
        _overlay = document.createElement('div');
        _overlay.id = 'pano-overlay';
        _overlay.style.cssText = [
            'position:fixed;', 'inset:0;', 'z-index:20;',
            'background:#000;', 'overflow:hidden;',
            'touch-action:none;', 'cursor:grab;', 'user-select:none;'
        ].join('');

        _img = document.createElement('img');
        _img.style.cssText = [
            'position:absolute;', 'top:0;', 'left:0;',
            'transform-origin:0 0;',
            'pointer-events:none;',
            '-webkit-user-drag:none;',
            'image-rendering:high-quality;'
        ].join('');
        _img.draggable = false;
        _img.addEventListener('load', _onLoad);
        _overlay.appendChild(_img);

        document.body.appendChild(_overlay);

        _overlay.addEventListener('mousedown',  _onMouseDown);
        window.addEventListener('mousemove',    _onMouseMove);
        window.addEventListener('mouseup',      _onMouseUp);
        _overlay.addEventListener('wheel',      _onWheel,      { passive: false });
        _overlay.addEventListener('touchstart', _onTouchStart, { passive: false });
        _overlay.addEventListener('touchmove',  _onTouchMove,  { passive: false });
        _overlay.addEventListener('touchend',   _onTouchEnd);
        window.addEventListener('resize', _onResize);
    }

    function _disposeOverlay() {
        if (!_overlay) return;
        window.removeEventListener('mousemove', _onMouseMove);
        window.removeEventListener('mouseup',   _onMouseUp);
        window.removeEventListener('resize',    _onResize);
        if (_overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
        _overlay = null;
        _img = null;
        _state.dragging = false;
    }

    // 擬似 asset (loadFromURL/File → create の橋渡し)
    function _makePseudoAsset(src, name) {
        return { __pano: true, src: src, name: name || 'panorama' };
    }

    return {

        init: function (app) { /* HTML オーバーレイ方式は app に依存しない */ },

        loadFromURL: function (app, url) {
            return Promise.resolve(_makePseudoAsset(url, url.split('/').pop()));
        },

        loadFromFile: function (app, file) {
            var src = URL.createObjectURL(file);
            return Promise.resolve(_makePseudoAsset(src, file.name));
        },

        /**
         * パノラマ画像をオーバーレイ表示する
         * @param {pc.Application} app
         * @param {Object} asset   loadFromURL/File が返した擬似 asset
         * @param {Object} [options]  互換のため受け取るが現在は未使用
         */
        create: function (app, asset, options) {
            if (!asset || !asset.src) {
                throw new Error('[PanoRenderer] 画像ソースが指定されていません');
            }
            _disposeOverlay();
            _createOverlay();
            _img.src = asset.src;
            console.log('[PanoRenderer] 平面スクロール式ビューア起動');
            return null;
        },

        // 平面ビューアでは概念がないため互換用 no-op
        setYaw: function (yaw) { /* no-op */ },

        // カメラ固定位置として呼び出し側に返す (互換用に従来値)
        getCenter: function () { return { x: 0, y: 1.6, z: 0 }; },

        dispose: function () { _disposeOverlay(); },

        isActive: function () { return !!_overlay; }
    };
}());
