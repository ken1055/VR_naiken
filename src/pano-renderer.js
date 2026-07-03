/**
 * pano-renderer.js — 360度 (Equirectangular) 画像ビューア
 *
 * 外部ライブラリ非依存の自前 WebGL ビューア。
 * フルスクリーン quad + フラグメントシェーダで equirectangular 画像を
 * 任意の投影方式でサンプリングして描画する。
 *
 * 投影は Panini（Insta360「デワープ」相当）固定。縦の直線をまっすぐ保ったまま
 * 広角の周辺の引き伸ばしを抑え、室内を自然に見せる。
 * 圧縮量は setPaniniD() でプログラムから調整可能（UI は持たない）。
 *
 * 操作: ドラッグ回転（慣性付き）/ ホイールズーム / 1本指ドラッグ / 2本指ピンチ
 *
 * 独自 canvas を z-index:20 で全画面オーバーレイ表示する。
 * PlayCanvas の canvas は背後で動き続けるが見えないので問題なし。
 */
window.PanoRenderer = (function () {
    'use strict';

    // ---- DOM / GL ----
    var _container = null;   // 全画面オーバーレイ
    var _canvas    = null;
    var _gl        = null;
    var _program   = null;
    var _quadBuf   = null;
    var _tex       = null;
    var _rafId     = null;
    var _active    = false;
    var _u         = {};     // uniform ロケーション

    // ---- ビュー状態 ----
    var _yaw     = 0;        // deg
    var _pitch   = 0;        // deg
    var _scale   = 0.65;     // ズーム（小さいほど拡大）
    var _paniniD = 1.0;      // Panini 圧縮量 (0=透視寄り, 1〜=広角)

    var MIN_SCALE   = 0.20;
    var MAX_SCALE   = 1.30;
    var PITCH_LIMIT = 85;    // deg

    // ---- 慣性・入力 ----
    var _yawVel = 0, _pitchVel = 0;
    var _dragging = false;
    var _lastX = 0, _lastY = 0;
    var _pinchDist = 0;

    var _isMobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent);

    // ================================================================
    // シェーダ
    // ================================================================
    var VERT = [
        'attribute vec2 aPos;',
        'varying vec2 vNdc;',
        'void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }'
    ].join('\n');

    var FRAG = [
        'precision highp float;',
        'varying vec2 vNdc;',
        'uniform sampler2D uTex;',
        'uniform float uYaw;',     // rad
        'uniform float uPitch;',   // rad
        'uniform float uScale;',
        'uniform float uAspect;',
        'uniform float uD;',       // panini 圧縮量
        'const float PI = 3.14159265358979;',
        'mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }',
        'mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }',
        'void main(){',
        '  float sx = vNdc.x * uScale * uAspect;',
        '  float sy = vNdc.y * uScale;',
        // Panini 投影（デワープ）: 縦の直線を保ったまま広角の周辺歪みを抑える
        '  float d = uD;',
        '  float k = sx;',
        '  float R = sqrt((d+1.0)*(d+1.0) + k*k);',
        '  float alpha = atan(k, d+1.0);',
        '  float theta = alpha + asin(clamp(k*d/R, -1.0, 1.0));',
        '  float phi = atan(sy * (d + cos(theta)) / (d + 1.0));',
        '  float cp = cos(phi);',
        '  vec3 dir = vec3(sin(theta)*cp, sin(phi), -cos(theta)*cp);',
        '  dir = rotY(uYaw) * rotX(uPitch) * dir;',
        '  float lon = atan(dir.x, -dir.z);',
        '  float lat = asin(clamp(dir.y, -1.0, 1.0));',
        '  vec2 uv = vec2(lon/(2.0*PI) + 0.5, 0.5 - lat/PI);',
        '  gl_FragColor = texture2D(uTex, uv);',
        '}'
    ].join('\n');

    function _compile(gl, type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            throw new Error('[PanoRenderer] シェーダコンパイル失敗: ' + gl.getShaderInfoLog(sh));
        }
        return sh;
    }

    // ================================================================
    // GL 初期化（1度だけ）
    // ================================================================
    function _ensure() {
        if (_gl) return;
        _buildContainer();

        _gl = _canvas.getContext('webgl') || _canvas.getContext('experimental-webgl');
        if (!_gl) throw new Error('[PanoRenderer] WebGL を初期化できません');
        var gl = _gl;

        _program = gl.createProgram();
        gl.attachShader(_program, _compile(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(_program, _compile(gl, gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(_program);
        if (!gl.getProgramParameter(_program, gl.LINK_STATUS)) {
            throw new Error('[PanoRenderer] プログラムリンク失敗: ' + gl.getProgramInfoLog(_program));
        }
        gl.useProgram(_program);

        // フルスクリーン quad (2 triangles)
        _quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, _quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  1, -1,  -1, 1,
            -1,  1,  1, -1,   1, 1
        ]), gl.STATIC_DRAW);
        var aPos = gl.getAttribLocation(_program, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        ['uTex', 'uYaw', 'uPitch', 'uScale', 'uAspect', 'uD'].forEach(function (n) {
            _u[n] = gl.getUniformLocation(_program, n);
        });

        _attachEvents();
        window.addEventListener('resize', _resize);
    }

    // ================================================================
    // オーバーレイ DOM
    // ================================================================
    function _buildContainer() {
        _container = document.createElement('div');
        _container.id = 'pano-view';
        _container.style.cssText =
            'position:fixed; inset:0; z-index:20; background:#000; overflow:hidden;';

        _canvas = document.createElement('canvas');
        _canvas.style.cssText = 'display:block; width:100%; height:100%; touch-action:none;';
        _container.appendChild(_canvas);

        document.body.appendChild(_container);
    }

    // ================================================================
    // テクスチャアップロード（POT 化 + サイズ安全化）
    // ================================================================
    function _uploadTexture(img) {
        var gl = _gl;
        var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

        // equirect は 2:1。REPEAT ラップを使うため POT の 2:1 canvas に描き直す。
        var target = 4096;
        while (target > maxTex) target /= 2;                       // デバイス上限に収める
        while (target / 2 >= img.width && target > 2048) target /= 2; // 過剰な拡大を避ける
        var w = target, h = target / 2;

        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);

        if (_tex) gl.deleteTexture(_tex);
        _tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, _tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);          // 経度方向は継ぎ目なくラップ
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);   // 極は端でクランプ
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    // ================================================================
    // 描画ループ
    // ================================================================
    function _resize() {
        if (!_canvas || !_container) return;
        var dpr = Math.min(window.devicePixelRatio || 1, _isMobile ? 1.5 : 2);
        _canvas.width  = Math.max(1, Math.floor(_container.clientWidth  * dpr));
        _canvas.height = Math.max(1, Math.floor(_container.clientHeight * dpr));
        if (_gl) _gl.viewport(0, 0, _canvas.width, _canvas.height);
        _requestRender();
    }

    function _clampPitch() {
        if (_pitch >  PITCH_LIMIT) _pitch =  PITCH_LIMIT;
        if (_pitch < -PITCH_LIMIT) _pitch = -PITCH_LIMIT;
    }

    var DEG = Math.PI / 180;

    function _draw() {
        if (!_gl || !_tex) return;
        var gl = _gl;
        gl.useProgram(_program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, _tex);
        gl.uniform1i(_u.uTex, 0);
        gl.uniform1f(_u.uYaw,   _yaw   * DEG);
        gl.uniform1f(_u.uPitch, _pitch * DEG);
        gl.uniform1f(_u.uScale, _scale);
        gl.uniform1f(_u.uAspect, _canvas.width / _canvas.height);
        gl.uniform1f(_u.uD, _paniniD);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // オンデマンド描画。変化があるときだけ1フレーム要求する。
    // （常時 rAF を回さないことでアイドル時のバッテリ/GPU 消費をゼロにする）
    function _requestRender() {
        if (!_active) return;
        if (_rafId) return;
        _rafId = requestAnimationFrame(_frame);
    }

    function _frame() {
        _rafId = null;
        if (!_active) return;
        var moving = false;
        // 慣性（ドラッグしていないときのみ）
        if (!_dragging && (Math.abs(_yawVel) > 0.01 || Math.abs(_pitchVel) > 0.01)) {
            _yaw   += _yawVel;
            _pitch += _pitchVel;
            _clampPitch();
            _yawVel   *= 0.92;
            _pitchVel *= 0.92;
            moving = true;
        } else {
            _yawVel = _pitchVel = 0;
        }
        _draw();
        if (moving || _dragging) _requestRender();  // アニメ中・ドラッグ中は継続
    }

    // ================================================================
    // 入力
    // ================================================================
    function _rotateBy(dxPx, dyPx) {
        // grab-drag: 掴んだ点が指/カーソルに追従する感覚（PSV・Street View と同じ）
        // 右へドラッグ → 視点は左へ回る（縦横で規約を揃える）
        var k = _scale * 130 / _canvas.clientHeight; // deg/px
        _yaw   += dxPx * k;
        _pitch += dyPx * k;
        _clampPitch();
        _yawVel   = dxPx * k;
        _pitchVel = dyPx * k;
        _requestRender();
    }

    function _zoomBy(factor) {
        _scale *= factor;
        if (_scale < MIN_SCALE) _scale = MIN_SCALE;
        if (_scale > MAX_SCALE) _scale = MAX_SCALE;
        _requestRender();
    }

    function _attachEvents() {
        var el = _canvas;

        // --- マウス ---
        el.addEventListener('mousedown', function (e) {
            _dragging = true; _lastX = e.clientX; _lastY = e.clientY;
            _yawVel = _pitchVel = 0; e.preventDefault();
        });
        window.addEventListener('mousemove', function (e) {
            if (!_dragging) return;
            _rotateBy(e.clientX - _lastX, e.clientY - _lastY);
            _lastX = e.clientX; _lastY = e.clientY;
        });
        window.addEventListener('mouseup', function () { _dragging = false; });
        el.addEventListener('wheel', function (e) {
            _zoomBy(1 + (e.deltaY > 0 ? 0.08 : -0.08));
            e.preventDefault();
        }, { passive: false });

        // --- タッチ ---
        el.addEventListener('touchstart', function (e) {
            if (e.touches.length === 1) {
                _dragging = true;
                _lastX = e.touches[0].clientX; _lastY = e.touches[0].clientY;
                _yawVel = _pitchVel = 0;
            } else if (e.touches.length === 2) {
                _dragging = false;
                _pinchDist = _touchDist(e);
            }
            e.preventDefault();
        }, { passive: false });
        el.addEventListener('touchmove', function (e) {
            if (e.touches.length === 1 && _dragging) {
                _rotateBy(e.touches[0].clientX - _lastX, e.touches[0].clientY - _lastY);
                _lastX = e.touches[0].clientX; _lastY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                var d = _touchDist(e);
                if (_pinchDist > 0) _zoomBy(_pinchDist / d);
                _pinchDist = d;
            }
            e.preventDefault();
        }, { passive: false });
        el.addEventListener('touchend', function (e) {
            if (e.touches.length === 0) _dragging = false;
            _pinchDist = 0;
        });
    }

    function _touchDist(e) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ================================================================
    // 画像ロード
    // ================================================================
    function _loadImage(src, cors) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            if (cors) img.crossOrigin = 'anonymous';
            img.onload  = function () { resolve(img); };
            img.onerror = function () { reject(new Error('360度画像の読み込みに失敗しました')); };
            img.src = src;
        });
    }

    function _makeAsset(img, name) {
        return { __pano: true, img: img, name: name || 'panorama' };
    }

    // ================================================================
    // 公開 API
    // ================================================================
    return {

        init: function () { /* PlayCanvas 非依存。遅延初期化するので何もしない */ },

        loadFromURL: function (app, url) {
            return _loadImage(url, true).then(function (img) {
                return _makeAsset(img, url.split('/').pop());
            });
        },

        loadFromFile: function (app, file) {
            var url = URL.createObjectURL(file);
            return _loadImage(url, false).then(function (img) {
                URL.revokeObjectURL(url);
                return _makeAsset(img, file.name);
            }).catch(function (e) {
                URL.revokeObjectURL(url);
                throw e;
            });
        },

        create: function (app, asset, options) {
            if (!asset || !asset.img) {
                throw new Error('[PanoRenderer] 画像が指定されていません');
            }
            options = options || {};
            _ensure();
            _yaw   = options.yaw   || 0;
            _pitch = options.pitch || 0;
            _clampPitch();
            _active = true;
            _container.style.display = 'block';
            _uploadTexture(asset.img);
            _resize();
            _requestRender();
            return null;
        },

        // 互換のため残置（yaw のみ設定）
        setYaw: function (deg) { _yaw = deg || 0; _requestRender(); },

        // 初期視点・戻り視点の適用（度）
        setView: function (yaw, pitch) {
            _yaw = yaw || 0;
            _pitch = pitch || 0;
            _clampPitch();
            _yawVel = _pitchVel = 0;
            _requestRender();
        },

        getView: function () { return { yaw: _yaw, pitch: _pitch }; },

        // Panini 圧縮量（デワープの効き）の調整。0=透視寄り, 1〜=広角。UI は無し。
        setPaniniD: function (d) {
            _paniniD = Math.max(0, d);
            _requestRender();
        },

        getCenter: function () { return { x: 0, y: 1.6, z: 0 }; },

        dispose: function () {
            _active = false;
            if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
            if (_container) _container.style.display = 'none';
        },

        isActive: function () { return _active; }
    };
}());
