/**
 * pano-renderer.js — 360度 (Equirectangular) 画像表示モジュール
 *
 * Photo Sphere Viewer (PSV v4, MIT) を CDN から動的ロードして使う。
 * Three.js ベースで Insta360 / Street View 同等の rectilinear (デワープ) 表示を
 * 提供。デフォルトで慣性付きドラッグ、マウスホイールズーム、ピンチズーム、
 * ジャイロ対応など Insta360 アプリと同等の操作感を持つ。
 *
 * PSV は独自に WebGL canvas を生成して画面にオーバーレイ表示する。
 * PlayCanvas の canvas は背後で動き続けるが、見えないので問題なし。
 */
window.PanoRenderer = (function () {
    'use strict';

    // PSV v4 の依存: three.js → uEvent → PSV 本体 の順でロード
    var SCRIPT_DEPS = [
        'https://cdn.jsdelivr.net/npm/three@0.135.0/build/three.min.js',
        'https://cdn.jsdelivr.net/npm/uevent@2/browser.min.js',
        'https://cdn.jsdelivr.net/npm/photo-sphere-viewer@4/dist/photo-sphere-viewer.min.js'
    ];
    var CSS_URL =
        'https://cdn.jsdelivr.net/npm/photo-sphere-viewer@4/dist/photo-sphere-viewer.min.css';

    var _viewer       = null;
    var _container    = null;
    var _depsLoading  = null;   // ロード Promise キャッシュ

    function _loadScript(url) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src     = url;
            s.onload  = function () { resolve(); };
            s.onerror = function () {
                reject(new Error('スクリプトロード失敗: ' + url));
            };
            document.head.appendChild(s);
        });
    }

    function _loadCSS(url) {
        if (document.querySelector('link[data-pano-css]')) return;
        var link = document.createElement('link');
        link.rel  = 'stylesheet';
        link.href = url;
        link.setAttribute('data-pano-css', '1');
        document.head.appendChild(link);
    }

    function _ensureDeps() {
        if (window.PhotoSphereViewer) return Promise.resolve();
        if (_depsLoading) return _depsLoading;
        _loadCSS(CSS_URL);
        _depsLoading = SCRIPT_DEPS.reduce(function (p, url) {
            return p.then(function () { return _loadScript(url); });
        }, Promise.resolve());
        return _depsLoading;
    }

    function _createContainer() {
        _container = document.createElement('div');
        _container.id = 'pano-psv';
        _container.style.cssText = [
            'position:fixed;', 'inset:0;', 'z-index:20;',
            'background:#000;', 'overflow:hidden;'
        ].join('');
        document.body.appendChild(_container);
    }

    function _disposeOverlay() {
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
        return _ensureDeps().then(function () {
            _disposeOverlay();
            _createContainer();

            _viewer = new PhotoSphereViewer.Viewer({
                container:       _container,
                panorama:        src,
                navbar:          false,           // 下部 UI バー非表示
                defaultZoomLvl:  30,              // 0(広角)-100(望遠)。30=やや広角
                minFov:          30,
                maxFov:          100,
                mousewheel:      true,            // ホイールズーム有効
                mousemove:       true,            // ドラッグで見回し
                touchmoveTwoFingers: false,       // 1本指でドラッグ可
                loadingTxt:      '読み込み中...',
                useXmpData:      false            // 撮影メタデータ無視
            });

            console.log('[PanoRenderer] Photo Sphere Viewer 起動');
        });
    }

    function _makePseudoAsset(src, name) {
        return { __pano: true, src: src, name: name || 'panorama' };
    }

    return {

        init: function (app) { /* PSV は PlayCanvas に依存しない */ },

        loadFromURL: function (app, url) {
            return Promise.resolve(_makePseudoAsset(url, url.split('/').pop()));
        },

        loadFromFile: function (app, file) {
            var src = URL.createObjectURL(file);
            return Promise.resolve(_makePseudoAsset(src, file.name));
        },

        create: function (app, asset, options) {
            if (!asset || !asset.src) {
                throw new Error('[PanoRenderer] 画像ソースが指定されていません');
            }
            _show(asset.src).catch(function (err) {
                console.error('[PanoRenderer]', err);
                if (window.UI && UI.showError) UI.showError(err.message);
            });
            return null;
        },

        // PSV が独自に向き制御するので no-op
        setYaw: function () { /* no-op */ },

        getCenter: function () { return { x: 0, y: 1.6, z: 0 }; },

        dispose: function () { _disposeOverlay(); },

        isActive: function () { return !!_container; }
    };
}());
