/**
 * YummyAnime for Lampa v2.0.0 — redesign in the style of Apple TV
 * Каталог YummyAnime + серии в озвучке AniLibria (HLS 480/720/1080) через встроенный плеер Lampa.
 *
 * Источники:
 *  - YummyAnime API: https://api.yani.tv (запасной: https://old.yummyani.me/api)
 *  - AniLibria API v1: https://anilibria.top/api/v1
 *
 * Установка: Настройки -> Расширения -> Добавить плагин -> URL этого файла.
 */
(function () {
    'use strict';

    if (window.yummyanime_plugin) return;
    window.yummyanime_plugin = true;

    var VERSION = '2.0.0';
    var DEF_API = 'https://api.yani.tv';
    var FALLBACK_API = 'https://old.yummyani.me/api';
    var DEF_ANI = 'https://anilibria.top';
    var PAGE = 24, ROWN = 15;
    var RC_TTL = 15 * 60e3;
    var TTL = { catalog: 10 * 60e3, search: 10 * 60e3, detail: 60 * 60e3, videos: 30 * 60e3, release: 30 * 60e3 };

    /* ------------------------------------------------------------------ */
    /* Хранилище и настройки                                               */
    /* ------------------------------------------------------------------ */
    function S(k, d) { try { return Lampa.Storage.get(k, d); } catch (e) { return d; } }
    function W(k, v) { try { Lampa.Storage.set(k, v); } catch (e) {} }
    function apiBases() {
        var custom = String(S('yummy_api', '') || '').replace(/\/+$/, '');
        return custom ? [custom] : [DEF_API, FALLBACK_API];
    }
    function aniBase() { return (String(S('yummy_ani', '') || '') || DEF_ANI).replace(/\/+$/, ''); }
    function arr(k) { var v = S(k, []); return (v && v.length !== undefined) ? v : []; }

    /* ------------------------------------------------------------------ */
    /* Сеть + кэш                                                          */
    /* ------------------------------------------------------------------ */
    function request(url, ok, fail, headers) {
        var proxy = String(S('yummy_proxy', '') || '');
        var n = new Lampa.Reguest();
        n.timeout(15000);
        n.silent(proxy + url, function (j) { ok(j); }, function (a, c) { fail && fail(a, c); }, false, headers ? { headers: headers } : {});
    }

    var mem = {}, pend = {};
    function cached(key, ttl, load, ok, fail) {
        var c = mem[key];
        if (c && Date.now() - c.t < ttl) return ok(c.v);
        if (pend[key]) return pend[key].push([ok, fail]);
        pend[key] = [[ok, fail]];
        load(function (v) {
            mem[key] = { t: Date.now(), v: v };
            var q = pend[key]; delete pend[key];
            q.forEach(function (p) { p[0](v); });
        }, function (e) {
            var q = pend[key]; delete pend[key];
            q.forEach(function (p) { p[1] && p[1](e); });
        });
    }

    /* YummyAnime */
    function yGet(path, ok, fail) {
        var bases = apiBases(), token = String(S('yummy_token', '') || ''), i = 0;
        var headers = { 'Accept-Language': String(S('yummy_lang', 'ru') || 'ru') };
        if (token) headers['X-Application'] = token;
        (function next() {
            if (i >= bases.length) return fail && fail();
            request(bases[i++] + path, function (j) {
                ok(j && j.response !== undefined ? j.response : j);
            }, next, headers);
        })();
    }
    function yCatalog(page, ok, fail) {
        cached('yc:' + page, TTL.catalog, function (o, f) {
            yGet('/anime?limit=' + PAGE + '&offset=' + ((page - 1) * PAGE), o, f);
        }, ok, fail);
    }
    function yQuery(qs, ok, fail) {
        cached('yq:' + qs, TTL.catalog, function (o, f) { yGet('/anime?limit=' + ROWN + '&' + qs, o, f); }, ok, fail);
    }
    function ySearch(q, ok, fail) {
        cached('ys:' + q, TTL.search, function (o, f) {
            yGet('/search?q=' + encodeURIComponent(q) + '&limit=' + PAGE, o, f);
        }, ok, fail);
    }
    function yDetail(id, ok, fail) {
        cached('yd:' + id, TTL.detail, function (o, f) { yGet('/anime/' + encodeURIComponent(id), o, f); }, ok, fail);
    }
    function yVideos(id, ok, fail) {
        cached('yv:' + id, TTL.videos, function (o, f) { yGet('/anime/' + encodeURIComponent(id) + '/videos', o, f); }, ok, fail);
    }

    /* AniLibria */
    function aGet(path, ok, fail) { request(aniBase() + '/api/v1' + path, ok, fail); }
    function aCached(path, ttl, ok, fail) {
        cached('ag:' + path, ttl, function (o, f) { aGet(path, o, f); }, ok, fail);
    }
    function aSearch(q, ok, fail) {
        cached('as:' + q, TTL.search, function (o, f) {
            aGet('/app/search/releases?query=' + encodeURIComponent(q), o, f);
        }, ok, fail);
    }
    function aCatalog(page, ok, fail) {
        cached('ac:' + page, TTL.catalog, function (o, f) {
            aGet('/anime/catalog/releases?page=' + page + '&limit=' + PAGE, o, f);
        }, ok, fail);
    }
    function aRelease(id, ok, fail) {
        cached('ar:' + id, TTL.release, function (o, f) { aGet('/anime/releases/' + encodeURIComponent(id), o, f); }, ok, fail);
    }

    /* ------------------------------------------------------------------ */
    /* Нормализация данных                                                 */
    /* ------------------------------------------------------------------ */
    function esc(s) { return String(s == null ? '' : s); }
    function fixUrl(u, base) {
        u = esc(u);
        if (!u) return '';
        if (u.indexOf('//') === 0) return 'https:' + u;
        if (u.charAt(0) === '/') return (base || '') + u;
        return u;
    }
    function posterOf(p) {
        if (!p) return '';
        if (typeof p === 'string') return fixUrl(p, 'https://yummyani.me');
        return fixUrl(p.big || p.medium || p.small || p.fullsize || p.mega || '', 'https://yummyani.me');
    }
    function uniq(list) {
        var seen = {}, out = [];
        list.forEach(function (t) {
            var k = norm(t);
            if (k && !seen[k]) { seen[k] = 1; out.push(esc(t)); }
        });
        return out;
    }
    function collectTitles(v, out) {
        if (!v) return;
        if (typeof v === 'string') out.push(v);
        else if (v.length !== undefined) v.forEach(function (x) { collectTitles(x, out); });
        else if (typeof v === 'object') {
            if (v.title) out.push(v.title);
            else Object.keys(v).forEach(function (k) { collectTitles(v[k], out); });
        }
    }
    function mapY(a) {
        if (!a) return null;
        var id = a.anime_id || a.id;
        if (!id) return null;
        var titles = [];
        collectTitles(a.title, titles);
        collectTitles(a.original_title, titles);
        collectTitles(a.other_titles, titles);
        collectTitles(a.alt_titles, titles);
        var genres = (a.genres || []).map(function (g) { return g && (g.title || g.name) || g; }).filter(Boolean);
        var st = a.anime_status || a.status;
        var rating = a.rating && (a.rating.average || a.rating.value);
        return {
            id: id,
            title: esc(a.title),
            year: parseInt(a.year, 10) || 0,
            type: esc(a.type && (a.type.name || a.type.shortname) || ''),
            status: esc(st && (st.title || st.name) || (typeof st === 'string' ? st : '')),
            poster: posterOf(a.poster),
            desc: esc(a.description).replace(/<[^>]+>/g, ''),
            genres: genres,
            rating: rating ? Number(rating).toFixed(1) : '',
            eps: a.episodes ? { count: a.episodes.count || 0, aired: a.episodes.aired || 0 } : null,
            titles: uniq(titles)
        };
    }
    function mapA(r) {
        var rel = mapRel(r);
        if (!rel || !rel.id) return null;
        return {
            id: 'a:' + rel.id, title: rel.ru || rel.en, year: rel.year, type: rel.type, status: '', poster: rel.poster,
            desc: rel.desc, genres: rel.genres, rating: '', age: rel.age, eps: rel.total ? { count: rel.total, aired: 0 } : null,
            titles: uniq([rel.ru, rel.en])
        };
    }
    function isAniId(id) { return String(id).indexOf('a:') === 0; }
    function srcAni() { return String(S('yummy_source', 'ani') || 'ani') !== 'yummy'; }
    function mergeY(a, b) {
        if (!b) return a;
        var o = {};
        Object.keys(a).forEach(function (k) { o[k] = a[k]; });
        Object.keys(b).forEach(function (k) {
            var v = b[k];
            if (v && !(v.length === 0)) o[k] = v;
        });
        o.titles = uniq((a.titles || []).concat(b.titles || []));
        return o;
    }
    function mapEp(e) {
        var q = {};
        if (e.hls_1080) q['1080'] = e.hls_1080;
        if (e.hls_720) q['720'] = e.hls_720;
        if (e.hls_480) q['480'] = e.hls_480;
        var pv = e.preview;
        var img = pv ? fixUrl(typeof pv === 'string' ? pv : (pv.src || pv.preview || pv.thumbnail || ''), aniBase()) : '';
        return { num: String(e.ordinal), id: e.id, name: esc(e.name), q: q, img: img };
    }
    function mapRel(r) {
        if (!r) return null;
        var out = {
            id: r.id, alias: r.alias,
            ru: esc(r.name && r.name.main), en: esc(r.name && r.name.english),
            year: parseInt(r.year, 10) || 0,
            total: r.episodes_total || 0,
            age: esc(r.age_rating && (r.age_rating.label || r.age_rating.value) || ''),
            desc: esc(r.description).replace(/<[^>]+>/g, ''),
            genres: (r.genres || []).map(function (g) { return g && (g.name || g.title) || g; }).filter(Boolean),
            type: esc(r.type && (r.type.description || r.type.value) || ''),
            poster: r.poster ? fixUrl(r.poster.src || r.poster.preview || r.poster.thumbnail || '', aniBase()) : '',
            episodes: (r.episodes || []).map(mapEp)
        };
        out.episodes.sort(function (a, b) { return parseFloat(a.num) - parseFloat(b.num); });
        return out;
    }
    // достаёт релизы AniLibria из любого ответа (список, {data:[]}, расписание {release:{}})
    function flatRel(v, out, seen, d) {
        out = out || []; seen = seen || {}; d = d || 0;
        if (!v || typeof v !== 'object' || d > 5) return out;
        if (v.length !== undefined) { v.forEach(function (x) { flatRel(x, out, seen, d + 1); }); return out; }
        var r = (v.release && v.release.id) ? v.release : ((v.id && v.name && v.name.main) ? v : null);
        if (r) { if (!seen[r.id]) { seen[r.id] = 1; out.push(r); } return out; }
        Object.keys(v).forEach(function (k) { flatRel(v[k], out, seen, d + 1); });
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* Сопоставление YummyAnime -> AniLibria                               */
    /* ------------------------------------------------------------------ */
    function norm(s) {
        return esc(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function sim(a, b) {
        a = norm(a); b = norm(b);
        if (!a || !b) return 0;
        if (a === b) return 1;
        var ta = a.split(' '), tb = b.split(' '), set = {}, inter = 0;
        tb.forEach(function (t) { set[t] = 1; });
        ta.forEach(function (t) { if (set[t]) inter++; });
        var jac = inter / (ta.length + tb.length - inter);
        var dice = 2 * inter / (ta.length + tb.length);
        var cont = (a.indexOf(b) > -1 || b.indexOf(a) > -1) ? 0.15 : 0;
        return Math.min(0.99, Math.max(jac, dice) + cont);
    }
    function seasonOf(s) {
        s = esc(s).toLowerCase();
        var m = s.match(/(?:season|сезон)\s*(\d+)|(\d+)(?:st|nd|rd|th)?\s*(?:season|сезон)|\s(\d)$/);
        return m ? parseInt(m[1] || m[2] || m[3], 10) : 0;
    }
    function baseTitle(s) {
        return esc(s).replace(/(?:season|сезон)\s*\d+/ig, '').replace(/\d+(?:st|nd|rd|th)?\s*(?:season|сезон)/ig, '')
            .replace(/\s+\d$/, '').replace(/[:\-–\s]+$/, '').replace(/\s+/g, ' ').trim();
    }
    function score(y, r) {
        var names = [r.ru, r.en], best = 0;
        (y.titles && y.titles.length ? y.titles : [y.title]).forEach(function (t) {
            names.forEach(function (n) { best = Math.max(best, sim(t, n), sim(baseTitle(t), baseTitle(n))); });
        });
        var s = best;
        var ys = 0, rs = Math.max(seasonOf(r.ru), seasonOf(r.en));
        (y.titles || [y.title]).forEach(function (t) { ys = ys || seasonOf(t); });
        if (ys && rs) s += ys === rs ? 0.1 : -0.15;
        if (y.year && r.year) {
            var d = Math.abs(y.year - r.year);
            if (d === 0) s += 0.12; else if (d > 1) s -= 0.3;
        }
        var yc = y.eps && (y.eps.count || y.eps.aired);
        if (yc && r.total && Number(yc) === Number(r.total)) s += 0.08;
        return s;
    }
    function pickQueries(y) {
        var raw = uniq([y.title].concat(y.titles || []));
        var all = uniq(raw.map(baseTitle).concat(raw));
        var latin = all.filter(function (t) { return /[a-z]/i.test(t) && !/[а-яё]/i.test(t); });
        var rest = all.filter(function (t) { return latin.indexOf(t) === -1; });
        return uniq([rest[0] || all[0]].concat(latin.slice(0, 3), rest.slice(1, 2))).slice(0, 5);
    }
    // cb(err, sortedCandidates[{rel, score}])
    function findReleases(y, cb) {
        var qs = pickQueries(y), i = 0, found = {}, okCount = 0, finished = false;
        function done() {
            if (finished) return; finished = true;
            if (!okCount) return cb(true, []);
            var list = Object.keys(found).map(function (k) { return found[k]; });
            list.sort(function (a, b) { return b.score - a.score; });
            cb(false, list);
        }
        (function next() {
            if (finished) return;
            if (i >= qs.length) return done();
            aSearch(qs[i++], function (res) {
                okCount++;
                var items = res && res.length !== undefined ? res : (res && res.data) || [];
                items.forEach(function (r) {
                    var rel = mapRel(r);
                    if (rel && rel.id && !found[rel.id]) found[rel.id] = { rel: rel, score: score(y, rel) };
                });
                var top = 0;
                Object.keys(found).forEach(function (k) { top = Math.max(top, found[k].score); });
                if (top >= 1) return done();
                next();
            }, next);
        })();
    }
    function autoPick(list) {
        if (!list.length) return null;
        var b = list[0], s = list[1];
        if (b.score >= 1) return b;
        if (b.score >= 0.7 && (!s || b.score - s.score >= 0.1)) return b;
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* Качество / плейлист                                                 */
    /* ------------------------------------------------------------------ */
    function pickUrl(q) {
        var order = ['1080', '720', '480'];
        var pref = String(S('yummy_quality', '1080') || '1080');
        var start = Math.max(0, order.indexOf(pref));
        for (var i = start; i < order.length; i++) if (q[order[i]]) return q[order[i]];
        for (var j = start - 1; j >= 0; j--) if (q[order[j]]) return q[order[j]];
        return '';
    }
    function qualityMap(q) {
        var m = {};
        ['1080', '720', '480'].forEach(function (k) { if (q[k]) m[k + 'p'] = q[k]; });
        return m;
    }
    function hashOf(yid, num) { return Lampa.Utils.hash('yummy:' + yid + ':' + num); }
    function pct(yid, num) {
        var tl = Lampa.Timeline.view(hashOf(yid, num));
        return Math.min(100, Math.round(tl && tl.percent || 0));
    }

    /* ------------------------------------------------------------------ */
    /* Избранное / история                                                 */
    /* ------------------------------------------------------------------ */
    function compact(y) { return { id: y.id, title: y.title, year: y.year, type: y.type, poster: y.poster }; }
    function isFav(id) { return arr('yummy_fav').some(function (x) { return x.id === id; }); }
    function toggleFav(y) {
        var list = arr('yummy_fav'), had = false;
        list = list.filter(function (x) { if (x.id === y.id) { had = true; return false; } return true; });
        if (!had) list.unshift(compact(y));
        W('yummy_fav', list);
        return !had;
    }
    function histGet(id) { var l = arr('yummy_hist'); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function histSave(y, num, img) {
        var old = histGet(y.id);
        var list = arr('yummy_hist').filter(function (x) { return x.id !== y.id; });
        var h = compact(y); h.ep = num; h.ts = Date.now(); h.img = img || (old && old.ep === num && old.img) || '';
        list.unshift(h);
        W('yummy_hist', list.slice(0, 100));
    }
    function matchGet(id) { var m = S('yummy_match', {}); return m && m[id]; }
    function matchSet(id, relId) { var m = S('yummy_match', {}) || {}; m[id] = relId; W('yummy_match', m); }

    /* кэш строк главного экрана (в хранилище, чтобы главная открывалась мгновенно) */
    function trimItem(it) {
        return { id: it.id, title: it.title, year: it.year, type: it.type, poster: it.poster, desc: (it.desc || '').slice(0, 320),
            genres: (it.genres || []).slice(0, 3), rating: it.rating, age: it.age, eps: it.eps };
    }
    function rcGet(k) { var m = S('yummy_rc', {}); return m && m[k]; }
    function rcSet(k, list) { var m = S('yummy_rc', {}) || {}; m[k] = { t: Date.now(), list: list.map(trimItem) }; W('yummy_rc', m); }

    /* ------------------------------------------------------------------ */
    /* Подборки главного экрана                                            */
    /* ------------------------------------------------------------------ */
    var ROWS = [['hist', 'Продолжить просмотр'], ['pop', 'Популярное аниме'], ['new', 'Новинки'], ['air', 'Сейчас выходит'], ['rec', 'Рекомендуем'], ['upd', 'Последние обновления']];

    function aniTries(k) {
        var L = ROWN, c = '/anime/catalog/releases?limit=' + L + '&page=1';
        function p(path) { return function (ok, fail) { aCached(path, TTL.catalog, ok, fail); }; }
        var by = function (s) { return p(c + '&f%5Bsorting%5D=' + s); };
        var plain = function (page) { return function (ok, fail) { aCatalog(page, ok, fail); }; };
        if (k === 'pop') return [by('RATING_DESC'), plain(1)];
        if (k === 'new') return [by('YEAR_DESC'), plain(2)];
        if (k === 'air') return [p('/anime/schedule/now'), p(c + '&f%5BpublishStatuses%5D=IS_ONGOING')];
        if (k === 'rec') return [p('/anime/releases/recommended?limit=' + L), plain(3)];
        return [p('/anime/releases/latest?limit=' + L), by('FRESH_AT_DESC')];
    }
    function yTries(k) {
        var plain = function (page) { return function (ok, fail) { yCatalog(page, ok, fail); }; };
        var q = function (s) { return function (ok, fail) { yQuery(s, ok, fail); }; };
        if (k === 'pop') return [q('sort=rating&sort_forward=false'), plain(1)];
        if (k === 'new') return [q('sort=year&sort_forward=false'), plain(2)];
        if (k === 'air') return [q('anime_status=ongoing')];
        if (k === 'rec') return [q('sort=views&sort_forward=false'), plain(3)];
        return [plain(1)];
    }
    function rowFetch(ani, k, ok, fail) {
        var tries = ani ? aniTries(k) : yTries(k), i = 0;
        (function next() {
            if (i >= tries.length) return fail();
            tries[i++](function (res) {
                var list = ani ? flatRel(res).map(mapA) : (res && res.length !== undefined ? res : (res && res.data) || []).map(mapY);
                list = list.filter(Boolean).slice(0, ROWN);
                if (list.length) ok(list); else next();
            }, next);
        })();
    }

    /* ------------------------------------------------------------------ */
    /* Компонент                                                           */
    /* ------------------------------------------------------------------ */
    var PLAY = '<span class="yummy-ico-play"></span>';

    function Component(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var root = $('<div class="yummy"></div>');
        var last = false, destroyed = false, timer = 0, gen = 0;
        var rowScroll = {}, HM = {}, lastTop = null, q = [], qt = 0;
        var mode = object.mode || 'home';
        if (String(S('yummy_glass', 'off')) === 'off') root.addClass('yummy--flat');

        function loadHM() { HM = {}; arr('yummy_hist').forEach(function (h) { HM[h.id] = h; }); }
        function sel(el, rs, wrap, top) {
            el.on('hover:focus', function (e) {
                last = e.target;
                if (rs) rs.update($(e.target), true);
                var key = top || wrap;
                if (key) { if (key !== lastTop) { lastTop = key; scroll.update(key, true); } }
                else { lastTop = null; scroll.update($(e.target), true); }
            });
            return el;
        }
        function kill(rs) { try { rs && rs.destroy(); } catch (e) {} }
        function msg(text, retry, retryLabel) {
            var box = $('<div class="yummy-msg yummy-glass"></div>');
            box.append($('<div class="yummy-msg__text"></div>').text(text));
            if (retry) {
                var b = sel($('<div class="yummy-btn yummy-btn--glass selector"></div>').text(retryLabel || 'Повторить'));
                b.on('hover:enter', retry);
                box.append(b);
            }
            return box;
        }
        function doRefresh() {
            if (destroyed) return;
            if (last && !$.contains(document.documentElement, last)) last = false;
            self.activity.loader(false);
            var act = Lampa.Activity.active();
            if (act && act.activity === self.activity) {
                Lampa.Controller.collectionSet(scroll.render());
                Lampa.Controller.collectionFocus(last || false, scroll.render());
                Lampa.Controller.toggle('content');
            }
        }
        function refresh(now) { clearTimeout(timer); if (now) doRefresh(); else timer = setTimeout(doRefresh, 90); }
        function openTitle(item, auto) {
            Lampa.Activity.push({ url: '', title: item.title, component: 'yummy_anime', mode: 'title', item: item, autoplay: !!auto, page: 1 });
        }
        function focusTab() {
            if (!barEl) return false;
            var el = barEl.find('.yummy-tab--active')[0] || barEl.find('.yummy-tab')[0];
            if (!el) return false;
            Lampa.Controller.collectionFocus(el, scroll.render());
            return true;
        }
        function outsideBar() { return mode === 'home' && barEl && last && !$.contains(barEl[0], last); }
        function chip(t, active) {
            return $('<div class="yummy-chip selector"></div>').text(t).toggleClass('yummy-chip--on', !!active);
        }

        /* ---------- карточка ---------- */
        function card(item, o) {
            o = o || {};
            var h = HM[item.id];
            var sub = o.sub !== undefined ? o.sub : [item.year || '', item.type].filter(Boolean).join(' • ');
            var c = $('<div class="yummy-card selector"><div class="yummy-card__img"></div><div class="yummy-card__title"></div><div class="yummy-card__sub"></div></div>');
            var img = c.find('.yummy-card__img');
            if (item.poster) img.css('background-image', 'url("' + item.poster + '")');
            c.find('.yummy-card__title').text(item.title);
            c.find('.yummy-card__sub').text(sub);
            if (h) {
                img.append($('<div class="yummy-badge yummy-glass"></div>').text('Серия ' + h.ep));
                var p = pct(item.id, h.ep);
                if (p > 0) img.append($('<div class="yummy-bar"><i></i></div>').find('i').css('width', p + '%').end());
            }
            sel(c, o.rs, o.wrap);
            c.on('hover:enter', function () { openTitle(compact(item)); });
            return c;
        }

        function epCard(item, o) {
            var t = $('<div class="yummy-ep selector"><div class="yummy-ep__img"><div class="yummy-badge yummy-glass"></div></div><div class="yummy-ep__name"></div><div class="yummy-ep__q"></div></div>');
            var im = t.find('.yummy-ep__img'), p = pct(item.id, item.ep);
            var src = item.img || item.poster;
            if (src) im.css('background-image', 'url("' + src + '")');
            if (!item.img) im.addClass('yummy-ep__img--poster');
            t.find('.yummy-badge').text('Серия ' + item.ep);
            if (p > 0) im.append($('<div class="yummy-bar"><i></i></div>').find('i').css('width', Math.min(p, 100) + '%').end());
            t.find('.yummy-ep__name').text(item.title);
            t.find('.yummy-ep__q').text(p >= 90 ? 'Просмотрено · дальше' : (p > 0 ? 'Продолжить · ' + p + '%' : 'Серия ' + item.ep));
            sel(t, o.rs, o.wrap);
            t.on('hover:enter', function () { openTitle(compact(item), true); });
            return t;
        }

        /* ============================ HOME ============================= */
        var topEl, barEl, heroWrap, rowsEl, gridEl, state = { page: 0, loading: false, ended: false };
        var TABS = [['home', 'Главная'], ['catalog', 'Каталог'], ['search', 'Поиск'], ['fav', 'Избранное'], ['hist', 'История']];

        function buildHome() {
            object.tab = object.tab || 'home';
            topEl = $('<div class="yummy-top"></div>');
            barEl = $('<div class="yummy-bar-top"></div>');
            barEl.append('<div class="yummy-hello"><span class="yummy-hello__a">Добро пожаловать в мир аниме,</span><span class="yummy-hello__b"><i>господин Санжар</i></span></div>');
            var tabs = $('<div class="yummy-tabs"></div>');
            TABS.forEach(function (t) {
                var el = sel($('<div class="yummy-tab yummy-glass selector"></div>').text(t[1]).attr('data-tab', t[0]), null, null, topEl);
                el.on('hover:enter', function () { switchTab(t[0]); });
                tabs.append(el);
            });
            barEl.append(tabs);
            heroWrap = $('<div class="yummy-herowrap"></div>');
            topEl.append(barEl).append(heroWrap);
            rowsEl = $('<div class="yummy-rows"></div>');
            gridEl = $('<div class="yummy-grid"></div>');
            scroll.append(topEl);
            scroll.append(rowsEl);
            scroll.append(gridEl);
            scroll.onEnd = function () { if (object.tab === 'catalog' || object.tab === 'search') loadMore(); };
            switchTab(object.tab, true);
        }
        function markTabs() {
            barEl.find('.yummy-tab').each(function () {
                $(this).toggleClass('yummy-tab--active', $(this).attr('data-tab') === object.tab);
            });
        }
        function enqueue(fn) { q.push(fn); if (!qt) qt = setTimeout(pump, 0); }
        function pump() { qt = 0; var f = q.shift(); if (f && !destroyed) f(); if (q.length) qt = setTimeout(pump, 130); }
        function clearRows() {
            q = []; clearTimeout(qt); qt = 0; lastTop = null;
            Object.keys(rowScroll).forEach(function (k) { kill(rowScroll[k]); });
            rowScroll = {};
        }
        function switchTab(tab, initial) {
            object.tab = tab;
            gen++;
            markTabs();
            clearRows();
            gridEl.empty(); rowsEl.empty(); heroWrap.empty();
            last = false;
            try { scroll.reset && scroll.reset(); } catch (e) {}
            state = { page: 0, loading: false, ended: false };
            loadHM();
            if (tab === 'home') buildRows();
            else if (tab === 'catalog') loadMore();
            else if (tab === 'search') {
                if (object.query) { searchHeader(); loadMore(); }
                else askQuery();
            }
            else if (tab === 'fav') renderStored(arr('yummy_fav'), 'Избранное пусто. Добавляйте тайтлы кнопкой на странице аниме.');
            else if (tab === 'hist') renderStored(arr('yummy_hist'), 'История пуста.', function (x) { return 'Серия ' + x.ep; });
        }

        /* --- главная: Hero + подборки --- */
        var rowEls = {}, heroDone = false, pending = 0, shown = 0;
        function buildRows() {
            heroDone = false; pending = 0; shown = 0;
            heroWrap.append('<div class="yummy-hero yummy-hero--ghost"></div>');
            ROWS.forEach(function (r) {
                rowEls[r[0]] = $('<div class="yummy-row"></div>').hide();
                rowsEl.append(rowEls[r[0]]);
            });
            renderHist();
            var ani = srcAni(), g = gen;
            ROWS.slice(1).forEach(function (r) { pending++; loadRow(ani, r, g); });
        }
        function loadRow(ani, r, g) {
            var key = r[0], ck = (ani ? 'a' : 'y') + ':' + key, c = rcGet(ck);
            if (c && c.list && c.list.length && Date.now() - c.t < RC_TTL) return showRow(r, c.list, g);
            rowFetch(ani, key, function (list) {
                rcSet(ck, list);
                showRow(r, list, g);
            }, function () {
                if (c && c.list && c.list.length) return showRow(r, c.list, g);
                showRow(r, [], g);
            });
        }
        function showRow(r, list, g) {
            if (destroyed || g !== gen) return;
            pending--;
            if (list.length) {
                shown++;
                if (!heroDone) { heroDone = true; renderHero(list); }
                enqueue(function () { if (g === gen && !destroyed) { fillRow(r[0], r[1], list); refresh(); } });
            }
            if (!pending && !shown && !arr('yummy_hist').length) {
                heroWrap.empty();
                rowsEl.append(msg('Не удалось загрузить подборки (' + (srcAni() ? 'AniLibria' : 'YummyAnime') + '). Проверьте сеть или смените источник в настройках плагина.', function () { switchTab('home'); }));
            }
            refresh();
        }
        function fillRow(key, title, list, mk) {
            var wrap = rowEls[key];
            kill(rowScroll[key]);
            var rs = new Lampa.Scroll({ horizontal: true, step: 300 });
            rowScroll[key] = rs;
            wrap.empty().append($('<div class="yummy-row__t"></div>').text(title));
            list.forEach(function (it) { rs.append((mk || card)(it, { rs: rs, wrap: wrap })); });
            wrap.append(rs.render()).show();
        }
        function renderHist() {
            var h = arr('yummy_hist').slice(0, ROWN);
            if (!h.length) { kill(rowScroll.hist); delete rowScroll.hist; rowEls.hist && rowEls.hist.empty().hide(); return; }
            loadHM();
            fillRow('hist', ROWS[0][1], h, epCard);
        }
        function heroBtns(el, item) {
            var play = sel($('<div class="yummy-btn yummy-btn--main selector"></div>').html(PLAY + 'Смотреть'), null, null, topEl);
            play.on('hover:enter', function () { openTitle(compact(item), true); });
            var fav = sel($('<div class="yummy-btn yummy-btn--glass yummy-glass selector"></div>'), null, null, topEl);
            function lab() { fav.text(isFav(item.id) ? '✓ В избранном' : '+ В избранное'); }
            lab();
            fav.on('hover:enter', function () {
                var on = toggleFav(item);
                Lampa.Noty.show(on ? 'Добавлено в избранное' : 'Убрано из избранного');
                lab();
            });
            el.append(play).append(fav);
        }
        function renderHero(list) {
            var pool = list.filter(function (i) { return i.poster; }).slice(0, 5);
            if (!pool.length) { heroWrap.empty(); return; }
            var it = pool[Math.floor(Math.random() * pool.length)];
            var el = $('<div class="yummy-hero"><div class="yummy-hero__bg"></div><div class="yummy-hero__sh"></div><div class="yummy-hero__poster"></div><div class="yummy-hero__body"><div class="yummy-hero__kick">Рекомендуем</div><div class="yummy-hero__title"></div><div class="yummy-chips"></div><div class="yummy-hero__desc"></div><div class="yummy-hero__btns"></div></div></div>');
            el.find('.yummy-hero__bg,.yummy-hero__poster').css('background-image', 'url("' + it.poster + '")');
            el.find('.yummy-hero__title').text(it.title);
            var chips = el.find('.yummy-chips');
            var meta = [it.year || '', (it.genres || []).slice(0, 2).join(', '), it.rating ? '★ ' + it.rating : '', it.age, it.eps && (it.eps.count || it.eps.aired) ? (it.eps.count || it.eps.aired) + ' эп.' : ''].filter(Boolean);
            meta.forEach(function (m) { chips.append($('<span class="yummy-pill yummy-glass"></span>').text(m)); });
            el.find('.yummy-hero__desc').text(it.desc || '');
            heroBtns(el.find('.yummy-hero__btns'), it);
            heroWrap.empty().append(el);
        }

        /* --- списки / поиск / каталог --- */
        function renderStored(list, emptyText, subFn) {
            gridEl.empty();
            if (!list.length) gridEl.append(msg(emptyText));
            list.forEach(function (x) { gridEl.append(card(x, { sub: subFn ? subFn(x) : '' })); });
            refresh(true);
        }
        function searchHeader() {
            var b = sel($('<div class="yummy-btn yummy-btn--glass yummy-glass yummy-btn--wide selector"></div>').text('Запрос: «' + object.query + '» — изменить'));
            b.on('hover:enter', askQuery);
            gridEl.empty().append($('<div class="yummy-wide"></div>').append(b));
        }
        function askQuery() {
            Lampa.Input.edit({ free: true, title: 'Поиск аниме', nosave: true, value: object.query || '' }, function (val) {
                Lampa.Controller.toggle('content');
                val = esc(val).trim();
                if (!val) return refresh(true);
                object.query = val;
                state = { page: 0, loading: false, ended: false };
                searchHeader();
                loadMore();
            });
        }
        function loadMore() {
            if (state.loading || state.ended) return;
            state.loading = true;
            var page = state.page + 1, tab = object.tab;
            if (page === 1) self.activity.loader(true);
            var ani = srcAni();
            var fn = tab === 'search' ? function (ok, fail) { if (ani) aSearch(object.query, ok, fail); else ySearch(object.query, ok, fail); }
                : function (ok, fail) { if (ani) aCatalog(page, ok, fail); else yCatalog(page, ok, fail); };
            fn(function (res) {
                if (destroyed || tab !== object.tab) return;
                state.loading = false;
                var list = (res && res.length !== undefined ? res : (res && res.data) || []).map(ani ? mapA : mapY).filter(Boolean);
                if (tab === 'search') state.ended = true;
                if (!list.length) {
                    state.ended = true;
                    if (page === 1) gridEl.append(msg('Ничего не найдено.'));
                } else {
                    state.page = page;
                    if (list.length < PAGE && tab === 'catalog') state.ended = true;
                    list.forEach(function (it) { gridEl.append(card(it)); });
                }
                refresh();
            }, function () {
                if (destroyed || tab !== object.tab) return;
                state.loading = false;
                gridEl.append(msg('Не удалось загрузить каталог (' + (ani ? 'AniLibria' : 'YummyAnime') + '). Проверьте сеть или смените источник в настройках плагина.', function () {
                    gridEl.find('.yummy-msg').remove();
                    loadMore();
                }));
                refresh();
            });
        }

        /* ============================ TITLE ============================ */
        var T = { y: null, rel: null, yeps: null, cands: [], status: 'matching', played: false, fr: null };
        var titleEl, headEl, voiceEl, seasonEl, epsEl, btnPlay, btnFav, auto = false;

        function buildTitle() {
            T.y = object.item;
            auto = !!object.autoplay;
            titleEl = $('<div class="yummy-title"><div class="yummy-title__bg"></div><div class="yummy-title__sh"></div></div>');
            headEl = $('<div class="yummy-head"></div>');
            titleEl.append(headEl);
            voiceEl = $('<div class="yummy-block"></div>');
            seasonEl = $('<div class="yummy-row"></div>');
            epsEl = $('<div class="yummy-row"></div>');
            scroll.append(titleEl);
            scroll.append(voiceEl);
            scroll.append(seasonEl);
            scroll.append(epsEl);
            renderHead();
            self.activity.loader(true);
            if (isAniId(T.y.id)) return startMatch();
            yDetail(T.y.id, function (d) {
                if (destroyed) return;
                T.y = mergeY(T.y, mapY(d));
                renderHead(); startMatch();
            }, function () {
                if (destroyed) return;
                startMatch();
            });
            yVideos(T.y.id, function (v) {
                if (destroyed) return;
                var nums = {};
                (v && v.length !== undefined ? v : []).forEach(function (x) { if (x && x.number != null) nums[String(x.number)] = 1; });
                T.yeps = Object.keys(nums);
                renderBlocks();
            }, function () { T.yeps = []; });
        }
        function renderHead() {
            var y = T.y;
            headEl.empty();
            titleEl.find('.yummy-title__bg').css('background-image', y.poster ? 'url("' + y.poster + '")' : 'none');
            var n = y.eps && (y.eps.aired || y.eps.count) || (T.rel && T.rel.total) || 0;
            var meta = [y.year || '', (y.genres || []).slice(0, 2).join(', '), n ? n + ' эп.' : '', y.rating ? '★ ' + y.rating : '', y.age || (T.rel && T.rel.age) || ''].filter(Boolean);
            var el = $('<div class="yummy-info"><div class="yummy-info__poster"></div><div class="yummy-info__body"><div class="yummy-info__title"></div><div class="yummy-chips"></div><div class="yummy-info__desc"></div><div class="yummy-info__btns"></div></div></div>');
            if (y.poster) el.find('.yummy-info__poster').css('background-image', 'url("' + y.poster + '")');
            el.find('.yummy-info__title').text(y.title);
            var chips = el.find('.yummy-chips');
            meta.forEach(function (m) { chips.append($('<span class="yummy-pill yummy-glass"></span>').text(m)); });
            el.find('.yummy-info__desc').text(y.desc || '');
            btnPlay = sel($('<div class="yummy-btn yummy-btn--main selector"></div>'), null, null, titleEl);
            btnPlay.on('hover:enter', function () { var k = continueNum(); if (k) play(k); else Lampa.Noty.show('Нет доступных серий'); });
            btnFav = sel($('<div class="yummy-btn yummy-btn--glass yummy-glass selector"></div>'), null, null, titleEl);
            btnFav.on('hover:enter', function () {
                var on = toggleFav(T.y);
                Lampa.Noty.show(on ? 'Добавлено в избранное' : 'Убрано из избранного');
                updateButtons();
            });
            el.find('.yummy-info__btns').append(btnPlay).append(btnFav);
            headEl.append(el);
            updateButtons();
            refresh();
        }
        function playable(e) { return e && pickUrl(e.q); }
        function epByNum(num) { var l = T.rel ? T.rel.episodes : []; for (var i = 0; i < l.length; i++) if (l[i].num === String(num)) return l[i]; return null; }
        function lastWatched(eps) {
            var idx = -1, p = 0;
            eps.forEach(function (e, i) { var v = pct(T.y.id, e.num); if (v > 0) { idx = i; p = v; } });
            return idx < 0 ? null : { i: idx, p: p };
        }
        function continueNum() {
            if (!T.rel) return '';
            var eps = T.rel.episodes.filter(playable);
            if (!eps.length) return '';
            var w = lastWatched(eps);
            if (w) return (w.p >= 90 && eps[w.i + 1]) ? eps[w.i + 1].num : eps[w.i].num;
            var h = histGet(T.y.id), cur = h && epByNum(h.ep);
            if (cur && playable(cur)) return cur.num;
            return eps[0].num;
        }
        function updateButtons() {
            if (!btnPlay) return;
            var n = T.status === 'ok' ? continueNum() : '';
            var eps = T.rel ? T.rel.episodes.filter(playable) : [], w = n && lastWatched(eps);
            var label = !n ? 'Смотреть' : (!w ? 'Смотреть, серия ' + n : (w.p < 90 || String(eps[w.i].num) === String(n) ? 'Продолжить, серия ' + n : 'Дальше, серия ' + n));
            btnPlay.html(PLAY).append(document.createTextNode(label));
            btnPlay.toggleClass('yummy-btn--dim', !n);
            btnFav.text(isFav(T.y.id) ? '✓ В избранном' : '+ В избранное');
        }

        /* ---- сопоставление с AniLibria ---- */
        function startMatch() {
            T.status = 'matching'; T.rel = null;
            renderBlocks();
            if (isAniId(T.y.id)) return loadRelease(String(T.y.id).slice(2));
            var stored = matchGet(T.y.id);
            if (stored) return loadRelease(stored, function () { stored = null; findAuto(); });
            findAuto();
        }
        function findAuto() {
            findReleases(T.y, function (err, list) {
                if (destroyed) return;
                if (err) { T.status = 'error'; self.activity.loader(false); return renderBlocks(); }
                T.cands = list;
                var pick = autoPick(list);
                if (pick) { matchSet(T.y.id, pick.rel.id); return loadRelease(pick.rel.id); }
                T.status = list.length ? 'choose' : 'nomatch';
                self.activity.loader(false);
                renderBlocks();
            });
        }
        function loadRelease(id, onFail) {
            T.status = 'matching'; T.fr = null; renderBlocks();
            aRelease(id, function (r) {
                if (destroyed) return;
                T.rel = mapRel(r);
                T.status = T.rel && T.rel.episodes.length ? 'ok' : 'noeps';
                if (T.rel && isAniId(T.y.id)) {
                    T.y = mergeY(T.y, { desc: T.rel.desc, genres: T.rel.genres, type: T.rel.type, poster: T.rel.poster, year: T.rel.year, age: T.rel.age });
                }
                if (T.rel && T.rel.ru && !/[а-яё]/i.test(T.y.title)) T.y.title = T.rel.ru;
                renderHead();
                self.activity.loader(false);
                renderBlocks();
                if (T.status === 'ok') { loadSeasons(); maybeAuto(); }
            }, function () {
                if (destroyed) return;
                if (onFail) return onFail();
                T.status = 'error'; self.activity.loader(false); renderBlocks();
            });
        }
        function maybeAuto() {
            if (!auto) return;
            auto = false;
            var n = continueNum();
            if (n) play(n);
        }
        function chooseRelease(c) {
            matchSet(T.y.id, c.rel.id);
            loadRelease(c.rel.id);
        }
        function manualSearch() {
            Lampa.Input.edit({ free: true, title: 'Поиск релиза в AniLibria', nosave: true, value: T.y.title }, function (val) {
                Lampa.Controller.toggle('content');
                val = esc(val).trim();
                if (!val) return;
                aSearch(val, function (res) {
                    if (destroyed) return;
                    var items = (res && res.length !== undefined ? res : (res && res.data) || []).map(mapRel).filter(Boolean);
                    T.cands = items.map(function (r) { return { rel: r, score: score(T.y, r) }; }).sort(function (a, b) { return b.score - a.score; });
                    T.status = T.cands.length ? 'choose' : 'nomatch';
                    renderBlocks();
                }, function () { T.status = 'error'; renderBlocks(); });
            });
        }
        function pickDialog() {
            var items = T.cands.slice(0, 10).map(function (c) {
                return { title: c.rel.ru + (c.rel.year ? ' (' + c.rel.year + ')' : ''), subtitle: c.rel.en, cand: c };
            });
            items.push({ title: 'Поиск вручную…', manual: true });
            Lampa.Select.show({
                title: 'Релиз AniLibria',
                items: items,
                onSelect: function (a) {
                    if (a.manual) return manualSearch();
                    Lampa.Controller.toggle('content');
                    chooseRelease(a.cand);
                },
                onBack: function () { Lampa.Controller.toggle('content'); }
            });
        }
        function changeRelease() {
            if (T.cands.length) return pickDialog();
            Lampa.Noty.show('Ищем варианты озвучки…');
            findReleases(T.y, function (err, list) { T.cands = list || []; pickDialog(); });
        }

        /* ---- сезоны (франшиза AniLibria) ---- */
        function parseFranchise(res) {
            var f = res;
            if (f && f.length !== undefined && f[0] && f[0].franchise_releases) f = f[0];
            var list = (f && f.franchise_releases) || (f && f.length !== undefined ? f : []) || [];
            return list.map(function (x) {
                var r = x.release || x, nm = r.name;
                if (nm && typeof nm === 'object') nm = nm.main;
                if (!nm) { nm = x.name; if (nm && typeof nm === 'object') nm = nm.main; }
                return { id: r.id || x.release_id, name: esc(nm), year: parseInt(r.year || x.year, 10) || 0 };
            }).filter(function (x) { return x.id && x.name; });
        }
        function loadSeasons() {
            if (T.fr !== null || !T.rel) return;
            T.fr = [];
            var rid = T.rel.id;
            aCached('/anime/franchises/release/' + encodeURIComponent(rid), TTL.detail, function (res) {
                if (destroyed || !T.rel || T.rel.id !== rid) return;
                T.fr = parseFranchise(res);
                renderSeasons(); refresh();
            }, function () {});
        }

        /* ---- блоки: озвучка, сезоны, серии ---- */
        function renderBlocks() {
            if (destroyed || !voiceEl) return;
            renderVoice();
            renderSeasons();
            renderEps();
            updateButtons();
            refresh();
        }
        var seasonRS, epsRS;
        function renderVoice() {
            voiceEl.empty();
            var rel = T.rel, st = T.status;
            if (st === 'matching') return voiceEl.append(msg('Ищем релиз в AniLibria…'));
            if (st === 'error') return voiceEl.append(msg('AniLibria недоступна (сеть/блокировка). В браузерной версии Lampa может понадобиться CORS-прокси в настройках плагина.', startMatch));
            if (st === 'nomatch') {
                voiceEl.append(msg('Релиз в AniLibria не найден.'));
                var m = sel($('<div class="yummy-btn yummy-btn--glass yummy-glass selector"></div>').text('Искать релиз вручную'), null, null, voiceEl);
                m.on('hover:enter', manualSearch);
                return voiceEl.append(m);
            }
            if (st === 'choose') {
                var p = $('<div class="yummy-panel yummy-glass"></div>');
                p.append($('<div class="yummy-panel__t"></div>').text('Выберите релиз AniLibria'));
                T.cands.slice(0, 6).forEach(function (c) {
                    var row = sel($('<div class="yummy-cand selector"></div>'), null, null, voiceEl);
                    row.append($('<div class="yummy-cand__t"></div>').text(c.rel.ru + (c.rel.year ? ' (' + c.rel.year + ')' : '')));
                    row.append($('<div class="yummy-cand__s"></div>').text(c.rel.en));
                    row.on('hover:enter', function () { chooseRelease(c); });
                    p.append(row);
                });
                var mm = sel($('<div class="yummy-btn yummy-btn--glass selector"></div>').text('Искать вручную'), null, null, voiceEl);
                mm.on('hover:enter', manualSearch);
                return voiceEl.append(p.append(mm));
            }
            if (st === 'noeps') {
                voiceEl.append(msg('В релизе AniLibria «' + rel.ru + '» пока нет доступных серий.'));
                var c2 = sel($('<div class="yummy-btn yummy-btn--glass yummy-glass selector"></div>').text('Сменить релиз'), null, null, voiceEl);
                c2.on('hover:enter', changeRelease);
                return voiceEl.append(c2);
            }
            // ok: компактная строка «Озвучка · Качество»
            var line = $('<div class="yummy-opts"></div>');
            var vb = sel($('<div class="yummy-opt selector"></div>'), null, null, voiceEl);
            vb.append($('<span class="yummy-opt__l"></span>').text('Озвучка')).append(document.createTextNode('AniLibria'));
            vb.on('hover:enter', changeRelease);
            line.append(vb);
            var avail = {};
            rel.episodes.forEach(function (e) { Object.keys(e.q).forEach(function (k) { avail[k] = 1; }); });
            var qs = ['1080', '720', '480'].filter(function (k) { return avail[k]; });
            if (qs.length) {
                var cur = String(S('yummy_quality', '1080'));
                if (!avail[cur]) cur = qs[0];
                var qb = sel($('<div class="yummy-opt selector"></div>'), null, null, voiceEl);
                qb.append($('<span class="yummy-opt__l"></span>').text('Качество')).append(document.createTextNode(cur + 'p'));
                qb.on('hover:enter', function () {
                    Lampa.Select.show({
                        title: 'Качество',
                        items: qs.map(function (k) { return { title: k + 'p', q: k, selected: k === cur }; }),
                        onSelect: function (a) {
                            W('yummy_quality', a.q);
                            Lampa.Controller.toggle('content');
                            renderVoice(); renderEps(); updateButtons(); refresh(true);
                        },
                        onBack: function () { Lampa.Controller.toggle('content'); }
                    });
                });
                line.append(qb);
            }
            voiceEl.append(line);
        }
        function renderSeasons() {
            kill(seasonRS); seasonRS = null;
            seasonEl.empty();
            if (T.status !== 'ok' || !T.fr || T.fr.length < 2) return;
            var rs = seasonRS = new Lampa.Scroll({ horizontal: true, step: 300 });
            T.fr.forEach(function (f) {
                var on = T.rel && String(f.id) === String(T.rel.id);
                var el = sel(chip(f.name + (f.year ? ' · ' + f.year : ''), on).addClass('yummy-chip--season'), rs, seasonEl);
                el.on('hover:enter', function () {
                    if (on) return Lampa.Noty.show('Этот сезон уже открыт');
                    openTitle({ id: 'a:' + f.id, title: f.name, year: f.year, type: '', poster: '' });
                });
                rs.append(el);
            });
            seasonEl.append(rs.render());
        }
        function renderEps() {
            kill(epsRS); epsRS = null;
            epsEl.empty();
            if (T.status !== 'ok') return;
            var rel = T.rel;
            var nums = {}, order;
            rel.episodes.forEach(function (e) { nums[e.num] = { num: e.num, a: e }; });
            (T.yeps || []).forEach(function (n) { if (!nums[n]) nums[n] = { num: n, a: null }; });
            order = Object.keys(nums).sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
            epsEl.append($('<div class="yummy-row__t"></div>').text('Серии · ' + order.length));
            var rs = epsRS = new Lampa.Scroll({ horizontal: true, step: 320 });
            var cn = String(continueNum()), focusEl = null;
            order.forEach(function (n) {
                var e = nums[n].a, ok = e && playable(e);
                var t = $('<div class="yummy-ep selector"><div class="yummy-ep__img"><div class="yummy-ep__n"></div></div><div class="yummy-ep__name"></div><div class="yummy-ep__q"></div></div>');
                var im = t.find('.yummy-ep__img');
                if (e && e.img) im.css('background-image', 'url("' + e.img + '")');
                t.find('.yummy-ep__n').text(n);
                t.find('.yummy-ep__name').text(e && e.name ? e.name : 'Серия ' + n);
                var p = ok ? pct(T.y.id, n) : 0;
                t.find('.yummy-ep__q').text(ok ? (p >= 90 ? '✓ Просмотрено · ' : '') + ['1080', '720', '480'].filter(function (k) { return e.q[k]; }).join(' · ') : 'нет в AniLibria');
                if (p > 0 && p < 90) im.append($('<div class="yummy-bar"><i></i></div>').find('i').css('width', p + '%').end());
                if (!ok) t.addClass('yummy-ep--off');
                if (ok && n === cn) { t.addClass('yummy-ep--cur'); focusEl = t; }
                sel(t, rs, epsEl);
                t.on('hover:enter', function () {
                    if (!ok) return Lampa.Noty.show('Эта серия не найдена в AniLibria');
                    play(n);
                });
                rs.append(t);
            });
            epsEl.append(rs.render());
            if (focusEl) setTimeout(function () { try { rs.update(focusEl, true); } catch (e) {} }, 0);
        }

        /* ---- воспроизведение ---- */
        function play(startNum) {
            var eps = T.rel.episodes.filter(playable), list = [], startIdx = 0;
            eps.forEach(function (e) {
                if (e.num === String(startNum)) startIdx = list.length;
                list.push({
                    title: T.y.title + ' — Серия ' + e.num,
                    url: pickUrl(e.q),
                    quality: qualityMap(e.q),
                    timeline: Lampa.Timeline.view(hashOf(T.y.id, e.num)),
                    yummy_num: e.num
                });
            });
            if (!list.length) return Lampa.Noty.show('Нет доступных серий');
            var cur = epByNum(startNum);
            histSave(T.y, String(startNum), cur && cur.img);
            T.played = true;
            Lampa.Player.play(list[startIdx]);
            Lampa.Player.playlist(list);
            updateButtons();
        }
        function afterPlayer() {
            T.played = false;
            if (T.rel) {
                var eps = T.rel.episodes.filter(playable), w = lastWatched(eps);
                if (w) histSave(T.y, eps[w.i].num, eps[w.i].img);
            }
            renderEps(); updateButtons(); refresh(true);
        }

        /* =========================== LIFECYCLE ========================== */
        this.create = function () {
            this.activity.loader(true);
            scroll.minus();
            root.append(scroll.render());
            if (mode === 'title') buildTitle(); else buildHome();
            return this.render();
        };
        this.render = function () { return root; };
        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () {
                    if (outsideBar() && heroWrap && $(last).closest(heroWrap).length && focusTab()) return;
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else if (outsideBar() && focusTab()) return;
                    else Lampa.Controller.toggle('head');
                },
                down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
                left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function () { if (Navigator.canmove('right')) Navigator.move('right'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
            if (mode === 'title' && T.played) afterPlayer();
            if (mode === 'home') {
                if (object.tab === 'fav' || object.tab === 'hist') switchTab(object.tab);
                else if (object.tab === 'home' && rowEls.hist) { renderHist(); refresh(true); }
            }
        };
        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            destroyed = true;
            clearTimeout(timer); clearTimeout(qt);
            clearRows(); kill(seasonRS); kill(epsRS);
            scroll.destroy();
            root.remove();
        };
    }

    /* ------------------------------------------------------------------ */
    /* Меню, стили, настройки                                              */
    /* ------------------------------------------------------------------ */
    var ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M10 8l5 3-5 3V8z" fill="currentColor"/><path d="M8 21h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    function addMenu() {
        if ($('.menu .view--yummyanime').length) return;
        var li = $('<li class="menu__item selector view--yummyanime"><div class="menu__ico">' + ICON + '</div><div class="menu__text">Аниме</div></li>');
        li.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: 'Аниме', component: 'yummy_anime', mode: 'home', page: 1 });
        });
        $('.menu .menu__list').eq(0).append(li);
    }

    function addStyle() {
        var BG = '13,8,26';
        var css = [
            '.yummy{color:#fff;background:#0b0716;min-height:100%;font-family:-apple-system,"SF Pro Display","Inter","Segoe UI",Roboto,Arial,sans-serif;letter-spacing:-.01em}',
            '@keyframes yFade{from{opacity:0}to{opacity:1}}',
            '@keyframes yRise{from{opacity:0;transform:translate3d(0,.7em,0)}to{opacity:1;transform:none}}',
            /* стекло */
            '.yummy-glass{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.12);-webkit-backdrop-filter:blur(1.1em) saturate(1.5);backdrop-filter:blur(1.1em) saturate(1.5);box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}',
            '.yummy--flat .yummy-glass{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgba(40,34,62,.92);box-shadow:none}',
            /* шапка и приветствие */
            '.yummy-bar-top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;padding:1.8em 2em .5em}',
            '.yummy-hello{margin-bottom:.6em;max-width:100%}',
            '.yummy-hello__a{display:block;font-size:1.2em;font-weight:500;opacity:.6;animation:yRise .8s .1s both cubic-bezier(.2,.8,.2,1)}',
            '.yummy-hello__b{display:block;font-size:2.7em;line-height:1.12;margin-top:.1em;animation:yRise .9s .3s both cubic-bezier(.2,.8,.2,1)}',
            '.yummy-hello__b i{font-family:Georgia,"Times New Roman",serif;font-style:italic;font-weight:400;color:#c4b5fd;background:linear-gradient(100deg,#f5f3ff 0%,#c4b5fd 45%,#8b5cf6 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}',
            '.yummy-tabs{display:flex;flex-wrap:wrap;margin-bottom:.6em}',
            '.yummy-tab{padding:.55em 1.2em;margin-left:.6em;border-radius:2em;font-size:1.1em;font-weight:500;transition:transform .15s}',
            '.yummy-tab--active{background:rgba(139,92,246,.55)}',
            '.yummy-tab.focus{background:#ddd6fe;color:#2e1065;transform:scale(1.07)}',
            /* hero */
            '.yummy-hero{position:relative;margin:.6em 2em 0;border-radius:1.4em;overflow:hidden;min-height:13.6em;background:#150d2a}',
            '.yummy-hero--ghost{opacity:.5}',
            '.yummy-hero__bg{opacity:.3}',
            '.yummy-hero__poster{position:absolute;top:1.1em;right:2.4em;width:7.6em;height:11.4em;border-radius:.9em;background:#1b1e27 center/cover no-repeat;box-shadow:0 .4em 1.2em rgba(0,0,0,.5)}',
            '.yummy-hero__bg,.yummy-title__bg{position:absolute;top:0;left:0;right:0;bottom:0;background:#12141b center 22%/cover no-repeat}',
            '.yummy-hero__sh{position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,rgba(' + BG + ',.97) 0%,rgba(' + BG + ',.85) 50%,rgba(' + BG + ',.55) 100%)}',
            '.yummy-hero__body{position:relative;padding:1.5em 2em 1.3em;max-width:62%;box-sizing:border-box}',
            '.yummy-hero__kick{font-size:.95em;letter-spacing:.16em;text-transform:uppercase;font-weight:600;opacity:.65;margin-bottom:.4em}',
            '.yummy-hero__title{font-size:1.9em;font-weight:700;line-height:1.1;letter-spacing:-.025em;max-height:2.2em;overflow:hidden}',
            '.yummy-chips{margin-top:.6em}',
            '.yummy-pill{display:inline-block;padding:.25em .8em;margin:0 .5em .5em 0;border-radius:2em;font-size:1em;font-weight:500}',
            '.yummy-hero__desc{margin:.2em 0 .9em;line-height:1.45;opacity:.8;font-size:1em;max-height:2.9em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
            /* кнопки */
            '.yummy-hero .yummy-btn{font-size:1.05em;padding:.6em 1.4em;margin-bottom:0}',
            '.yummy-btn{display:inline-block;padding:.75em 1.6em;margin:0 .8em .6em 0;border-radius:2em;font-size:1.2em;font-weight:600;transition:transform .15s}',
            '.yummy-btn--main{background:linear-gradient(135deg,#a78bfa,#7c3aed);color:#fff}',
            '.yummy-btn svg{display:none!important}',
            '.yummy-ico-play{display:inline-block;width:0;height:0;border-style:solid;border-width:.42em 0 .42em .7em;border-color:transparent transparent transparent currentColor;margin-right:.5em;vertical-align:-.05em}',
            '.yummy-btn--dim{opacity:.7}',
            '.yummy-btn--glass{background:rgba(139,92,246,.28)}',
            '.yummy-btn--glass.focus,.yummy-btn.focus{background:#ddd6fe;color:#2e1065}',
            '.yummy-btn--main.focus{background:linear-gradient(135deg,#c4b5fd,#8b5cf6);color:#fff}',
            '.yummy-btn.focus{transform:scale(1.06)}',
            '.yummy-btn--wide{display:block;width:100%;box-sizing:border-box;border-radius:1em}',
            '.yummy-wide{width:100%;padding:0 .5em}',
            /* подборки */
            '.yummy-rows{padding-bottom:3em}',
            '.yummy-row{margin-top:1.1em}',
            '.yummy-row__t{font-size:1.5em;font-weight:700;letter-spacing:-.02em;margin:0 0 .1em 1.35em}',
            '.yummy-row .scroll__body{display:flex;flex-wrap:nowrap;padding:1.1em 2em 2.4em}',
            '.yummy-grid{display:flex;flex-wrap:wrap;padding:1.2em 1.4em 3em}',
            /* карточки */
            '.yummy-card{flex:0 0 auto;width:11.5em;margin:0 1.1em 1.6em 0;position:relative;transition:transform .16s ease-out}',
            '.yummy-card__img{position:relative;padding-bottom:150%;border-radius:1em;background:#1b1e27 center/cover no-repeat;overflow:hidden}',
            '.yummy-card__img:after,.yummy-ep__img:after{content:"";position:absolute;top:0;left:0;right:0;bottom:0;border-radius:inherit;box-shadow:inset 0 0 0 .14em rgba(196,181,253,.98);opacity:0;transition:opacity .16s}',
            '.yummy-card.focus{transform:scale(1.07);will-change:transform;z-index:2}',
            '.yummy-card.focus .yummy-card__img:after{opacity:1}',
            '.yummy-card__title{margin-top:.65em;font-size:1.08em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.yummy-card__sub{opacity:.55;font-size:.92em;margin-top:.15em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.yummy-badge{position:absolute;top:.6em;left:.6em;padding:.2em .65em;border-radius:2em;font-size:.85em;font-weight:600}',
            '.yummy-bar{position:absolute;left:.7em;right:.7em;bottom:.7em;height:.3em;border-radius:.3em;background:rgba(255,255,255,.28);overflow:hidden}',
            '.yummy-bar i{display:block;height:100%;background:#a78bfa;border-radius:.3em}',
            /* страница тайтла */
            '.yummy-title{position:relative;overflow:hidden;min-height:20em}',
            '.yummy-title__bg{opacity:.35;background-position:center 20%}',
            '.yummy-title__sh{position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,rgba(' + BG + ',.96) 0%,rgba(' + BG + ',.75) 55%,rgba(' + BG + ',.35) 100%),linear-gradient(0deg,rgba(' + BG + ',1) 0%,rgba(' + BG + ',0) 55%)}',
            '.yummy-info{position:relative;display:flex;padding:1.8em 2.4em .6em}',
            '.yummy-info__poster{flex:0 0 11.5em;height:17.25em;border-radius:1em;background:#1b1e27 center/cover no-repeat;margin-right:2em;}',
            '.yummy-info__body{flex:1;min-width:0}',
            '.yummy-info__title{font-size:2.3em;font-weight:700;line-height:1.1;letter-spacing:-.025em}',
            '.yummy-info__orig{opacity:.5;margin-top:.35em;font-size:1.1em}',
            '.yummy-info__genres{opacity:.65;font-size:1.05em;margin-top:.2em}',
            '.yummy-info__desc{margin:.5em 0 1.1em;line-height:1.5;opacity:.78;max-height:4.6em;overflow:hidden;font-size:1.05em;max-width:40em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}',
            /* озвучка */
            '.yummy-block{padding:0 2.4em}',
            '.yummy-opts{margin:.2em 0 .4em}',
            '.yummy-opt{display:inline-block;margin-right:.8em;padding:.45em 1.1em;border-radius:2em;background:rgba(255,255,255,.07);font-size:1.05em;transition:transform .15s}',
            '.yummy-opt__l{opacity:.55;margin-right:.55em}',
            '.yummy-opt.focus{background:#ddd6fe;color:#2e1065;transform:scale(1.05)}',
            '.yummy-panel{padding:1.2em 1.5em;border-radius:1.2em;margin-top:.4em}',
            '.yummy-panel__t{font-size:1.4em;font-weight:700}',
            '.yummy-panel__s{opacity:.6;margin:.15em 0 .9em}',
            '.yummy-chiprow{margin-top:.2em}',
            '.yummy-chiplabel{display:inline-block;opacity:.55;margin:0 .9em .6em 0;font-size:1.05em}',
            '.yummy-chip{display:inline-block;padding:.5em 1.1em;margin:0 .6em .6em 0;border-radius:2em;background:rgba(255,255,255,.08);font-size:1.05em;font-weight:500;max-width:24em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:top;transition:transform .15s}',
            '.yummy-chip--on{background:rgba(139,92,246,.55)}',
            '.yummy-chip.focus{background:#ddd6fe;color:#2e1065;transform:scale(1.06)}',
            '.yummy-chip--season{flex:0 0 auto;display:block}',
            '.yummy-cand{padding:.8em 1.1em;margin-bottom:.5em;border-radius:.9em;background:rgba(255,255,255,.07);transition:transform .15s}',
            '.yummy-cand.focus{background:#ddd6fe;color:#2e1065;transform:scale(1.02)}',
            '.yummy-cand__s{opacity:.6;margin-top:.15em}',
            '.yummy-msg{margin:.6em 2em;padding:1.2em 1.5em;border-radius:1.2em}',
            '.yummy-msg__text{margin-bottom:.9em;opacity:.85;font-size:1.15em;line-height:1.45}',
            '.yummy-block .yummy-msg{margin:.4em 0}',
            /* серии */
            '.yummy-ep{flex:0 0 auto;width:17em;margin-right:1.1em;transition:transform .16s ease-out}',
            '.yummy-ep__img{position:relative;padding-bottom:56.25%;border-radius:.9em;background:#1b1e27 linear-gradient(135deg,#262a38,#14161e) center/cover no-repeat;overflow:hidden}',
            '.yummy-ep__img--poster{background-position:center 18%}',
            '.yummy-ep__n{position:absolute;left:.55em;bottom:.2em;font-size:2.4em;font-weight:700}',
            '.yummy-ep__name{margin-top:.6em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.yummy-ep__q{opacity:.55;font-size:.9em;margin-top:.15em}',
            '.yummy-ep--off{opacity:.38}',
            '.yummy-ep--cur .yummy-ep__img:after{opacity:.45}',
            '.yummy-ep.focus{transform:scale(1.06);will-change:transform;z-index:2}',
            '.yummy-ep.focus .yummy-ep__img:after{opacity:1}',
            /* адаптация */
            '@media (max-width:900px){.yummy-hero__body{max-width:100%}.yummy-hello__b{font-size:2em}.yummy-bar-top{display:block}.yummy-tab:first-child{margin-left:0}}',
            '@media (max-width:700px){.yummy-info{flex-direction:column}.yummy-info__poster{margin:0 0 1em}}'
        ].join('');
        $('<style></style>').text(css).appendTo('head');
    }

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        Lampa.SettingsApi.addComponent({ component: 'yummyanime', name: 'YummyAnime', icon: ICON });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_source', type: 'select', values: { ani: 'AniLibria (весь каталог)', yummy: 'YummyAnime + поиск релиза' }, 'default': 'ani' },
            field: { name: 'Источник каталога и поиска', description: 'AniLibria: русские данные, без сопоставления. YummyAnime: свой каталог, релиз ищется автоматически' }
        });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_glass', type: 'select', values: { on: 'Включён', off: 'Выключен (быстрее)' }, 'default': 'off' },
            field: { name: 'Эффект стекла (Liquid Glass)', description: 'Красиво, но нагружает слабые ТВ. Применяется при следующем открытии раздела' }
        });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_quality', type: 'select', values: { '1080': '1080p', '720': '720p', '480': '480p' }, 'default': '1080' },
            field: { name: 'Качество по умолчанию', description: 'Если выбранного нет — берётся ближайшее доступное' }
        });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_lang', type: 'select', values: { ru: 'Русский', en: 'English' }, 'default': 'ru' },
            field: { name: 'Язык данных YummyAnime', description: 'Отправляется как Accept-Language' }
        });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_token', type: 'input', values: '', 'default': '' },
            field: { name: 'Токен X-Application (необязательно)', description: 'Публичный токен приложения: yummyani.me/dev/applications' }
        });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_api', type: 'input', values: '', 'default': '' },
            field: { name: 'Адрес API YummyAnime', description: 'Пусто = api.yani.tv (запасной old.yummyani.me/api)' }
        });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_ani', type: 'input', values: '', 'default': '' },
            field: { name: 'Адрес AniLibria', description: 'Пусто = https://anilibria.top (укажите зеркало, если основной домен недоступен)' }
        });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_proxy', type: 'input', values: '', 'default': '' },
            field: { name: 'CORS-прокси', description: 'Нужен только для браузерной версии Lampa, префикс URL' }
        });
        Lampa.SettingsApi.addParam({
            component: 'yummyanime',
            param: { name: 'yummy_clear', type: 'button' },
            field: { name: 'Сбросить сопоставления и кэш', description: 'Заново искать релизы и обновить подборки главной' },
            onChange: function () { W('yummy_match', {}); W('yummy_rc', {}); mem = {}; Lampa.Noty.show('Сопоставления и кэш сброшены'); }
        });
    }

    function start() {
        if (window.yummy_started) return;
        window.yummy_started = true;
        Lampa.Component.add('yummy_anime', Component);
        addStyle();
        addSettings();
        addMenu();
    }

    if (window.__YUMMY_TEST__) {
        window.__yummy_test = { norm: norm, sim: sim, score: score, mapY: mapY, mapRel: mapRel, mapA: mapA, autoPick: autoPick, pickUrl: pickUrl, pickQueries: pickQueries, baseTitle: baseTitle, seasonOf: seasonOf, qualityMap: qualityMap, fixUrl: fixUrl, flatRel: flatRel };
        return;
    }
    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
