/**
 * GSplatRenderer — PlayCanvas GSplatComponent のセットアップ
 * window.GSplatRenderer としてグローバルに公開
 *
 * 使い方:
 *   const entity = GSplatRenderer.create(app, asset);   // シーンに追加
 *   GSplatRenderer.dispose(entity);                      // 指定 Entity を破棄
 *   GSplatRenderer.disposeAll();                         // 全 GSplat Entity を破棄
 */
(function () {
    'use strict';

    // 管理中の Entity リスト
    var _entities = [];

    /**
     * 指定した Entity が GSplat Entity かどうか確認する
     * @param {pc.Entity} entity
     * @returns {boolean}
     */
    function _isGSplatEntity(entity) {
        return entity && entity.tags && entity.tags.has('gsplat-renderer');
    }

    // ---- メインオブジェクト ----

    window.GSplatRenderer = {

        /**
         * GSplat アセットからレンダリング Entity を生成してシーンに追加する
         *
         * @param {pc.Application} app     PlayCanvas Application インスタンス
         * @param {pc.Asset}       asset   GSplatLoader でロード済みの pc.Asset
         * @returns {pc.Entity}            シーンに追加された Entity
         */
        create: function (app, asset) {
            // ---- 事前チェック ----
            if (!app || typeof app.root === 'undefined') {
                throw new Error('[GSplatRenderer] 有効な PlayCanvas Application インスタンスを指定してください。');
            }

            if (!asset) {
                throw new Error('[GSplatRenderer] 有効な pc.Asset を指定してください。');
            }

            // pc.GSplatComponent が存在するか確認（PlayCanvas v2.x 必須）
            if (typeof pc === 'undefined' || !pc.GSplatComponent) {
                throw new Error(
                    '[GSplatRenderer] pc.GSplatComponent が見つかりません。\n' +
                    'PlayCanvas v2.x 以降が必要です。CDN の読み込みを確認してください。'
                );
            }

            // ---- Entity 生成 ----
            var entity = new pc.Entity('gsplat-scene');

            // タグを付けて管理対象として識別
            entity.tags.add('gsplat-renderer');

            // GSplatComponent をアタッチ
            try {
                entity.addComponent('gsplat', { asset: asset });
            } catch (e) {
                entity.destroy();
                throw new Error(
                    '[GSplatRenderer] GSplatComponent の追加に失敗しました: ' + e.message + '\n' +
                    'PlayCanvas v2.x および WebGL2 対応ブラウザが必要です。'
                );
            }

            // ---- 座標系補正 ----
            // Nerfstudio / COLMAP 出力は Y 軸上下逆になる場合があるため -90° 補正
            // UI から後から変更できるように初期値として設定
            entity.setLocalEulerAngles(-90, 0, 0);
            entity.setLocalPosition(0, 0, 0);
            entity.setLocalScale(1, 1, 1);

            // ---- シーンへ追加 ----
            app.root.addChild(entity);
            _entities.push(entity);

            console.log('[GSplatRenderer] Entity 生成完了:', entity.name, '/ 管理数:', _entities.length);
            return entity;
        },

        /**
         * 指定した GSplat Entity を破棄する
         * 引数なし / null の場合は最後に生成した Entity を破棄する
         *
         * @param {pc.Entity} [entity]  破棄する Entity（省略時は最後に生成した Entity）
         */
        dispose: function (entity) {
            var target = entity || _entities[_entities.length - 1] || null;

            if (!target) {
                return; // 破棄対象なし
            }

            // 管理リストから除去
            var idx = _entities.indexOf(target);
            if (idx !== -1) {
                _entities.splice(idx, 1);
            }

            // GSplat コンポーネントを先に解放してからEntity破棄
            if (target.gsplat) {
                try {
                    target.removeComponent('gsplat');
                } catch (e) {
                    console.warn('[GSplatRenderer] GSplatComponent 除去中にエラー:', e);
                }
            }

            try {
                target.destroy();
            } catch (e) {
                console.warn('[GSplatRenderer] Entity 破棄中にエラー:', e);
            }

            console.log('[GSplatRenderer] Entity 破棄完了 / 残管理数:', _entities.length);
        },

        /**
         * 管理中の全 GSplat Entity を破棄する
         */
        disposeAll: function () {
            // コピーして反復（破棄中にリストが変化するため）
            var toDispose = _entities.slice();
            toDispose.forEach(function (entity) {
                this.dispose(entity);
            }, this);
            _entities = [];
        },

        /**
         * 現在管理している Entity のリストを返す（読み取り専用コピー）
         * @returns {pc.Entity[]}
         */
        getEntities: function () {
            return _entities.slice();
        },

        /**
         * 最後に生成した Entity を返す
         * @returns {pc.Entity|null}
         */
        getCurrentEntity: function () {
            return _entities.length > 0 ? _entities[_entities.length - 1] : null;
        },

        /**
         * 指定した Entity（省略時は最後の Entity）の変換をリセットする
         * @param {pc.Entity} [entity]
         */
        resetTransform: function (entity) {
            var target = entity || this.getCurrentEntity();
            if (!target) {
                console.warn('[GSplatRenderer] resetTransform: 対象 Entity がありません。');
                return;
            }
            target.setLocalPosition(0, 0, 0);
            target.setLocalEulerAngles(-90, 0, 0);
            target.setLocalScale(1, 1, 1);
        },

        /**
         * 指定した Entity（省略時は最後の Entity）の座標系補正を切り替える
         * Nerfstudio 出力（-90°）か、そのまま（0°）かを切り替え
         * @param {boolean}    applyCorrection  true で Nerfstudio 補正を適用
         * @param {pc.Entity}  [entity]
         */
        setCoordinateCorrection: function (applyCorrection, entity) {
            var target = entity || this.getCurrentEntity();
            if (!target) return;
            target.setLocalEulerAngles(applyCorrection ? -90 : 0, 0, 0);
        }
    };

})();
