/**
 * teleport.js — シーン間テレポートシステム
 * テレポートポイントを3D空間に配置し、近づいたときに UI プロンプトを表示する。
 * 円盤などのビジュアルマーカーは持たない（半径内に入ったかどうかだけ判定）。
 */
window.Teleporter = (function () {
    'use strict';

    var _app         = null;
    var _points      = [];   // { label, position:{x,y,z}, radius, destinationUrl, destinationCamera }
    var _activePoint = null;
    var _onActivate  = null;

    return {
        init: function (app) {
            _app = app;
        },

        load: function (teleports, onActivate) {
            this.reset();
            if (!teleports || !teleports.length) return;
            _onActivate = onActivate;
            _points     = teleports;
        },

        update: function (camPos) {
            if (!_points.length) return;

            // 最近接ポイントを探す（半径内なら active）
            var nearest = null, nearestDist = Infinity;
            _points.forEach(function (pt) {
                var dx   = camPos.x - pt.position.x;
                var dz   = camPos.z - pt.position.z;
                var dist = Math.sqrt(dx * dx + dz * dz);
                var r    = pt.radius !== undefined ? pt.radius : 1.2;
                if (dist < r && dist < nearestDist) {
                    nearest     = pt;
                    nearestDist = dist;
                }
            });

            if (nearest !== _activePoint) {
                _activePoint = nearest;
                if (window.UI) {
                    UI.setTeleportPrompt(nearest, function () {
                        if (_onActivate && _activePoint) _onActivate(_activePoint);
                    });
                }
            }
        },

        reset: function () {
            _points      = [];
            _activePoint = null;
            if (window.UI) UI.setTeleportPrompt(null, null);
        },

        setOnActivate: function (fn) { _onActivate = fn; },

        getPoints: function () { return _points.slice(); },

        addPoint: function (point) {
            _points.push(point);
        },

        removePoint: function (index) {
            _points.splice(index, 1);
        }
    };
}());
