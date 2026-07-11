/**
 * vr-naiken platform worker
 *
 * ルート:
 *   GET  /p/{id}          物件ビューア配信（ビューアHTMLに OGP + window.__PROPERTY__ を注入）
 *   GET  /p/{id}/qr.svg   物件URLの QR コード（?s= で流入元を焼き込み。既定 "qr"）
 *   POST /api/e           閲覧イベント beacon（main.js から送信）
 *   *    /api/admin/...   物件・業者の CRUD と集計（Authorization: Bearer ADMIN_TOKEN）
 *
 * 設計: ビューア本体は静的（GitHub Pages）。この Worker は D1 を引いて
 * HTMLRewriter でメタ情報とシーン設定を注入するだけの薄い動的レイヤー。
 */
import QRCode from 'qrcode-svg';

// 紛らわしい文字 (l/1/o/0/i) を除いた ID 用アルファベット
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const EVENTS = new Set(['view', 'scene_loaded', 'scene_load_error', 'teleport_used', 'pano_entered']);

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function newId(len) {
    const buf = new Uint8Array(len || 8);
    crypto.getRandomValues(buf);
    let s = '';
    for (const b of buf) s += ID_ALPHABET[b % ID_ALPHABET.length];
    return s;
}

function json(data, status, extra) {
    return new Response(JSON.stringify(data, null, 2), {
        status: status || 200,
        headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, extra || {}),
    });
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// 掲載終了・未発行 ID 用の案内ページ（ビューアと同系の暗色トーン）
function infoPage(title, body, status) {
    const html =
        '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<meta name="robots" content="noindex">' +
        '<title>' + esc(title) + '</title>' +
        '<style>body{background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}' +
        '.card{max-width:420px;text-align:center;line-height:1.9}' +
        'h1{font-size:20px;margin-bottom:12px}p{color:#aaa;font-size:14px}</style></head>' +
        '<body><div class="card"><h1>' + esc(title) + '</h1><p>' + esc(body) + '</p></div></body></html>';
    return new Response(html, {
        status: status || 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

        let m;
        if ((m = path.match(/^\/p\/([a-z0-9-]{1,32})\/qr\.svg$/))) return qrSvg(m[1], url, env);
        if ((m = path.match(/^\/p\/([a-z0-9-]{1,32})\/?$/)))       return serveProperty(m[1], url, env);
        if (path === '/api/e' && request.method === 'POST')        return beacon(request, env);
        if (path.indexOf('/api/admin/') === 0)                     return admin(request, url, env);
        if (path === '/') return new Response('vr-naiken platform', { headers: { 'Content-Type': 'text/plain' } });
        return new Response('Not Found', { status: 404 });
    },
};

// ---- GET /p/{id} : 物件ビューア配信 ----
async function serveProperty(id, url, env) {
    const prop = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
    if (!prop || prop.status === 'deleted') {
        return infoPage('ページが見つかりません', 'URL をご確認ください。', 404);
    }
    const expired =
        prop.status !== 'active' ||
        (prop.expires_at && Date.parse(prop.expires_at + (prop.expires_at.length <= 10 ? 'T23:59:59+09:00' : '')) < Date.now());
    if (expired) {
        return infoPage('この物件の掲載は終了しました', 'お問い合わせは掲載元の不動産会社までお願いいたします。', 410);
    }

    // ビューア本体（静的）を取得。エッジで5分キャッシュ
    const viewerRes = await fetch(env.VIEWER_ORIGIN + '/index.html', {
        cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!viewerRes.ok) return infoPage('一時的に表示できません', '時間をおいて再度お試しください。', 502);

    const source  = (url.searchParams.get('s') || 'direct').slice(0, 24);
    const pageUrl = url.origin + '/p/' + prop.id;
    const title   = prop.title + ' | 3D内見';
    const desc    = prop.description ||
        '実際の部屋の中を自由に歩ける3D内見。アプリ不要、ブラウザだけでご覧いただけます。';
    const image   = prop.image_url || env.VIEWER_ORIGIN + '/assets/ogp.png';

    // main.js が読む物件設定。sceneUrl はサーバー管理値なので許可リスト検証済み扱い
    const config = {
        id:       prop.id,
        title:    prop.title,
        sceneUrl: prop.scene_url,
        source:   source,
        beacon:   url.origin + '/api/e',
    };

    const rewriter = new HTMLRewriter()
        .on('head', {
            element(el) {
                // 相対パス (src/, vendor/, assets/) をビューア配信元へ向ける
                el.prepend('<base href="' + esc(env.VIEWER_ORIGIN) + '/">', { html: true });
                el.append(
                    '<script>window.__PROPERTY__=' +
                        JSON.stringify(config).replace(/</g, '\\u003c') +
                        '</script>',
                    { html: true }
                );
            },
        })
        .on('title', { element(el) { el.setInnerContent(title); } })
        .on('meta[name="description"]',        { element(el) { el.setAttribute('content', desc); } })
        .on('meta[property="og:title"]',       { element(el) { el.setAttribute('content', title); } })
        .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', desc); } })
        .on('meta[property="og:url"]',         { element(el) { el.setAttribute('content', pageUrl); } })
        .on('meta[property="og:image"]',       { element(el) { el.setAttribute('content', image); } });

    const out = rewriter.transform(viewerRes);
    return new Response(out.body, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // 期限判定・差し替えを毎回効かせる（HTML は軽量。重い資産は base 先でキャッシュされる）
            'Cache-Control': 'no-store',
        },
    });
}

