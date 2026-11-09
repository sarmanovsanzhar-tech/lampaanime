/**
 * Plugin Name: YummiAnime for Lampa (with AniLibria Voiceover)
 * Version: 1.0.0
 * Description: Каталог аниме YummiAnime (api.yani.tv) с сопоставлением и воспроизведением HLS-потоков AniLibria.
 */
(function () {
    'use strict';

    if (window.yummi_anilibria_plugin_loaded) return;
    window.yummi_anilibria_plugin_loaded = true;

    /* =========================================================================
     * 1. MODULE: storage.js
     * ========================================================================= */
    var Storage = (function () {
        var PREFIX = 'yummi_anilibria_';
        var memoryCache = {};
        var memoryKeys = [];
        var inflightRequests = {};

        function get(key, defaultVal) {
            return Lampa.Storage.get(PREFIX + key, defaultVal !== undefined ? defaultVal : null);
        }

        function set(key, value) {
            Lampa.Storage.set(PREFIX + key, value);
        }

        function getCached(cacheKey) {
            var entry = memoryCache[cacheKey];
            if (entry) {
                if (Date.now() < entry.expiry) return entry.data;
                delete memoryCache[cacheKey];
            }
            return null;
        }

        function setCached(cacheKey, data, ttlSeconds) {
            var ttl = ttlSeconds || 900;
            if (!memoryCache[cacheKey]) memoryKeys.push(cacheKey);
            memoryCache[cacheKey] = {
                data: data,
                expiry: Date.now() + (ttl * 1000)
            };
            if (memoryKeys.length > 150) {
                var oldest = memoryKeys.shift();
                delete memoryCache[oldest];
            }
        }

        function deduplicateRequest(key, requestFn) {
            var cached = getCached(key);
            if (cached) return Promise.resolve(cached);

            if (inflightRequests[key]) {
                return inflightRequests[key];
            }

            var promise = requestFn().then(function (res) {
                delete inflightRequests[key];
                return res;
            }).catch(function (err) {
                delete inflightRequests[key];
                throw err;
            });

            inflightRequests[key] = promise;
            return promise;
        }

        function getFavorites() {
            return get('favorites', []);
        }

        function isFavorite(animeId) {
            var favs = getFavorites();
            for (var i = 0; i < favs.length; i++) {
                if (String(favs[i].anime_id) === String(animeId)) return true;
            }
            return false;
        }

        function toggleFavorite(animeCard) {
            var favs = getFavorites();
            var exists = isFavorite(animeCard.anime_id);
            if (exists) {
                favs = favs.filter(function (item) {
                    return String(item.anime_id) !== String(animeCard.anime_id);
                });
            } else {
                favs.unshift({
                    anime_id: animeCard.anime_id,
                    anime_url: animeCard.anime_url,
                    title: animeCard.title,
                    original_title: animeCard.original_title,
                    poster: animeCard.poster,
                    year: animeCard.year,
                    rating: animeCard.rating,
                    status: animeCard.status,
                    episodes_count: animeCard.episodes_count,
                    genres: animeCard.genres || [],
                    added_at: Date.now()
                });
            }
            set('favorites', favs.slice(0, 200));
            return !exists;
        }

        function getWatchHistory() {
            return get('watch_history', []);
        }

        function getAnimeProgress(animeId) {
            var history = getWatchHistory();
            for (var i = 0; i < history.length; i++) {
                if (String(history[i].anime_id) === String(animeId)) return history[i];
            }
            return null;
        }

        function saveAnimeProgress(animeCard, episodeNumber, releaseCode) {
            var history = getWatchHistory().filter(function (h) {
                return String(h.anime_id) !== String(animeCard.anime_id);
            });

            history.unshift({
                anime_id: animeCard.anime_id,
                anime_url: animeCard.anime_url,
                title: animeCard.title,
                original_title: animeCard.original_title,
                poster: animeCard.poster,
                year: animeCard.year,
                rating: animeCard.rating,
                status: animeCard.status,
                episodes_count: animeCard.episodes_count,
                genres: animeCard.genres || [],
                last_episode: Number(episodeNumber),
                release_code: releaseCode || '',
                updated_at: Date.now()
            });

            set('watch_history', history.slice(0, 100));
        }

        return {
            get: get,
            set: set,
            getCached: getCached,
            setCached: setCached,
            deduplicateRequest: deduplicateRequest,
            getFavorites: getFavorites,
            isFavorite: isFavorite,
            toggleFavorite: toggleFavorite,
            getWatchHistory: getWatchHistory,
            getAnimeProgress: getAnimeProgress,
            saveAnimeProgress: saveAnimeProgress
        };
    })();

    /* =========================================================================
     * 2. MODULE: catalog.js (YummiAnime API v2)
     * ========================================================================= */
    var Catalog = (function () {
        var API_BASE = 'https://api.yani.tv';
        var TIMEOUT = 12000;

        function request(endpoint, params, cacheTtl) {
            var p = params || {};
            var ttl = cacheTtl || 600;
            var query = Object.keys(p)
                .filter(function (k) { return p[k] !== undefined && p[k] !== null && p[k] !== ''; })
                .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); })
                .join('&');

            var url = API_BASE + endpoint + (query ? '?' + query : '');
            var cacheKey = 'yani_' + url;

            return Storage.deduplicateRequest(cacheKey, function () {
                return new Promise(function (resolve, reject) {
                    var net = new Lampa.Reguest();
                    net.timeout(TIMEOUT);
                    net.silent(url, function (json) {
                        var payload = (json && json.response !== undefined) ? json.response : json;
                        if (payload) {
                            Storage.setCached(cacheKey, payload, ttl);
                            resolve(payload);
                        } else {
                            reject(new Error('Пустой ответ от YummiAnime API'));
                        }
                    }, function (err, code) {
                        reject(new Error('Ошибка сети YummiAnime (' + (code || 'тайм-аут') + ')'));
                    }, false, {
                        headers: {
                            'Accept': 'application/json',
                            'Accept-Language': 'ru'
                        }
                    });
                });
            });
        }

        function normalizePoster(posterObj) {
            if (!posterObj) return '';
            var url = posterObj.big || posterObj.fullsize || posterObj.medium || posterObj.small || '';
            if (url && url.indexOf('//') === 0) url = 'https:' + url;
            if (url && url.indexOf('/') === 0) url = 'https://yani.tv' + url;
            return url;
        }

        function normalizeStatus(statusObj) {
            if (!statusObj) return 'Вышел';
            if (typeof statusObj === 'string') return statusObj;
            var map = { ongoing: 'Онгоинг', released: 'Вышел', announcement: 'Анонс' };
            return statusObj.title || map[statusObj.alias] || 'Вышел';
        }

        function normalizeCard(raw) {
            var ratingVal = (raw.rating && raw.rating.average) ? Number(raw.rating.average).toFixed(1) : '—';
            var epTotal = raw.episodes ? (raw.episodes.count || raw.episodes.aired || 0) : 0;
            var genresArr = (raw.genres || []).map(function (g) { return g.title || g; });

            return {
                anime_id: raw.anime_id || raw.id,
                anime_url: raw.anime_url || String(raw.anime_id || raw.id),
                title: raw.title || 'Без названия',
                original_title: (raw.other_titles && raw.other_titles[0]) || raw.original || '',
                other_titles: raw.other_titles || [],
                year: raw.year || '',
                rating: ratingVal,
                poster: normalizePoster(raw.poster),
                status: normalizeStatus(raw.anime_status || raw.status),
                episodes_count: epTotal,
                genres: genresArr,
                description: raw.description || 'Описание отсутствует.',
                remote_ids: raw.remote_ids || {}
            };
        }

        function getPopular(page, limit) {
            var l = limit || 20;
            var offset = ((page || 1) - 1) * l;
            return request('/anime', { sort: 'top', limit: l, offset: offset }).then(function (list) {
                return (Array.isArray(list) ? list : []).map(normalizeCard);
            });
        }

        function getNewReleases(page, limit) {
            var l = limit || 20;
            var offset = ((page || 1) - 1) * l;
            var y = new Date().getFullYear();
            return request('/anime', { sort: 'year', from_year: y - 1, limit: l, offset: offset }).then(function (list) {
                return (Array.isArray(list) ? list : []).map(normalizeCard);
            });
        }

        function getOngoings(page, limit) {
            var l = limit || 20;
            var offset = ((page || 1) - 1) * l;
            return request('/anime', { status: 'ongoing', sort: 'top', limit: l, offset: offset }).then(function (list) {
                return (Array.isArray(list) ? list : []).map(normalizeCard);
            });
        }

        function getUpdates(page, limit) {
            var l = limit || 20;
            var offset = ((page || 1) - 1) * l;
            return request('/anime', { sort: 'updates', limit: l, offset: offset }, 180).then(function (list) {
                return (Array.isArray(list) ? list : []).map(normalizeCard);
            });
        }

        function getByGenre(genreAlias, page, limit) {
            var l = limit || 20;
            var offset = ((page || 1) - 1) * l;
            return request('/anime', { genres: genreAlias, sort: 'top', limit: l, offset: offset }).then(function (list) {
                return (Array.isArray(list) ? list : []).map(normalizeCard);
            });
        }

        function getGenres() {
            return request('/anime/genres', {}, 86400).then(function (res) {
                if (Array.isArray(res)) return res;
                if (res && Array.isArray(res.genres)) return res.genres;
                return [];
            });
        }

        return {
            request: request,
            normalizeCard: normalizeCard,
            getPopular: getPopular,
            getNewReleases: getNewReleases,
            getOngoings: getOngoings,
            getUpdates: getUpdates,
            getByGenre: getByGenre,
            getGenres: getGenres
        };
    })();

    /* =========================================================================
     * 3. MODULE: search.js
     * ========================================================================= */
    var Search = (function () {
        function cleanQuery(q) {
            return String(q || '')
                .replace(/[^\w\sа-яА-ЯёЁ\-\:]/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function searchAnime(query, page, limit) {
            var cleaned = cleanQuery(query);
            if (!cleaned || cleaned.length < 2) return Promise.resolve([]);
            var l = limit || 20;
            var offset = ((page || 1) - 1) * l;
            return Catalog.request('/anime', { q: cleaned, limit: l, offset: offset }, 300).then(function (list) {
                return (Array.isArray(list) ? list : []).map(Catalog.normalizeCard);
            });
        }

        return {
            cleanQuery: cleanQuery,
            searchAnime: searchAnime
        };
    })();

    /* =========================================================================
     * 4. MODULE: anilibria.js
     * ========================================================================= */
    var AniLibria = (function () {
        var V3_BASE = 'https://api.anilibria.tv/v3';
        var V1_FALLBACK = 'https://anilibria.top/api/v1';
        var TIMEOUT = 10000;

        function normalizeString(str) {
            if (!str) return '';
            return String(str)
                .toLowerCase()
                .replace(/ё/g, 'е')
                .replace(/\[.*?\]|\(.*?\)/g, '')
                .replace(/(тв|tv|сезон|season|part|часть)\s*[-:]?\s*\d+/gi, '')
                .replace(/[^a-zа-я0-9]/gi, '')
                .trim();
        }

        function extractSeasonNumber(title) {
            if (!title) return 1;
            var m1 = title.match(/(?:сезон|season|тв|tv)\s*[-:]?\s*(\d+)/i);
            if (m1) return parseInt(m1[1], 10);
            var m2 = title.match(/\s+(\d+)\s*$/);
            if (m2 && parseInt(m2[1], 10) < 15) return parseInt(m2[1], 10);
            return 1;
        }

        function calculateSimilarity(s1, s2) {
            var a = normalizeString(s1);
            var b = normalizeString(s2);
            if (!a || !b) return 0;
            if (a === b) return 1.0;
            if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
                var ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
                return 0.75 + (ratio * 0.2);
            }
            return 0;
        }

        function requestV3(endpoint, params) {
            var p = params || {};
            var query = Object.keys(p)
                .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); })
                .join('&');
            var url = V3_BASE + endpoint + (query ? '?' + query : '');
            var cacheKey = 'anilib_v3_' + url;

            return Storage.deduplicateRequest(cacheKey, function () {
                return new Promise(function (resolve, reject) {
                    var net = new Lampa.Reguest();
                    net.timeout(TIMEOUT);
                    net.silent(url, function (json) {
                        Storage.setCached(cacheKey, json, 900);
                        resolve(json);
                    }, function (err, code) {
                        reject(new Error('AniLibria v3 (' + (code || 'timeout') + ')'));
                    });
                });
            });
        }

        function requestV1Fallback(queryStr) {
            var url = V1_FALLBACK + '/app/search/releases?query=' + encodeURIComponent(queryStr);
            var cacheKey = 'anilib_v1_' + url;

            return Storage.deduplicateRequest(cacheKey, function () {
                return new Promise(function (resolve, reject) {
                    var net = new Lampa.Reguest();
                    net.timeout(TIMEOUT);
                    net.silent(url, function (json) {
                        Storage.setCached(cacheKey, json, 900);
                        resolve(json);
                    }, function (err) {
                        reject(err);
                    });
                });
            });
        }

        function normalizeV3Release(item) {
            if (!item || !item.player) return null;
            var rawHost = item.player.host || 'cache.libria.fun';
            var host = 'https://' + rawHost.replace(/^https?:\/\//, '');
            var rawList = item.player.list || item.player.episodes || {};
            var episodes = [];

            Object.keys(rawList).forEach(function (key) {
                var ep = rawList[key];
                if (!ep || !ep.hls) return;
                var epNum = ep.episode || parseInt(key, 10);
                var streams = {};
                if (ep.hls.fhd) streams['1080p'] = ep.hls.fhd.indexOf('http') === 0 ? ep.hls.fhd : host + ep.hls.fhd;
                if (ep.hls.hd)  streams['720p']  = ep.hls.hd.indexOf('http') === 0  ? ep.hls.hd  : host + ep.hls.hd;
                if (ep.hls.sd)  streams['480p']  = ep.hls.sd.indexOf('http') === 0  ? ep.hls.sd  : host + ep.hls.sd;

                var bestQuality = streams['1080p'] ? '1080p' : (streams['720p'] ? '720p' : '480p');
                var defaultUrl = streams['1080p'] || streams['720p'] || streams['480p'];

                if (defaultUrl) {
                    episodes.push({
                        episode: Number(epNum),
                        name: ep.name || ('Серия ' + epNum),
                        url: defaultUrl,
                        qualities: streams,
                        max_quality: bestQuality
                    });
                }
            });

            episodes.sort(function (a, b) { return a.episode - b.episode; });

            var voiceTeam = (item.team && Array.isArray(item.team.voice) && item.team.voice.length)
                ? 'AniLibria (' + item.team.voice.join(', ') + ')'
                : 'AniLibria.TV';

            var has1080 = episodes.some(function (e) { return Boolean(e.qualities['1080p']); });
            var has720 = episodes.some(function (e) { return Boolean(e.qualities['720p']); });
            var maxRes = has1080 ? '1080p FHD' : (has720 ? '720p HD' : '480p SD');

            return {
                id: item.id,
                code: item.code,
                ru_title: (item.names && item.names.ru) || '',
                en_title: (item.names && item.names.en) || '',
                alt_title: (item.names && item.names.alternative) || '',
                year: item.season ? item.season.year : null,
                team_name: voiceTeam,
                quality_label: maxRes,
                episodes: episodes
            };
        }

        function normalizeV1Release(item) {
            if (!item) return null;
            var episodes = (item.episodes || []).map(function (ep) {
                var streams = {};
                if (ep.hls_1080) streams['1080p'] = ep.hls_1080;
                if (ep.hls_720)  streams['720p']  = ep.hls_720;
                if (ep.hls_480)  streams['480p']  = ep.hls_480;
                var defaultUrl = streams['1080p'] || streams['720p'] || streams['480p'];
                if (!defaultUrl) return null;
                return {
                    episode: Number(ep.ordinal || ep.sort_order || 1),
                    name: ep.name || ('Серия ' + (ep.ordinal || 1)),
                    url: defaultUrl,
                    qualities: streams,
                    max_quality: streams['1080p'] ? '1080p' : (streams['720p'] ? '720p' : '480p')
                };
            }).filter(Boolean);

            return {
                id: item.id,
                code: item.alias || String(item.id),
                ru_title: item.name ? item.name.main : '',
                en_title: item.name ? item.name.english : '',
                alt_title: item.name ? item.name.alternative : '',
                year: item.year || null,
                team_name: 'AniLibria.TOP',
                quality_label: '1080p FHD',
                episodes: episodes
            };
        }

        function scoreRelease(yummiData, libriaRelease) {
            var score = 0;
            var targetTitles = [yummiData.title, yummiData.original_title]
                .concat(yummiData.other_titles || [])
                .filter(Boolean);

            var candidateTitles = [
                libriaRelease.ru_title,
                libriaRelease.en_title,
                libriaRelease.alt_title
            ].filter(Boolean);

            var bestTitleSim = 0;
            targetTitles.forEach(function (t1) {
                candidateTitles.forEach(function (t2) {
                    var sim = calculateSimilarity(t1, t2);
                    if (sim > bestTitleSim) bestTitleSim = sim;
                });
            });

            score += bestTitleSim * 70;

            if (yummiData.year && libriaRelease.year) {
                var diff = Math.abs(Number(yummiData.year) - Number(libriaRelease.year));
                if (diff === 0) score += 20;
                else if (diff === 1) score += 10;
                else score -= 15;
            }

            var yummiSeason = extractSeasonNumber(yummiData.title);
            var libriaSeason = extractSeasonNumber(libriaRelease.ru_title || libriaRelease.en_title);
            if (yummiSeason === libriaSeason) score += 10;
            else score -= 20;

            return score;
        }

        function findMatchingReleases(yummiDetails) {
            var matchedReleases = [];
            var seenCodes = {};

            function addCandidate(norm, customScore) {
                if (!norm || !norm.episodes || norm.episodes.length === 0) return;
                if (seenCodes[norm.code]) return;
                var sc = customScore !== undefined ? customScore : scoreRelease(yummiDetails, norm);
                if (sc >= 45) {
                    norm.match_score = sc;
                    matchedReleases.push(norm);
                    seenCodes[norm.code] = true;
                }
            }

            var directPromise = Promise.resolve();
            if (yummiDetails.remote_ids && yummiDetails.remote_ids.anilibria_alias) {
                directPromise = requestV3('/title', {
                    code: yummiDetails.remote_ids.anilibria_alias,
                    filter: 'id,code,names,season,player,team'
                }).then(function (direct) {
                    addCandidate(normalizeV3Release(direct), 100);
                }).catch(function () {});
            }

            return directPromise.then(function () {
                var cleanRu = yummiDetails.title ? yummiDetails.title.replace(/\[.*?\]|\(.*?\)/g, '').trim() : '';
                var queries = [cleanRu, yummiDetails.original_title || ''].filter(function (q) {
                    return q && q.length >= 2;
                });

                var chain = Promise.resolve();
                queries.forEach(function (q) {
                    chain = chain.then(function () {
                        return requestV3('/title/search', {
                            search: q,
                            filter: 'id,code,names,season,player,team',
                            limit: 10
                        }).then(function (res) {
                            var list = (res && res.list) ? res.list : [];
                            list.forEach(function (item) {
                                addCandidate(normalizeV3Release(item));
                            });
                        }).catch(function () {
                            return requestV1Fallback(q).then(function (fallbackList) {
                                if (Array.isArray(fallbackList)) {
                                    fallbackList.forEach(function (item) {
                                        addCandidate(normalizeV1Release(item));
                                    });
                                }
                            }).catch(function () {});
                        });
                    });
                });

                return chain;
            }).then(function () {
                matchedReleases.sort(function (a, b) { return b.match_score - a.match_score; });
                return matchedReleases;
            });
        }

        return {
            findMatchingReleases: findMatchingReleases,
            extractSeasonNumber: extractSeasonNumber
        };
    })();

    /* =========================================================================
     * 5. MODULE: anime.js
     * ========================================================================= */
    var AnimeDetails = (function () {
        function loadFullAnime(animeIdOrUrl) {
            return Catalog.request('/anime/' + encodeURIComponent(animeIdOrUrl), { need_videos: 1 }, 600)
                .then(function (raw) {
                    var card = Catalog.normalizeCard(raw);
                    card.season_number = AniLibria.extractSeasonNumber(card.title);
                    card.videos = Array.isArray(raw.videos) ? raw.videos : [];

                    return AniLibria.findMatchingReleases(card).then(function (releases) {
                        return {
                            card: card,
                            anilibria_releases: releases,
                            anilibria_error: null
                        };
                    }).catch(function (err) {
                        return {
                            card: card,
                            anilibria_releases: [],
                            anilibria_error: err.message || 'Ошибка подключения к AniLibria'
                        };
                    });
                });
        }

        return {
            loadFullAnime: loadFullAnime
        };
    })();

    /* =========================================================================
     * 6. MODULE: player.js
     * ========================================================================= */
    var Player = (function () {
        function playEpisode(animeCard, release, episodeNumber, onEpisodeChangeCallback) {
            if (!release || !release.episodes || release.episodes.length === 0) {
                Lampa.Noty.show('Видеопотоки AniLibria для этого релиза недоступны');
                return;
            }

            var playlist = release.episodes.map(function (ep) {
                return {
                    title: animeCard.title + ' — Серия ' + ep.episode + (ep.name ? ' (' + ep.name + ')' : ''),
                    url: ep.url,
                    quality: ep.qualities,
                    episode: ep.episode,
                    timeline: Lampa.Timeline.view('yummi_' + animeCard.anime_id + '_ep_' + ep.episode)
                };
            });

            var targetIndex = -1;
            for (var i = 0; i < playlist.length; i++) {
                if (Number(playlist[i].episode) === Number(episodeNumber)) {
                    targetIndex = i;
                    break;
                }
            }
            var activeItem = targetIndex !== -1 ? playlist[targetIndex] : playlist[0];

            Storage.saveAnimeProgress(animeCard, activeItem.episode, release.code);
            if (typeof onEpisodeChangeCallback === 'function') {
                onEpisodeChangeCallback(activeItem.episode);
            }

            Lampa.Player.play(activeItem);
            Lampa.Player.playlist(playlist);

            if (Lampa.Player.listener) {
                var onPlayerStart = function (data) {
                    if (data && data.episode) {
                        Storage.saveAnimeProgress(animeCard, data.episode, release.code);
                        if (typeof onEpisodeChangeCallback === 'function') {
                            onEpisodeChangeCallback(data.episode);
                        }
                    }
                };
                Lampa.Player.listener.follow('start', onPlayerStart);
                Lampa.Player.listener.follow('destroy', function () {
                    Lampa.Player.listener.remove('start', onPlayerStart);
                });
            }
        }

        return {
            playEpisode: playEpisode
        };
    })();

    /* =========================================================================
     * 7. MODULE: ui.js
     * ========================================================================= */
    var UI = (function () {
        function injectStyles() {
            if (document.getElementById('yummi-anilibria-styles')) return;
            var css = [
                '.yummi-wrap { display: flex; flex-direction: column; height: 100%; padding: 1.5em 2em; box-sizing: border-box; }',
                '.yummi-nav { display: flex; flex-wrap: nowrap; gap: 0.8em; margin-bottom: 1.4em; overflow-x: auto; padding-bottom: 0.4em; flex-shrink: 0; }',
                '.yummi-tab { padding: 0.65em 1.2em; border-radius: 0.6em; background: rgba(255,255,255,0.08); color: #ddd; font-size: 1.05em; font-weight: 500; white-space: nowrap; transition: transform 0.2s ease, background 0.2s ease; cursor: pointer; }',
                '.yummi-tab.focus { background: #fff; color: #111; transform: scale(1.06); box-shadow: 0 4px 16px rgba(0,0,0,0.4); }',
                '.yummi-tab.active { border-bottom: 3px solid #e53935; }',
                '.yummi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5em, 1fr)); gap: 1.5em; padding: 0.5em 0.2em 4em 0.2em; }',
                '.yummi-card { display: flex; flex-direction: column; border-radius: 0.8em; transition: transform 0.22s ease; position: relative; cursor: pointer; }',
                '.yummi-card__img-box { position: relative; width: 100%; padding-top: 145%; border-radius: 0.8em; overflow: hidden; background: #1e1e24; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }',
                '.yummi-card__img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }',
                '.yummi-card.focus { transform: scale(1.06); z-index: 5; }',
                '.yummi-card.focus .yummi-card__img-box { box-shadow: 0 0 0 3px #fff, 0 10px 28px rgba(0,0,0,0.65); }',
                '.yummi-badge-rating { position: absolute; top: 0.6em; left: 0.6em; background: rgba(0,0,0,0.78); color: #ffca28; padding: 0.25em 0.55em; border-radius: 0.4em; font-weight: 700; font-size: 0.85em; }',
                '.yummi-badge-status { position: absolute; top: 0.6em; right: 0.6em; background: rgba(229,57,53,0.9); color: #fff; padding: 0.22em 0.55em; border-radius: 0.4em; font-size: 0.75em; font-weight: 600; }',
                '.yummi-badge-ep { position: absolute; bottom: 0.6em; right: 0.6em; background: rgba(0,0,0,0.82); color: #fff; padding: 0.2em 0.5em; border-radius: 0.4em; font-size: 0.78em; }',
                '.yummi-card__title { margin-top: 0.6em; font-size: 1em; font-weight: 600; color: #fff; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
                '.yummi-card__orig { font-size: 0.8em; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.15em; }',
                '.yummi-card__meta { font-size: 0.8em; color: rgba(255,255,255,0.65); margin-top: 0.2em; }',
                '.yummi-details { padding: 1.5em 2.5em 4em 2.5em; }',
                '.yummi-hero { display: flex; gap: 2.2em; margin-bottom: 2em; background: rgba(255,255,255,0.03); padding: 1.8em; border-radius: 1.1em; }',
                '.yummi-hero__poster { width: 15.5em; height: 22.5em; object-fit: cover; border-radius: 0.8em; flex-shrink: 0; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }',
                '.yummi-hero__info { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }',
                '.yummi-hero__title { font-size: 2.1em; font-weight: 700; color: #fff; margin: 0 0 0.2em 0; line-height: 1.15; }',
                '.yummi-hero__orig { font-size: 1.05em; color: rgba(255,255,255,0.55); margin-bottom: 0.9em; }',
                '.yummi-tags { display: flex; flex-wrap: wrap; gap: 0.6em; margin-bottom: 1em; }',
                '.yummi-tag { background: rgba(255,255,255,0.1); padding: 0.3em 0.75em; border-radius: 0.45em; font-size: 0.88em; color: #eee; }',
                '.yummi-tag--gold { background: rgba(255,202,40,0.18); color: #ffca28; font-weight: 700; }',
                '.yummi-desc { font-size: 1em; line-height: 1.5; color: rgba(255,255,255,0.82); margin-bottom: 1.4em; max-height: 7.5em; overflow-y: auto; }',
                '.yummi-actions { display: flex; flex-wrap: wrap; gap: 0.9em; }',
                '.yummi-btn { padding: 0.75em 1.4em; border-radius: 0.6em; background: rgba(255,255,255,0.12); color: #fff; font-weight: 600; font-size: 1em; cursor: pointer; transition: all 0.2s ease; }',
                '.yummi-btn--primary { background: #e53935; color: #fff; }',
                '.yummi-btn.focus { background: #fff; color: #111; transform: scale(1.05); box-shadow: 0 4px 18px rgba(0,0,0,0.5); }',
                '.yummi-section-title { font-size: 1.35em; font-weight: 700; margin: 1.2em 0 0.8em 0; color: #fff; }',
                '.yummi-voices { display: flex; flex-wrap: wrap; gap: 0.8em; margin-bottom: 1.5em; }',
                '.yummi-voice-item { padding: 0.7em 1.2em; border-radius: 0.6em; background: rgba(255,255,255,0.07); color: #ddd; cursor: pointer; transition: all 0.2s ease; }',
                '.yummi-voice-item.active { border: 2px solid #e53935; background: rgba(229,57,53,0.18); color: #fff; }',
                '.yummi-voice-item.focus { background: #fff; color: #111; transform: scale(1.04); }',
                '.yummi-ep-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11em, 1fr)); gap: 0.9em; padding-bottom: 3em; }',
                '.yummi-ep-btn { padding: 0.85em 1em; border-radius: 0.6em; background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; transition: all 0.18s ease; display: flex; flex-direction: column; gap: 0.25em; }',
                '.yummi-ep-btn.watched { border-left: 4px solid #4caf50; background: rgba(76,175,80,0.12); }',
                '.yummi-ep-btn.current { border: 2px solid #ffca28; }',
                '.yummi-ep-btn.focus { background: #fff; color: #111; transform: scale(1.05); }',
                '.yummi-ep-num { font-weight: 700; font-size: 1.05em; }',
                '.yummi-ep-name { font-size: 0.8em; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
                '.yummi-empty { padding: 2.5em; text-align: center; background: rgba(255,255,255,0.04); border-radius: 0.8em; color: rgba(255,255,255,0.7); font-size: 1.1em; }'
            ].join('\n');

            var style = document.createElement('style');
            style.id = 'yummi-anilibria-styles';
            style.textContent = css;
            document.head.appendChild(style);
        }

        function CatalogComponent(object) {
            var self = this;
            var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
            var html = $('<div></div>').addClass('yummi-wrap');
            var navBar = $('<div></div>').addClass('yummi-nav');
            var grid = $('<div></div>').addClass('yummi-grid');

            var activeTab = object.tab || 'popular';
            var activeGenre = object.genre || '';
            var searchQuery = object.query || '';
            var currentPage = 1;
            var isLoading = false;
            var hasMore = true;
            var lastFocused = null;

            var tabs = [
                { id: 'popular', title: 'Популярное' },
                { id: 'new', title: 'Новинки' },
                { id: 'ongoing', title: 'Онгоинги' },
                { id: 'updates', title: 'Обновления' },
                { id: 'genres', title: 'Жанры' },
                { id: 'search', title: 'Поиск' },
                { id: 'continue', title: 'Продолжить просмотр' },
                { id: 'favorites', title: 'Избранное' }
            ];

            function buildNav() {
                navBar.empty();
                tabs.forEach(function (t) {
                    var btn = $('<div class="yummi-tab selector">' + t.title + '</div>');
                    if (t.id === activeTab) btn.addClass('active');

                    btn.on('hover:focus', function () {
                        lastFocused = this;
                    });

                    btn.on('hover:enter', function () {
                        if (t.id === 'search') {
                            Lampa.Input.edit({
                                title: 'Поиск аниме (рус / оригинал)',
                                value: searchQuery,
                                free: true,
                                nosave: true
                            }, function (newVal) {
                                if (newVal && newVal.trim().length >= 2) {
                                    searchQuery = newVal.trim();
                                    switchTab('search');
                                }
                            });
                        } else if (t.id === 'genres') {
                            openGenreModal();
                        } else {
                            switchTab(t.id);
                        }
                    });

                    navBar.append(btn);
                });
            }

            function openGenreModal() {
                Catalog.getGenres().then(function (genres) {
                    if (!genres.length) {
                        Lampa.Noty.show('Список жанров пуст');
                        return;
                    }
                    var items = genres.map(function (g) {
                        return { title: g.title, alias: g.alias || g.id };
                    });
                    Lampa.Select.show({
                        title: 'Выберите жанр',
                        items: items,
                        onSelect: function (selected) {
                            activeGenre = selected.alias;
                            switchTab('genres');
                            Lampa.Controller.toggle('content');
                        },
                        onBack: function () {
                            Lampa.Controller.toggle('content');
                        }
                    });
                }).catch(function (err) {
                    Lampa.Noty.show(err.message);
                });
            }

            function switchTab(tabId) {
                activeTab = tabId;
                currentPage = 1;
                hasMore = true;
                grid.empty();
                buildNav();
                loadData(false);
            }

            function createCardElement(item) {
                var genresText = (item.genres || []).slice(0, 2).join(', ');
                var epBadge = item.last_episode
                    ? 'Серия ' + item.last_episode
                    : (item.episodes_count ? item.episodes_count + ' сер.' : 'ТВ');

                var card = $([
                    '<div class="yummi-card selector">',
                        '<div class="yummi-card__img-box">',
                            '<img class="yummi-card__img" src="' + (item.poster || './img/img_broken.svg') + '" alt="" loading="lazy" />',
                            '<div class="yummi-badge-rating">★ ' + (item.rating || '—') + '</div>',
                            (item.status ? '<div class="yummi-badge-status">' + item.status + '</div>' : ''),
                            '<div class="yummi-badge-ep">' + epBadge + '</div>',
                        '</div>',
                        '<div class="yummi-card__title">' + item.title + '</div>',
                        '<div class="yummi-card__orig">' + (item.original_title || '') + '</div>',
                        '<div class="yummi-card__meta">' + (item.year ? item.year : '') + (genresText ? ' • ' + genresText : '') + '</div>',
                    '</div>'
                ].join(''));

                card.on('hover:focus', function () {
                    lastFocused = this;
                    scroll.update($(this), true);
                    var index = grid.children().index(this);
                    if (hasMore && !isLoading && index >= grid.children().length - 6) {
                        currentPage++;
                        loadData(true);
                    }
                });

                card.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '',
                        title: item.title,
                        component: 'yummi_anime_details',
                        anime_id: item.anime_url || item.anime_id,
                        page: 1
                    });
                });

                return card;
            }

            function loadData(append) {
                if (isLoading) return;
                isLoading = true;

                if (!append) self.activity.loader(true);

                var promise;
                if (activeTab === 'popular') promise = Catalog.getPopular(currentPage);
                else if (activeTab === 'new') promise = Catalog.getNewReleases(currentPage);
                else if (activeTab === 'ongoing') promise = Catalog.getOngoings(currentPage);
                else if (activeTab === 'updates') promise = Catalog.getUpdates(currentPage);
                else if (activeTab === 'genres') promise = Catalog.getByGenre(activeGenre || 'action', currentPage);
                else if (activeTab === 'search') promise = Search.searchAnime(searchQuery, currentPage);
                else if (activeTab === 'favorites') {
                    hasMore = false;
                    promise = Promise.resolve(Storage.getFavorites());
                } else if (activeTab === 'continue') {
                    hasMore = false;
                    promise = Promise.resolve(Storage.getWatchHistory());
                }

                promise.then(function (list) {
                    isLoading = false;
                    self.activity.loader(false);

                    if (!list || list.length === 0) {
                        hasMore = false;
                        if (!append) {
                            grid.html('<div class="yummi-empty">Список пуст или ничего не найдено</div>');
                        }
                        Lampa.Controller.enable('content');
                        return;
                    }

                    if (list.length < 15) hasMore = false;

                    list.forEach(function (item) {
                        grid.append(createCardElement(item));
                    });

                    Lampa.Controller.enable('content');
                }).catch(function (err) {
                    isLoading = false;
                    self.activity.loader(false);
                    if (!append) {
                        grid.html('<div class="yummi-empty">Ошибка загрузки: ' + err.message + '</div>');
                    }
                    Lampa.Noty.show(err.message);
                    Lampa.Controller.enable('content');
                });
            }

            this.create = function () {
                injectStyles();
                this.activity.loader(true);
                buildNav();
                scroll.append(grid);
                html.append(navBar);
                html.append(scroll.render());
                loadData(false);
                return this.render();
            };

            this.start = function () {
                Lampa.Controller.add('content', {
                    toggle: function () {
                        Lampa.Controller.collectionSet(html);
                        Lampa.Controller.collectionFocus(lastFocused || false, html);
                    },
                    left: function () {
                        if (Navigator.canmove('left')) Navigator.move('left');
                        else Lampa.Controller.toggle('menu');
                    },
                    right: function () {
                        if (Navigator.canmove('right')) Navigator.move('right');
                    },
                    up: function () {
                        if (Navigator.canmove('up')) Navigator.move('up');
                        else Lampa.Controller.toggle('head');
                    },
                    down: function () {
                        if (Navigator.canmove('down')) Navigator.move('down');
                    },
                    back: function () {
                        Lampa.Activity.backward();
                    }
                });
                Lampa.Controller.toggle('content');
            };

            this.pause = function () {};
            this.stop = function () {};
            this.render = function () { return html; };
            this.destroy = function () {
                scroll.destroy();
                html.remove();
            };
        }

        function DetailsComponent(object) {
            var self = this;
            var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
            var container = $('<div></div>').addClass('yummi-details');
            var lastFocused = null;
            var selectedRelease = null;

            this.create = function () {
                injectStyles();
                this.activity.loader(true);
                scroll.append(container);

                AnimeDetails.loadFullAnime(object.anime_id).then(function (data) {
                    self.activity.loader(false);
                    renderDetails(data);
                    Lampa.Controller.enable('content');
                }).catch(function (err) {
                    self.activity.loader(false);
                    container.html('<div class="yummi-empty">Не удалось открыть карточку аниме: ' + err.message + '</div>');
                    Lampa.Controller.enable('content');
                });

                return this.render();
            };

            function renderDetails(data) {
                container.empty();
                var card = data.card;
                var releases = data.anilibria_releases || [];
                var savedProgress = Storage.getAnimeProgress(card.anime_id);

                if (releases.length > 0 && !selectedRelease) {
                    if (savedProgress && savedProgress.release_code) {
                        var found = releases.filter(function (r) { return r.code === savedProgress.release_code; })[0];
                        selectedRelease = found || releases[0];
                    } else {
                        selectedRelease = releases[0];
                    }
                }

                var isFav = Storage.isFavorite(card.anime_id);
                var resumeEp = savedProgress ? savedProgress.last_episode : 1;
                var genresHtml = (card.genres || []).map(function (g) {
                    return '<span class="yummi-tag">' + g + '</span>';
                }).join('');

                var hero = $([
                    '<div class="yummi-hero">',
                        '<img class="yummi-hero__poster" src="' + (card.poster || './img/img_broken.svg') + '" alt="" />',
                        '<div class="yummi-hero__info">',
                            '<div>',
                                '<h1 class="yummi-hero__title">' + card.title + '</h1>',
                                '<div class="yummi-hero__orig">' + (card.original_title || '') + '</div>',
                                '<div class="yummi-tags">',
                                    '<span class="yummi-tag yummi-tag--gold">★ ' + card.rating + '</span>',
                                    (card.year ? '<span class="yummi-tag">' + card.year + ' г.</span>' : ''),
                                    '<span class="yummi-tag">Сезон: ' + (card.season_number || 1) + '</span>',
                                    '<span class="yummi-tag">' + card.status + '</span>',
                                    '<span class="yummi-tag">Серий: ' + (card.episodes_count || (selectedRelease ? selectedRelease.episodes.length : '?')) + '</span>',
                                    genresHtml,
                                '</div>',
                                '<div class="yummi-desc">' + card.description + '</div>',
                            '</div>',
                            '<div class="yummi-actions"></div>',
                        '</div>',
                    '</div>'
                ].join(''));

                var actionsBox = hero.find('.yummi-actions');

                if (selectedRelease && selectedRelease.episodes.length > 0) {
                    var playLabel = savedProgress ? '▶ Продолжить (Серия ' + resumeEp + ')' : '▶ Смотреть (Серия 1)';
                    var playBtn = $('<div class="yummi-btn yummi-btn--primary selector">' + playLabel + '</div>');
                    playBtn.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
                    playBtn.on('hover:enter', function () {
                        Player.playEpisode(card, selectedRelease, resumeEp, function () { renderDetails(data); });
                    });
                    actionsBox.append(playBtn);

                    if (savedProgress && resumeEp < selectedRelease.episodes.length) {
                        var nextBtn = $('<div class="yummi-btn selector">⏭ Следующая серия (' + (resumeEp + 1) + ')</div>');
                        nextBtn.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
                        nextBtn.on('hover:enter', function () {
                            Player.playEpisode(card, selectedRelease, resumeEp + 1, function () { renderDetails(data); });
                        });
                        actionsBox.append(nextBtn);
                    }
                }

                var favBtn = $('<div class="yummi-btn selector">' + (isFav ? '★ В избранном' : '☆ В избранное') + '</div>');
                favBtn.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
                favBtn.on('hover:enter', function () {
                    var nowFav = Storage.toggleFavorite(card);
                    $(this).text(nowFav ? '★ В избранном' : '☆ В избранное');
                    Lampa.Noty.show(nowFav ? 'Добавлено в Избранное' : 'Удалено из Избранного');
                });
                actionsBox.append(favBtn);

                container.append(hero);
                container.append('<div class="yummi-section-title">Доступная озвучка AniLibria</div>');

                if (releases.length === 0) {
                    var msg = data.anilibria_error
                        ? 'Сервер AniLibria временно недоступен (' + data.anilibria_error + ').'
                        : 'Для данного аниме озвучка AniLibria не найдена.';
                    container.append('<div class="yummi-empty">' + msg + '</div>');
                    return;
                }

                var voicesWrap = $('<div class="yummi-voices"></div>');
                releases.forEach(function (rel) {
                    var activeClass = (selectedRelease && selectedRelease.code === rel.code) ? 'active' : '';
                    var vItem = $([
                        '<div class="yummi-voice-item selector ' + activeClass + '">',
                            '<div><strong>' + rel.team_name + '</strong> — ' + (rel.ru_title || card.title) + '</div>',
                            '<div style="font-size:0.82em; opacity:0.75;">Качество: ' + rel.quality_label + ' • Серий: ' + rel.episodes.length + '</div>',
                        '</div>'
                    ].join(''));

                    vItem.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
                    vItem.on('hover:enter', function () {
                        selectedRelease = rel;
                        renderDetails(data);
                        Lampa.Controller.toggle('content');
                    });
                    voicesWrap.append(vItem);
                });
                container.append(voicesWrap);

                if (selectedRelease && selectedRelease.episodes.length > 0) {
                    container.append('<div class="yummi-section-title">Список серий (' + selectedRelease.episodes.length + ')</div>');
                    var epGrid = $('<div class="yummi-ep-grid"></div>');

                    selectedRelease.episodes.forEach(function (ep) {
                        var isWatched = savedProgress && ep.episode <= savedProgress.last_episode;
                        var isCurrent = savedProgress && ep.episode === savedProgress.last_episode;

                        var epBtn = $([
                            '<div class="yummi-ep-btn selector ' + (isWatched ? 'watched ' : '') + (isCurrent ? 'current' : '') + '">',
                                '<div class="yummi-ep-num">Серия ' + ep.episode + ' <span style="float:right;font-size:0.75em;opacity:0.8;">' + ep.max_quality + '</span></div>',
                                '<div class="yummi-ep-name">' + (ep.name || '') + '</div>',
                            '</div>'
                        ].join(''));

                        epBtn.on('hover:focus', function () {
                            lastFocused = this;
                            scroll.update($(this), true);
                        });

                        epBtn.on('hover:enter', function () {
                            Player.playEpisode(card, selectedRelease, ep.episode, function () {
                                renderDetails(data);
                            });
                        });

                        epGrid.append(epBtn);
                    });

                    container.append(epGrid);
                }
            }

            this.start = function () {
                Lampa.Controller.add('content', {
                    toggle: function () {
                        Lampa.Controller.collectionSet(scroll.render());
                        Lampa.Controller.collectionFocus(lastFocused || false, scroll.render());
                    },
                    left: function () {
                        if (Navigator.canmove('left')) Navigator.move('left');
                        else Lampa.Controller.toggle('menu');
                    },
                    right: function () {
                        if (Navigator.canmove('right')) Navigator.move('right');
                    },
                    up: function () {
                        if (Navigator.canmove('up')) Navigator.move('up');
                        else Lampa.Controller.toggle('head');
                    },
                    down: function () {
                        if (Navigator.canmove('down')) Navigator.move('down');
                    },
                    back: function () {
                        Lampa.Activity.backward();
                    }
                });
                Lampa.Controller.toggle('content');
            };

            this.pause = function () {};
            this.stop = function () {};
            this.render = function () { return scroll.render(); };
            this.destroy = function () {
                scroll.destroy();
                container.remove();
            };
        }

        return {
            CatalogComponent: CatalogComponent,
            DetailsComponent: DetailsComponent
        };
    })();

    /* =========================================================================
     * 8. MODULE: main.js (Bootstrap)
     * ========================================================================= */
    function initPlugin() {
        Lampa.Component.add('yummi_anime_catalog', UI.CatalogComponent);
        Lampa.Component.add('yummi_anime_details', UI.DetailsComponent);

        function registerMenuItem() {
            if ($('.menu__list .menu__item[data-action="yummi_anime"]').length > 0) return;

            var ico = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" fill="currentColor"/></svg>';

            var item = $([
                '<li class="menu__item selector" data-action="yummi_anime">',
                    '<div class="menu__ico">' + ico + '</div>',
                    '<div class="menu__text">Аниме</div>',
                '</li>'
            ].join(''));

            item.on('hover:enter', function () {
                Lampa.Activity.push({
                    url: '',
                    title: 'Аниме — YummiAnime & AniLibria',
                    component: 'yummi_anime_catalog',
                    tab: 'popular',
                    page: 1
                });
            });

            $('.menu .menu__list').eq(0).append(item);
        }

        if (window.appready) {
            registerMenuItem();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') registerMenuItem();
            });
        }
    }

    initPlugin();
})();
