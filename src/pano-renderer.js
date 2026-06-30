/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * Marzipano (Google 製の WebGL パノラマビューアライブラリ、MIT) を CDN から
 * 動的ロードして使う。PlayCanvas の自前球面投影では極付近で歪みが目立ったため、
 * 業界標準のライブラリに切り替えてピクセル単位の正確な投影と滑らかな見回しを得る。
 *
 * Marzipano は独自に WebGL canvas を生成して画面にオーバーレイ表示する。
 * PlayCanvas の canvas は背後で動き続けるが、見えないので問題なし。
 */
window.PanoRenderer = (function () {
    'use strict';

    var MARZIPANO_URL =
        'https://cdn.jsdelivr.net/npm/marzipano@0.10.2/dist/marzipano.js';

    var _viewer    = null;
    var _container = null;
    var _wheelHandler     = null;   // 自前ホイールズーム
    var _loadingMarzipano = null;   // ロード Promise キャッシュ

    function _ensureMarzipanoLoaded() {
        if (window.Marzipano) return Promise.resolve();
        if (_loadingMarzipano) return _loadingMarzipano;
        _loadingMarzipano = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = MARZIPANO_URL;
            s.onload  = function () { resolve(); };
            s.onerror = function () {
                reject(new Error('Marzipano のロードに失敗しました (CDN到達不可)'));
            };
            document.head.appendChild(s);
        });
        return _loadingMarzipano;
    }

    function _createOverlay() {
        _container = document.createElement('div');
        _container.id = 'pano-marzipano';
        _container.style.cssText = [
            'position:fixed;', 'inset:0;', 'z-index:20;',
            'background:#000;', 'overflow:hidden;'
        ].join('');
        document.body.appendChild(_container);
    }

    function _disposeOverlay() {
        if (_container && _wheelHandler) {
            _container.removeEventListener('wheel', _wheelHandler);
        }
        _wheelHandler = null;
        if (_viewer) {
            try { _viewer.destroy(); }
            catch (e) { console.warn('[PanoRenderer] viewer.destroy エラー:', e); }
            _viewer = null;
        }
        if (_container && _container.parentNode) {
            _container.parentNode.removeChild(_container);
        }
        _container = null;
    }

    function _show(src) {
        return _ensureMarzipanoLoaded().then(function () {
            _disposeOverlay();
            _createOverlay();

            var M = window.Marzipano;
            _viewer = new M.Viewer(_container, {
                controls: { mouseViewMode: 'drag' }   // ドラッグで見回す
            });

            var source   = M.ImageUrlSource.fromString(src);
            var geometry = new M.EquirectGeometry([{ width: 8000 }]);

            // ズーム範囲: 最大 200度・最小 20度
            // ※ RectilinearView は透視投影なので 180度近くで像が急激に引き伸び、
            //   180度を超えると数学的に表現不能。Marzipano が内部でクリップする
            //   可能性あり (その場合は実効上限 ~179度になる)。
            var limiter = M.RectilinearView.limit.traditional(
                8192,
                200 * Math.PI / 180,
                20  * Math.PI / 180
            );
            var view = new M.RectilinearView(
                { yaw: 0, pitch: 0, fov: 200 * Math.PI / 180 },
                limiter
            );

            var scene = _viewer.createScene({
                source:   source,
                geometry: geometry,
                view:     view,
                pinFirstLevel: true
            });
            scene.switchTo();

            // コンテナサイズが 0 のまま描画された場合に備えて、次フレームで
            // リサイズ強制 (Marzipano の updateSize は内部で resize イベントを発火)
            requestAnimationFrame(function () {
                if (_viewer && _viewer.updateSize) _viewer.updateSize();
            });

            // Marzipano デフォルトには wheel zoom が含まれないので自前で実装
            _wheelHandler = function (e) {
                if (!_viewer) return;
                e.preventDefault();
                var v = _viewer.scene().view();
                var curFov = v.fov();
                var factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
                v.setFov(curFov * factor);
            };
            _container.addEventListener('wheel', _wheelHandler,
                { passive: false });
        });
    }

    function _makePseudoAsset(src, name) {
        return { __pano: true, src: src, name: name || 'panorama' };
    }

    return {

        init: function (app) { /* Marzipano は PlayCanvas に依存しない */ },

        loadFromURL: function (app, url) {
            return Promise.resolve(_makePseudoAsset(url, url.split('/').pop()));
        },

        loadFromFile: function (app, file) {
            var src = URL.createObjectURL(file);
            return Promise.resolve(_makePseudoAsset(src, file.name));
        },

        /**
         * Marzipano ビューアでパノラマを表示する
         */
        create: function (app, asset, options) {
            if (!asset || !asset.src) {
                throw new Error('[PanoRenderer] 画像ソースが指定されていません');
            }
            _show(asset.src).then(function () {
                console.log('[PanoRenderer] Marzipano 起動');
            }).catch(function (err) {
                console.error('[PanoRenderer]', err);
                if (window.UI && UI.showError) UI.showError(err.message);
            });
            return null;
        },

        // Marzipano が独自に向き制御するので no-op
        setYaw: function () { /* no-op */ },

        // カメラ固定位置の互換用 (camera-controller の lockPosition に渡す)
        getCenter: function () { return { x: 0, y: 1.6, z: 0 }; },

        dispose: function () { _disposeOverlay(); },

        isActive: function () { return !!_container; }
    };
}());