// ---- GET /p/{id}/qr.svg : QR コード ----
async function qrSvg(id, url, env) {
    const prop = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(id).first();
    if (!prop) return new Response('Not Found', { status: 404 });
    const s = (url.searchParams.get('s') || 'qr').slice(0, 24);
    const target = url.origin + '/p/' + prop.id + '?s=' + encodeURIComponent(s);
    const svg = new QRCode({
        content: target,
        padding: 2,
        width: 512,
        height: 512,
        ecl: 'M',
        join: true,
    }).svg();
    return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
    });
}

// ---- POST /api/e : 閲覧イベント beacon ----
async function beacon(request, env) {
    let data;
    try { data = await request.json(); } catch (e) { return json({ ok: false }, 400, CORS); }

    const p = String(data.p || '').slice(0, 32);
    const e = String(data.e || '');
    if (!p || !EVENTS.has(e)) return json({ ok: false }, 400, CORS);

    const exists = await env.DB.prepare('SELECT 1 AS x FROM properties WHERE id = ?').bind(p).first();
    if (!exists) return json({ ok: false }, 404, CORS);

    await env.DB.prepare(
        'INSERT INTO events (property_id, event, source, value, sid, ua) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
        p,
        e,
        String(data.s || '').slice(0, 24),
        typeof data.v === 'number' && isFinite(data.v) ? data.v : null,
        String(data.sid || '').slice(0, 16),
        (request.headers.get('User-Agent') || '').slice(0, 200)
    ).run();

    return json({ ok: true }, 200, CORS);
}

// ---- /api/admin/* : 管理 API（Bearer ADMIN_TOKEN） ----
async function admin(request, url, env) {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return json({ error: 'unauthorized' }, 401);
    }

    const path = url.pathname.replace(/\/$/, '');
    const method = request.method;
    let m;

    // 業者
    if (path === '/api/admin/orgs' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM orgs ORDER BY created_at DESC').all();
        return json(rows.results);
    }
    if (path === '/api/admin/orgs' && method === 'POST') {
        const b = await request.json();
        if (!b.name) return json({ error: 'name is required' }, 400);
        const id = b.id || newId(6);
        await env.DB.prepare('INSERT INTO orgs (id, name, plan, note) VALUES (?, ?, ?, ?)')
            .bind(id, String(b.name), String(b.plan || 'none'), String(b.note || '')).run();
        return json({ id: id }, 201);
    }

    // 物件一覧（閲覧数つき）
    if (path === '/api/admin/properties' && method === 'GET') {
        const rows = await env.DB.prepare(
            'SELECT p.*, o.name AS org_name, ' +
            "  (SELECT COUNT(*) FROM events e WHERE e.property_id = p.id AND e.event = 'view') AS views " +
            'FROM properties p LEFT JOIN orgs o ON o.id = p.org_id ' +
            "WHERE p.status != 'deleted' ORDER BY p.created_at DESC"
        ).all();
        return json(rows.results);
    }

    // 物件登録
    if (path === '/api/admin/properties' && method === 'POST') {
        const b = await request.json();
        if (!b.title || !b.scene_url) return json({ error: 'title and scene_url are required' }, 400);
        const id = b.id || newId(8);
        await env.DB.prepare(
            'INSERT INTO properties (id, org_id, title, description, scene_url, image_url, status, expires_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
            id,
            b.org_id || null,
            String(b.title),
            String(b.description || ''),
            String(b.scene_url),
            String(b.image_url || ''),
            String(b.status || 'active'),
            b.expires_at || null
        ).run();
        return json({ id: id, url: url.origin + '/p/' + id, qr: url.origin + '/p/' + id + '/qr.svg' }, 201);
    }

    // 物件詳細（経路別・日別の集計つき）
    if ((m = path.match(/^\/api\/admin\/properties\/([a-z0-9-]+)$/)) && method === 'GET') {
        const prop = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(m[1]).first();
        if (!prop) return json({ error: 'not found' }, 404);
        const bySource = await env.DB.prepare(
            "SELECT source, COUNT(*) AS views FROM events WHERE property_id = ? AND event = 'view' GROUP BY source ORDER BY views DESC"
        ).bind(m[1]).all();
        const byDay = await env.DB.prepare(
            "SELECT date(created_at) AS day, COUNT(*) AS views FROM events WHERE property_id = ? AND event = 'view' " +
            "GROUP BY day ORDER BY day DESC LIMIT 60"
        ).bind(m[1]).all();
        const loadMs = await env.DB.prepare(
            "SELECT ROUND(AVG(value)) AS avg_load_ms, COUNT(*) AS loads FROM events WHERE property_id = ? AND event = 'scene_loaded'"
        ).bind(m[1]).first();
        return json({ property: prop, views_by_source: bySource.results, views_by_day: byDay.results, load: loadMs });
    }

    // 物件更新（status / expires_at / title / description / image_url / scene_url / org_id）
    if ((m = path.match(/^\/api\/admin\/properties\/([a-z0-9-]+)$/)) && method === 'PATCH') {
        const b = await request.json();
        const allowed = ['title', 'description', 'scene_url', 'image_url', 'status', 'expires_at', 'org_id'];
        const sets = [];
        const vals = [];
        for (const k of allowed) {
            if (k in b) { sets.push(k + ' = ?'); vals.push(b[k] === null ? null : String(b[k])); }
        }
        if (!sets.length) return json({ error: 'no updatable fields' }, 400);
        sets.push("updated_at = datetime('now')");
        vals.push(m[1]);
        const r = await env.DB.prepare('UPDATE properties SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals).run();
        if (!r.meta.changes) return json({ error: 'not found' }, 404);
        return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
}
