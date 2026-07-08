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

    // 場所一覧メニューから選択されたとき:
    // 目的地 URL があれば近接トリガーと同じシーン切替、なければ同一シーン内テレポート
    function _gotoPoint(pt) {
        if (!pt) return;
        if (pt.destinationUrl) {
            if (_onActivate) _onActivate(pt);
        } else if (window.CameraController && pt.position) {
            var st = CameraController.getState ? CameraController.getState() : null;
            CameraController.teleport(
                pt.position.x, pt.position.y, pt.position.z,
                st ? st.yaw : 0, st ? st.pitch : 0
            );
        }
    }

    function _syncPlacesMenu() {
        if (window.UI && UI.setPlacesMenu) UI.setPlacesMenu(_points, _gotoPoint);
    }

    return {
        init: function (app) {
            _app = app;
        },

        load: function (teleports, onActivate) {
            this.reset();
            if (!teleports || !teleports.length) return;
            _onActivate = onActivate;
            _points     = teleports;
            _syncPlacesMenu();
        },

        update: function (camPos) {
            if (!_points.length) return;

            // 最近接ポイントを探す（半径内なら active）
            var nearest = null, nearestDist = Infinity;
            _points.forEach(function (pt) {
                // メニュー専用ポイント: 場所一覧メニューにのみ表示し、近接トリガーは持たない
                // （3DGS 内に入口が無い部屋＝風呂など向け。位置は保存されるが判定に使わない）
                if (pt.menuOnly) return;
                if (!pt.position) return;
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
            _syncPlacesMenu();
        },

        setOnActivate: function (fn) { _onActivate = fn; },

        getPoints: function () { return _points.slice(); },

        addPoint: function (point) {
            _points.push(point);
            _syncPlacesMenu();
        },

        removePoint: function (index) {
            _points.splice(index, 1);
            _syncPlacesMenu();
        }
    };
}());
