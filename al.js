/**
 * YummyAnime for Lampa v1.1.0
 * Каталог YummyAnime + серии в озвучке AniLibria (HLS 480/720/1080) через встроенный плеер Lampa.
 * v1.1.0: карточки в стиле Lampa (бейдж типа, рейтинг/серии на постере, название в 2 строки, год и статус).
 *
 * Источники:
 *  - YummyAnime API: https://api.yani.tv (запасной: https://old.yummyani.me/api)
 *  - AniLibria API v1: https://anilibria.top/api/v1
 */
(function () {
    'use strict';

    if (window.yummyanime_plugin) return;
    window.yummyanime_plugin = true;

    var VERSION = '1.1.0';
    var DEF_API = 'https://api.yani.tv';
    var FALLBACK_API = 'https://old.yummyani.me/api';
    var DEF_ANI = 'https://anilibria.top';
    var PAGE = 24;
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
            type: esc(a.type && (a.type.shortname || a.type.name) || ''),
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
            id: 'a:' + rel.id, title: rel.ru || rel.en, year: rel.year, type: rel.typeCode || rel.type,
            status: rel.ongoing ? 'Онгоинг' : (rel.total ? 'Вышло' : ''), poster: rel.poster,
            desc: rel.desc, genres: rel.genres, rating: '', eps: rel.total ? { count: rel.total, aired: 0 } : null,
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
        return { num: String(e.ordinal), id: e.id, name: esc(e.name), q: q };
    }
    function mapRel(r) {
        if (!r) return null;
        var out = {
            id: r.id, alias: r.alias,
            ru: esc(r.name && r.name.main), en: esc(r.name && r.name.english),
            year: parseInt(r.year, 10) || 0,
            total: r.episodes_total || 0,
            ongoing: !!r.is_ongoing,
            desc: esc(r.description).replace(/<[^>]+>/g, ''),
            genres: (r.genres || []).map(function (g) { return g && (g.name || g.title) || g; }).filter(Boolean),
            type: esc(r.type && (r.type.description || r.type.value) || ''),
            typeCode: esc(r.type && r.type.value || ''),
            poster: r.poster ? fixUrl(r.poster.src || r.poster.preview || r.poster.thumbnail || '', aniBase()) : '',
            episodes: (r.episodes || []).map(mapEp)
        };
        out.episodes.sort(function (a, b) { return parseFloat(a.num) - parseFloat(b.num); });
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

    /* ------------------------------------------------------------------ */
    /* Избранное / история                                                 */
    /* ------------------------------------------------------------------ */
    function compact(y) {
        return {
            id: y.id, title: y.title, year: y.year, type: y.type, poster: y.poster,
            rating: y.rating || '', status: y.status || '', eps: y.eps || null
        };
    }
    function isFav(id) { return arr('yummy_fav').some(function (x) { return x.id === id; }); }
    function toggleFav(y) {
        var list = arr('yummy_fav'), had = false;
        list = list.filter(function (x) { if (x.id === y.id) { had = true; return false; } return true; });
        if (!had) list.unshift(compact(y));
        W('yummy_fav', list);
        return !had;
    }
    function histGet(id) { var l = arr('yummy_hist'); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function histSave(y, num) {
        var list = arr('yummy_hist').filter(function (x) { return x.id !== y.id; });
        var h = compact(y); h.ep = num; h.ts = Date.now();
        list.unshift(h);
        W('yummy_hist', list.slice(0, 100));
    }
    function matchGet(id) { var m = S('yummy_match', {}); return m && m[id]; }
    function matchSet(id, relId) { var m = S('yummy_match', {}) || {}; m[id] = relId; W('yummy_match', m); }

    /* ------------------------------------------------------------------ */
    /* Компонент                                                           */
    /* ------------------------------------------------------------------ */
    function Component(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var root = $('<div class="yummy"></div>');
        var last = false, destroyed = false;
        var mode = object.mode || 'home';

        /* общие утилиты */
        function setLast(e) { last = e.target; scroll.update($(e.target), true); }
        function selectable(el) { el.on('hover:focus', setLast); return el; }
        function msg(text, retry, retryLabel) {
            var box = $('<div class="yummy-msg"></div>');
            box.append($('<div class="yummy-msg__text"></div>').text(text));
            if (retry) {
                var b = selectable($('<div class="yummy-btn selector"></div>').text(retryLabel || 'Повторить'));
                b.on('hover:enter', retry);
                box.append(b);
            }
            return box;
        }
        function refresh() {
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
        function openTitle(item) {
            Lampa.Activity.push({ url: '', title: item.title, component: 'yummy_anime', mode: 'title', item: item, page: 1 });
        }
        function card(item, sub) {
            var c = $('<div class="yummy-card selector">' +
                '<div class="yummy-card__img"><div class="yummy-card__type"></div><div class="yummy-card__rate"></div></div>' +
                '<div class="yummy-card__title"></div><div class="yummy-card__sub"></div><div class="yummy-card__status"></div></div>');
            if (item.poster) c.find('.yummy-card__img').css('background-image', 'url("' + item.poster + '")');

            // бейдж типа (TV / Фильм / OVA) — слева сверху
            var type = esc(item.type);
            if (type) c.find('.yummy-card__type').text(type.length > 6 ? type.slice(0, 6) : type); else c.find('.yummy-card__type').remove();

            // справа снизу: рейтинг, если есть, иначе число серий
            var eps = item.eps && (item.eps.aired || item.eps.count);
            if (item.rating) c.find('.yummy-card__rate').text(item.rating);
            else if (eps) c.find('.yummy-card__rate').text(eps + ' эп.');
            else c.find('.yummy-card__rate').remove();

            c.find('.yummy-card__title').text(item.title);
            c.find('.yummy-card__sub').text(sub || (item.year || ''));
            if (!sub && item.status) c.find('.yummy-card__status').text(item.status); else c.find('.yummy-card__status').remove();
            selectable(c);
            c.on('hover:enter', function () { openTitle(compact(item)); });
            return c;
        }

        /* ============================ HOME ============================= */
        var tabsEl, gridEl, state = { page: 0, loading: false, ended: false };
        var TABS = [['catalog', 'Каталог'], ['search', 'Поиск'], ['fav', 'Избранное'], ['hist', 'История']];

        function buildHome() {
            object.tab = object.tab || 'catalog';
            tabsEl = $('<div class="yummy-tabs"></div>');
            TABS.forEach(function (t) {
                var el = selectable($('<div class="yummy-tab selector"></div>').text(t[1]).attr('data-tab', t[0]));
                el.on('hover:enter', function () { switchTab(t[0]); });
                tabsEl.append(el);
            });
            gridEl = $('<div class="yummy-grid"></div>');
            scroll.append(tabsEl);
            scroll.append(gridEl);
            scroll.onEnd = function () { if (object.tab === 'catalog' || object.tab === 'search') loadMore(); };
            switchTab(object.tab, true);
        }
        function markTabs() {
            tabsEl.find('.yummy-tab').each(function () {
                $(this).toggleClass('yummy-tab--active', $(this).attr('data-tab') === object.tab);
            });
        }
        function switchTab(tab, initial) {
            object.tab = tab;
            markTabs();
            gridEl.empty();
            state = { page: 0, loading: false, ended: false };
            if (tab === 'catalog') loadMore();
            else if (tab === 'search') {
                if (object.query) { searchHeader(); loadMore(); }
                else askQuery();
            }
            else if (tab === 'fav') renderStored(arr('yummy_fav'), 'Избранное пусто. Добавляйте тайтлы кнопкой на странице аниме.');
            else if (tab === 'hist') {
                var h = arr('yummy_hist');
                renderStored(h, 'История пуста.', function (x) { return 'Серия ' + x.ep; });
            }
        }
        function renderStored(list, emptyText, subFn) {
            gridEl.empty();
            if (!list.length) gridEl.append(msg(emptyText));
            list.forEach(function (x) { gridEl.append(card(x, subFn ? subFn(x) : '')); });
            refresh();
        }
        function searchHeader() {
            var b = selectable($('<div class="yummy-btn selector yummy-btn--wide"></div>').text('Запрос: «' + object.query + '» — изменить'));
            b.on('hover:enter', askQuery);
            gridEl.empty().append($('<div class="yummy-row"></div>').append(b));
        }
        function askQuery() {
            Lampa.Input.edit({ free: true, title: 'Поиск аниме', nosave: true, value: object.query || '' }, function (val) {
                Lampa.Controller.toggle('content');
                val = esc(val).trim();
                if (!val) return refresh();
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
            var fn = tab === 'search' ? function (ok, fail) { (ani ? aSearch : ySearch)(object.query, ok, fail); }
                : function (ok, fail) { (ani ? aCatalog : yCatalog)(page, ok, fail); };
            fn(function (res) {
                if (destroyed || tab !== object.tab) return;
                state.loading = false;
                var list = (res && res.length !== undefined ? res : (res && res.data) || []).map(ani ? mapA : mapY).filter(Boolean);
                if (tab === 'search') state.ended = true; // поиск отдаёт одну страницу
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
        var T = { y: null, rel: null, yeps: null, cands: [], status: 'matching', played: false };
        var headEl, listEl, btnPlay, btnFav;

        function buildTitle() {
            T.y = object.item;
            headEl = $('<div class="yummy-head"></div>');
            listEl = $('<div class="yummy-list"></div>');
            scroll.append(headEl);
            scroll.append(listEl);
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
                renderList();
            }, function () { T.yeps = []; });
        }
        function renderHead() {
            var y = T.y;
            headEl.empty();
            var meta = [y.year || '', y.type, y.status, y.eps && (y.eps.aired || y.eps.count) ? (y.eps.aired || y.eps.count) + ' эп.' : '', y.rating ? '★ ' + y.rating : ''].filter(Boolean).join(' • ');
            var el = $('<div class="yummy-info"><div class="yummy-info__poster"></div><div class="yummy-info__body"><div class="yummy-info__title"></div><div class="yummy-info__orig"></div><div class="yummy-info__meta"></div><div class="yummy-info__genres"></div><div class="yummy-info__desc"></div><div class="yummy-info__btns"></div></div></div>');
            if (y.poster) el.find('.yummy-info__poster').css('background-image', 'url("' + y.poster + '")');
            el.find('.yummy-info__title').text(y.title);
            el.find('.yummy-info__orig').text((y.titles || []).filter(function (t) { return norm(t) !== norm(y.title); }).slice(0, 2).join(' / '));
            el.find('.yummy-info__meta').text(meta);
            el.find('.yummy-info__genres').text((y.genres || []).join(', '));
            el.find('.yummy-info__desc').text(y.desc || '');
            btnPlay = selectable($('<div class="yummy-btn selector yummy-btn--main"></div>'));
            btnPlay.on('hover:enter', function () { var n = continueNum(); if (n) play(n); else Lampa.Noty.show('Нет доступных серий'); });
            btnFav = selectable($('<div class="yummy-btn selector"></div>'));
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
        function continueNum() {
            if (!T.rel) return '';
            var eps = T.rel.episodes.filter(playable);
            if (!eps.length) return '';
            var h = histGet(T.y.id);
            if (h) {
                var cur = epByNum(h.ep);
                if (cur) {
                    var tl = Lampa.Timeline.view(hashOf(T.y.id, cur.num));
                    if (tl && tl.percent >= 90) {
                        var idx = eps.indexOf(cur);
                        if (idx > -1 && eps[idx + 1]) return eps[idx + 1].num;
                    }
                    if (playable(cur)) return cur.num;
                }
            }
            return eps[0].num;
        }
        function updateButtons() {
            if (!btnPlay) return;
            var n = T.status === 'ok' ? continueNum() : '';
            var h = histGet(T.y.id);
            btnPlay.text(!n ? 'Смотреть (ищем серии…)' : (h && String(h.ep) === String(n) ? 'Продолжить: серия ' + n : (h ? 'Дальше: серия ' + n : 'Смотреть: серия ' + n)));
            btnFav.text(isFav(T.y.id) ? '★ В избранном' : '☆ В избранное');
        }

        /* ---- сопоставление с AniLibria ---- */
        function startMatch() {
            T.status = 'matching'; T.rel = null;
            renderList();
            if (isAniId(T.y.id)) return loadRelease(String(T.y.id).slice(2));
            var stored = matchGet(T.y.id);
            if (stored) return loadRelease(stored, function () { stored = null; findAuto(); });
            findAuto();
        }
        function findAuto() {
            findReleases(T.y, function (err, list) {
                if (destroyed) return;
                if (err) { T.status = 'error'; return renderList(); }
                T.cands = list;
                var pick = autoPick(list);
                if (pick) { matchSet(T.y.id, pick.rel.id); return loadRelease(pick.rel.id); }
                T.status = list.length ? 'choose' : 'nomatch';
                self.activity.loader(false);
                renderList();
            });
        }
        function loadRelease(id, onFail) {
            T.status = 'matching'; renderList();
            aRelease(id, function (r) {
                if (destroyed) return;
                T.rel = mapRel(r);
                T.status = T.rel && T.rel.episodes.length ? 'ok' : 'noeps';
                if (T.rel && isAniId(T.y.id)) {
                    T.y = mergeY(T.y, { desc: T.rel.desc, genres: T.rel.genres, type: T.rel.typeCode || T.rel.type, poster: T.rel.poster, year: T.rel.year });
                    renderHead();
                }
                if (T.rel && T.rel.ru && !/[а-яё]/i.test(T.y.title)) { T.y.title = T.rel.ru; renderHead(); }
                self.activity.loader(false);
                renderList(); updateButtons();
            }, function () {
                if (destroyed) return;
                if (onFail) return onFail();
                T.status = 'error'; self.activity.loader(false); renderList();
            });
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
                    renderList();
                }, function () { T.status = 'error'; renderList(); });
            });
        }
        function changeRelease() {
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

        /* ---- список серий ---- */
        function renderList() {
            if (destroyed || !listEl) return;
            listEl.empty();
            var rel = T.rel;
            if (T.status === 'matching') return listEl.append(msg('Ищем релиз в AniLibria…'));
            if (T.status === 'error') return listEl.append(msg('AniLibria недоступна (сеть/блокировка). В браузерной версии Lampa может понадобиться CORS-прокси в настройках плагина.', startMatch)), refresh();
            if (T.status === 'nomatch') {
                listEl.append(msg('Релиз в AniLibria не найден.'));
                var m = selectable($('<div class="yummy-btn selector"></div>').text('Искать релиз вручную'));
                m.on('hover:enter', manualSearch);
                listEl.append(m);
                return refresh();
            }
            if (T.status === 'choose') {
                listEl.append($('<div class="yummy-section"></div>').text('Выберите релиз AniLibria'));
                T.cands.slice(0, 8).forEach(function (c) {
                    var row = selectable($('<div class="yummy-cand selector"></div>'));
                    row.append($('<div class="yummy-cand__t"></div>').text(c.rel.ru + (c.rel.year ? ' (' + c.rel.year + ')' : '')));
                    row.append($('<div class="yummy-cand__s"></div>').text(c.rel.en));
                    row.on('hover:enter', function () { chooseRelease(c); });
                    listEl.append(row);
                });
                var mm = selectable($('<div class="yummy-btn selector"></div>').text('Искать вручную'));
                mm.on('hover:enter', manualSearch);
                listEl.append(mm);
                return refresh();
            }
            if (T.status === 'noeps') {
                listEl.append(msg('В релизе AniLibria «' + rel.ru + '» пока нет доступных серий.'));
                var c2 = selectable($('<div class="yummy-btn selector"></div>').text('Сменить релиз'));
                c2.on('hover:enter', changeRelease);
                listEl.append(c2);
                return refresh();
            }

            // status ok
            var voice = selectable($('<div class="yummy-voice selector"></div>'));
            voice.append($('<div class="yummy-voice__t"></div>').text('Озвучка: AniLibria'));
            voice.append($('<div class="yummy-voice__s"></div>').text('Релиз: ' + rel.ru + (rel.year ? ' (' + rel.year + ')' : '') + ' — нажмите, чтобы сменить'));
            voice.on('hover:enter', changeRelease);
            listEl.append(voice);

            var nums = {}, order = [];
            rel.episodes.forEach(function (e) { nums[e.num] = { num: e.num, a: e }; });
            (T.yeps || []).forEach(function (n) { if (!nums[n]) nums[n] = { num: n, a: null }; });
            order = Object.keys(nums).sort(function (a, b) { return parseFloat(a) - parseFloat(b); });

            order.forEach(function (n) {
                var item = nums[n], e = item.a, ok = e && playable(e);
                var row = selectable($('<div class="yummy-ep selector"></div>'));
                if (!ok) row.addClass('yummy-ep--off');
                row.append($('<div class="yummy-ep__num"></div>').text('Серия ' + n));
                row.append($('<div class="yummy-ep__name"></div>').text(e && e.name ? e.name : ''));
                var q = ok ? ['1080', '720', '480'].filter(function (k) { return e.q[k]; }).join(' · ') : 'нет в AniLibria';
                row.append($('<div class="yummy-ep__q"></div>').text(q));
                if (ok) row.append(Lampa.Timeline.render(Lampa.Timeline.view(hashOf(T.y.id, n))));
                row.on('hover:enter', function () {
                    if (!ok) return Lampa.Noty.show('Эта серия не найдена в AniLibria');
                    play(n);
                });
                listEl.append(row);
            });
            refresh();
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
            histSave(T.y, String(startNum));
            T.played = true;
            Lampa.Player.play(list[startIdx]);
            Lampa.Player.playlist(list);
            updateButtons();
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
                up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
                left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function () { if (Navigator.canmove('right')) Navigator.move('right'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
            if (mode === 'title' && T.played) { T.played = false; renderList(); updateButtons(); }
            if (mode === 'home' && (object.tab === 'fav' || object.tab === 'hist')) switchTab(object.tab);
        };
        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            destroyed = true;
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
        var css = '' +
            '.yummy-tabs{display:flex;flex-wrap:wrap;padding:1em 1.5em 0}' +
            '.yummy-tab{padding:.6em 1.3em;margin:0 .6em .6em 0;border-radius:1.5em;background:rgba(255,255,255,.08);font-size:1.2em}' +
            '.yummy-tab--active{background:rgba(255,255,255,.22)}' +
            '.yummy-tab.focus,.yummy-btn.focus{background:#fff;color:#000}' +
            '.yummy-grid{display:flex;flex-wrap:wrap;padding:1em 1.5em}' +
            '.yummy-row{width:100%;margin-bottom:1em}' +
            /* карточка в стиле Lampa */
            '.yummy-card{width:13em;margin:0 1.1em 1.6em 0;position:relative}' +
            '.yummy-card__img{position:relative;padding-bottom:150%;border-radius:.8em;background:#2a2a2a center/cover no-repeat;overflow:hidden;transition:transform .15s}' +
            '.yummy-card.focus .yummy-card__img{box-shadow:0 0 0 .25em #fff;transform:scale(1.03)}' +
            '.yummy-card__type{position:absolute;left:.5em;top:.5em;padding:.15em .55em;border-radius:.35em;background:#e0425a;color:#fff;font-size:.85em;font-weight:700;text-transform:uppercase;line-height:1.4}' +
            '.yummy-card__rate{position:absolute;right:.5em;bottom:.5em;padding:.15em .55em;border-radius:.35em;background:rgba(0,0,0,.72);color:#fff;font-size:1em;font-weight:700;line-height:1.4}' +
            '.yummy-card__title{margin-top:.6em;font-size:1.15em;font-weight:600;line-height:1.2;max-height:2.4em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
            '.yummy-card__sub{opacity:.6;font-size:.95em;margin-top:.3em;font-weight:600}' +
            '.yummy-card__status{opacity:.45;font-size:.85em;margin-top:.1em}' +
            '.yummy-msg{width:100%;padding:1.2em 1.5em}' +
            '.yummy-msg__text{margin-bottom:1em;opacity:.8;font-size:1.2em;line-height:1.4}' +
            '.yummy-btn{display:inline-block;padding:.7em 1.4em;margin:0 .8em .8em 0;border-radius:.6em;background:rgba(255,255,255,.1);font-size:1.2em}' +
            '.yummy-btn--main{background:rgba(255,255,255,.22)}' +
            '.yummy-btn--wide{width:100%;box-sizing:border-box}' +
            '.yummy-info{display:flex;padding:1.5em}' +
            '.yummy-info__poster{flex:0 0 14em;height:21em;border-radius:.6em;background:#2a2a2a center/cover no-repeat;margin-right:2em}' +
            '.yummy-info__body{flex:1;min-width:0}' +
            '.yummy-info__title{font-size:2.2em;font-weight:600;line-height:1.15}' +
            '.yummy-info__orig{opacity:.55;margin-top:.3em;font-size:1.1em}' +
            '.yummy-info__meta{margin-top:.8em;font-size:1.2em;opacity:.85}' +
            '.yummy-info__genres{margin-top:.4em;opacity:.65}' +
            '.yummy-info__desc{margin:.9em 0 1.2em;line-height:1.45;opacity:.85;max-height:9em;overflow:hidden;font-size:1.1em}' +
            '.yummy-list{padding:0 1.5em 2em}' +
            '.yummy-section{font-size:1.4em;margin:0 0 .8em}' +
            '.yummy-voice,.yummy-ep,.yummy-cand{position:relative;padding:.9em 1.2em;margin-bottom:.5em;border-radius:.6em;background:rgba(255,255,255,.07)}' +
            '.yummy-voice.focus,.yummy-ep.focus,.yummy-cand.focus{background:#fff;color:#000}' +
            '.yummy-voice__t{font-size:1.3em}.yummy-voice__s,.yummy-cand__s{opacity:.6;margin-top:.2em}' +
            '.yummy-ep{display:flex;align-items:center}' +
            '.yummy-ep__num{flex:0 0 9em;font-size:1.2em}' +
            '.yummy-ep__name{flex:1;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:1em}' +
            '.yummy-ep__q{opacity:.65;white-space:nowrap}' +
            '.yummy-ep--off{opacity:.4}' +
            '.yummy-ep .time-line{position:absolute;left:0;right:0;bottom:0}' +
            '@media (max-width:700px){.yummy-info{flex-direction:column}.yummy-info__poster{margin:0 0 1em}}';
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
            field: { name: 'Сбросить сопоставления с AniLibria', description: 'Заново искать релизы для всех тайтлов' },
            onChange: function () { W('yummy_match', {}); mem = {}; Lampa.Noty.show('Сопоставления сброшены'); }
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
        window.__yummy_test = { norm: norm, sim: sim, score: score, mapY: mapY, mapRel: mapRel, mapA: mapA, autoPick: autoPick, pickUrl: pickUrl, pickQueries: pickQueries, baseTitle: baseTitle, seasonOf: seasonOf, qualityMap: qualityMap, fixUrl: fixUrl };
        return;
    }
    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
