class Dokiraw extends ComicSource {
    name = "Dokiraw";
    key = "dokiraw";
    version = "1.0.3";
    minAppVersion = "1.0.0";
    url = "https://dokiraw.best";

    static BASE = "https://dokiraw.best";

    async _fetch(url) {
        const resp = await Network.get(url, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": Dokiraw.BASE,
        });

        if (resp.status !== 200) throw new Error(`HTTP ${resp.status}: ${url}`);
        return resp.body;
    }

    _htmlDecode(text = "") {
        return text
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, "\"")
            .replace(/&#039;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
            .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
    }

    _stripTags(html = "") {
        return this._htmlDecode(html.replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim());
    }

    _absoluteUrl(url = "") {
        if (!url) return "";
        
        let clean = String(url).replace(/\\\//g, "/").trim();
        if (!clean) return "";
        
        clean = this._htmlDecode(clean);
        
        if (/^https?:\/\//i.test(clean)) {
            return clean.split('/').map((part, idx) => {
                if (idx < 3) return part;
                return encodeURIComponent(decodeURIComponent(part));
            }).join('/');
        }
        
        if (clean.startsWith("//")) {
            const absUrl = `https:${clean}`;
            return absUrl.split('/').map((part, idx) => {
                if (idx < 3) return part;
                return encodeURIComponent(decodeURIComponent(part));
            }).join('/');
        }
        
        if (clean.startsWith("/")) {
            const absUrl = `${Dokiraw.BASE}${clean}`;
            return absUrl.split('/').map((part, idx) => {
                if (idx < 3) return part;
                return encodeURIComponent(decodeURIComponent(part));
            }).join('/');
        }
        
        const absUrl = `${Dokiraw.BASE}/${clean}`;
        return absUrl.split('/').map((part, idx) => {
            if (idx < 3) return part;
            return encodeURIComponent(decodeURIComponent(part));
        }).join('/').replace(/\/\+/g, '/').replace(/:\//g, "://");
    }

    _normalizeSort(options, fallback = "update") {
        const raw = Array.isArray(options) ? options[0] : options;
        const value = raw || fallback;
        const allowed = ["update", "popular", "trending", "views", "rating", "latest"];
        return allowed.find(sort => value === sort || String(value).startsWith(`${sort}-`)) || fallback;
    }

    _findImage(html = "") {
        const candidates = [];
        const imgRe = /<img\b[^>]+>/gi;
        let m;

        while ((m = imgRe.exec(html)) !== null) {
            const attrs = m[1];
            const dataSrc = attrs.match(/\b(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i);
            const src = attrs.match(/\bsrc=["']([^"']+)["']/i);
            const rawUrl = (dataSrc && dataSrc[1]) || (src && src[1]);

            if (rawUrl) {
                const url = this._absoluteUrl(rawUrl);
                if (/^https?:\/\//i.test(url) && !/(loading|logo|blank|spinner|avatar|banner|chevron|icon)/i.test(url)) {
                    candidates.push(url);
                }
            }
        }

        return candidates[0] || "";
    }

    _parseComicList(html) {
        const comics = [];
        const seen = new Set();
        
        // 画像（<img>タグ）を内包しているリンクからコミックカードを安全に抽出
        const linkRe = /<a\b[^>]*href=["'](?:https?:\/\/dokiraw\.best)?\/([^"'\/\?#]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m;

        while ((m = linkRe.exec(html)) !== null) {
            const id = m[1];
            
            if (/^(search|genres|bookmark|history|ranking|all-manga|all|page|about|privacy|public|assets|wp-content|wp-includes)$/i.test(id)) {
                continue;
            }
            if (seen.has(id)) continue;

            const contentBlock = m[2];
            if (!/<img\b[^>]+>/i.test(contentBlock)) continue;

            const attrTitle = m[0].match(/\btitle=["']([^"']+)["']/i);
            const imgTitle = contentBlock.match(/<img\b[^>]*\balt=["']([^"']+)["']/i);
            const textTitle = this._stripTags(contentBlock).trim();
            const title = this._htmlDecode((attrTitle && attrTitle[1]) || (imgTitle && imgTitle[1]) || textTitle || id)
                .replace(/\s*RAW$/i, "")
                .trim();

            if (!title || /^(\d+|next|prev|previous|more|page|home|logo)$/i.test(title)) continue;

            seen.add(id);
            comics.push({
                id,
                title,
                cover: this._findImage(contentBlock),
                tags: [],
            });
        }

        return comics;
    }

    _parseMaxPage(html) {
        const pageText = html.match(/Page\s+\d+\s*\/\s*(\d+)/i);
        if (pageText) return parseInt(pageText[1], 10);

        const nums = [];
        const patterns = [
            /\/page\/(\d+)/gi,
            /[?&]page=(\d+)/gi,
        ];

        for (const re of patterns) {
            let m;
            while ((m = re.exec(html)) !== null) nums.push(parseInt(m[1], 10));
        }

        const textNums = html.match(/class=["']page-numbers["'][^>]*>(\d+)</gi);
        if (textNums) {
            for (const t of textNums) {
                const num = t.match(/>(\d+)</);
                if (num) nums.push(parseInt(num[1], 10));
            }
        }

        return nums.length ? Math.max(...nums.filter(Boolean)) : 1;
    }

    search = {
        load: async (keyword, options, page = 1) => {
            const sort = this._normalizeSort(options, "update");
            const q = encodeURIComponent(keyword || "");
            
            // ★ 指定された「https://dokiraw.best/search/manga?keyword=」構造に完全に整合させました
            const url = page > 1 
                ? `${Dokiraw.BASE}/search/manga/page/${page}/?keyword=${q}&order=${sort}`
                : `${Dokiraw.BASE}/search/manga?keyword=${q}&order=${sort}`;
                
            const html = await this._fetch(url);

            return {
                comics: this._parseComicList(html),
                maxPage: this._parseMaxPage(html),
            };
        },
        optionList: [
            {
                type: "select",
                label: "Sort",
                default: "update",
                options: [
                    "update-Latest updated",
                    "popular-Most popular",
                    "trending-Trending",
                    "views-Most viewed",
                    "rating-Top rated",
                    "latest-Latest released",
                ],
            },
        ],
    };

    explore = [
        {title: "最新更新 (Latest)", type: "multiPageComicList", load: async (page = 1) => {
            const url = page > 1 
                ? `${Dokiraw.BASE}/search/manga/page/${page}/?keyword=&order=update`
                : `${Dokiraw.BASE}/search/manga?keyword=&order=update`;
            const html = await this._fetch(url);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "人気 (Popular)", type: "multiPageComicList", load: async (page = 1) => {
            const url = page > 1 
                ? `${Dokiraw.BASE}/search/manga/page/${page}/?keyword=&order=popular`
                : `${Dokiraw.BASE}/search/manga?keyword=&order=popular`;
            const html = await this._fetch(url);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "注目 (Trending)", type: "multiPageComicList", load: async (page = 1) => {
            const url = page > 1 
                ? `${Dokiraw.BASE}/search/manga/page/${page}/?keyword=&order=trending`
                : `${Dokiraw.BASE}/search/manga?keyword=&order=trending`;
            const html = await this._fetch(url);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "閲覧数 (Views)", type: "multiPageComicList", load: async (page = 1) => {
            const url = page > 1 
                ? `${Dokiraw.BASE}/search/manga/page/${page}/?keyword=&order=views`
                : `${Dokiraw.BASE}/search/manga?keyword=&order=views`;
            const html = await this._fetch(url);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
    ];

    category = {
        title: "ジャンル",
        parts: [
            {
                name: "Genres",
                type: "fixed",
                itemType: "category",
                categories: ["フルカラー", "Ecchi", "エロい", "コメディ", "ロマンス", "アクション", "スポーツ", "ファンタジー", "SF", "異世界", "ドラマ", "青年", "アダルト"],
                categoryParams: ["フルカラー", "ecchi", "エロい", "コメディ", "ロマンス", "アクション", "スポーツ", "ファンタジー", "sf", "異世界", "ドラマ", "青年", "アダルト"],
            },
        ],
        enableRankingPage: true,
    };

    categoryComics = {
        load: async (category, param, options, page = 1) => {
            const pagePath = page > 1 ? `/page/${page}` : "";
            const html = await this._fetch(`${Dokiraw.BASE}/genres/${encodeURIComponent(param)}${pagePath}/`);
            return {
                comics: this._parseComicList(html),
                maxPage: this._parseMaxPage(html),
            };
        },
    };

    ranking = {
        enable: true,
        list: [
            {title: "最新更新", load: async (page = 1) => {
                const url = page > 1 
                    ? `${Dokiraw.BASE}/search/manga/page/${page}/?keyword=&order=update`
                    : `${Dokiraw.BASE}/search/manga?keyword=&order=update`;
                const html = await this._fetch(url);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
            {title: "人気順", load: async (page = 1) => {
                const url = page > 1 
                    ? `${Dokiraw.BASE}/search/manga/page/${page}/?keyword=&order=popular`
                    : `${Dokiraw.BASE}/search/manga?keyword=&order=popular`;
                const html = await this._fetch(url);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
            {title: "高評価", load: async (page = 1) => {
                const url = page > 1 
                    ? `${Dokiraw.BASE}/search/manga/page/${page}/?keyword=&order=rating`
                    : `${Dokiraw.BASE}/search/manga?keyword=&order=rating`;
                const html = await this._fetch(url);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
        ]
    };

    comic = {
        loadInfo: async (id) => {
            const html = await this._fetch(`${Dokiraw.BASE}/${id}/`);

            const titleM = html.match(/<h1[^>]*class=["']entry-title["'][^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
            const title = titleM ? this._stripTags(titleM[1]).replace(/\s*RAW$/i, "").trim() : id;

            const thumbMatch = html.match(/<div[^>]*class=["']thumb["'][^>]*>([\s\S]*?)<\/div>/i);
            const cover = thumbMatch ? this._findImage(thumbMatch[1]) : this._findImage(html);

            const authorBlock = html.match(/(?:Author|Artist|作者|作家)[\s\S]{0,300}?(?:<td>|<span>)([\s\S]*?)(?:<\/td>|<\/span>)/i);
            const author = authorBlock ? this._stripTags(authorBlock[1]).trim() : "";

            let status = 0;
            const statusBlock = this._stripTags((html.match(/(?:Status|状態|狀態|状態)[\s\S]{0,240}/i) || [""])[0]);
            if (/(Completed|Complete|完結|已完結|已完成)/i.test(statusBlock)) status = 1;

            const tags = [];
            const tagRe = /<a\b[^>]*href=["'](?:https?:\/\/dokiraw\.best)?\/genres\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;
            let gm;
            while ((gm = tagRe.exec(html)) !== null) {
                const tag = this._stripTags(gm[1]).trim();
                if (tag && !tags.includes(tag)) tags.push(tag);
            }

            const descM = html.match(/<div[^>]*class=["']entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || html.match(/<div[^>]*itemprop=["']description["'][^>]*>([\s\S]*?)<\/div>/i);
            const description = descM ? this._stripTags(descM[1]).trim() : "";

            const chapterList = [];
            const seen = new Set();
            let chapterHtml = html;
            
            const sectionMatch = html.match(/<div[^>]*id=["']chapterlist["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || html.match(/<ul[^>]*class=["']clstyle["'][^>]*>([\s\S]*?)<\/ul>/i);
            if (sectionMatch) chapterHtml = sectionMatch[1];

            const epRe = /<a\b[^>]*href=["'](?:https?:\/\/dokiraw\.best)?\/([^"'/?#]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
            let em;
            while ((em = epRe.exec(chapterHtml)) !== null) {
                const epId = em[1];
                if (seen.has(epId)) continue;
                if (/^(search|genres|bookmark|history|ranking|all-manga|all|page|about|privacy)$/i.test(epId)) continue;
                seen.add(epId);

                let epTitle = "";
                const spanMatch = em[2].match(/<span[^>]*class=["']chapternum["'][^>]*>([\s\S]*?)<\/span>/i);
                if (spanMatch) epTitle = this._stripTags(spanMatch[1]).trim();
                else epTitle = this._stripTags(em[2]).trim();

                if (!epTitle || epTitle === epId) {
                    const numMatch = epId.match(/(\d+(?:\.\d+)?)/);
                    if (numMatch) epTitle = `第${numMatch[1]}話`;
                    else epTitle = epId;
                }
                chapterList.push({ id: epId, title: epTitle });
            }

            chapterList.sort((a, b) => {
                const na = parseFloat((a.id.match(/\d+(?:\.\d+)?/) || ["0"])[0]);
                const nb = parseFloat((b.id.match(/\d+(?:\.\d+)?/) || ["0"])[0]);
                return na - nb;
            });

            const chapterMap = new Map();
            for (const chapter of chapterList) {
                chapterMap.set(chapter.id, chapter.title);
            }

            return {
                id,
                title,
                cover,
                description,
                author,
                uploader: author,
                tags: {
                    "Genres": tags,
                    ...(author ? { "Author": [author] } : {})
                },
                chapters: chapterMap,
                status,
            };
        },

        loadEp: async (comicId, epId) => {
            const url = `${Dokiraw.BASE}/${epId}/`;

            const html = await this._fetch(url);
            const images = [];
            const seen = new Set();

            const readerAreaM = html.match(/<div[^>]*id=["']readerarea["'][^>]*>([\s\S]*?)<\/div>/i);
            const content = readerAreaM ? readerAreaM[1] : html;

            const imgRe = /<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)["'][^>]*>/gi;
            let m;
            while ((m = imgRe.exec(content)) !== null) {
                const url = this._absoluteUrl(m[1]);
                if (!url) continue;
                if (!/^https?:\/\//i.test(url)) continue;
                if (/(loading|logo|blank|spinner|avatar|banner|themes?\/)/i.test(url)) continue;
                if (seen.has(url)) continue;

                seen.add(url);
                images.push(url);
            }

            if (images.length === 0) {
                const jsMatch = html.match(/ts_images\s*=\s*(\[[^\]]+\])/i);
                if (jsMatch) {
                    try {
                        const parsed = JSON.parse(jsMatch[1].replace(/'/g, '"'));
                        if (Array.isArray(parsed)) {
                            for (const imgUrl of parsed) {
                                const url = this._absoluteUrl(imgUrl);
                                if (url && !seen.has(url)) {
                                    seen.add(url);
                                    images.push(url);
                                }
                            }
                        }
                    } catch (e) {
                        const urlRe = /"([^"]+)"|'([^']+)'/g;
                        let um;
                        while ((um = urlRe.exec(jsMatch[1])) !== null) {
                            const rawUrl = um[1] || um[2];
                            const url = this._absoluteUrl(rawUrl);
                            if (url && /^https?:\/\//i.test(url) && !seen.has(url)) {
                                seen.add(url);
                                images.push(url);
                            }
                        }
                    }
                }
            }

            return { images };
        },

        loadThumbnails: async (id) => {
            const html = await this._fetch(`${Dokiraw.BASE}/${id}/`);
            const images = [];
            const seen = new Set();

            const imgRe = /<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)["'][^>]*>/gi;
            let m;
            while ((m = imgRe.exec(html)) !== null) {
                const url = this._absoluteUrl(m[1]);
                if (!url) continue;
                if (!/^https?:\/\//i.test(url)) continue;
                if (/(loading|logo|blank|spinner|avatar|banner|themes?\/)/i.test(url)) continue;
                if (seen.has(url)) continue;

                seen.add(url);
                images.push(url);
            }

            return {
                thumbnails: images.length > 0 ? images : [],
                next: null
            };
        },

        onImageLoad: (url, comicId, epId) => {
            return {
                headers: {
                    "Referer": `${Dokiraw.BASE}/${epId}/`,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            };
        },

        onThumbnailLoad: () => {
            return {
                headers: {
                    "Referer": Dokiraw.BASE,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            };
        },

        link: {
            domains: ["dokiraw.best", "dokiraw.blog", "dokiraw.life", "dokiraw.my", "dokiraw.lat", "dokiraw.fun", "dokiraw.rest", "dokiraw.love", "dokiraw.bid"],
            linkToId: (url) => {
                const m = url.match(/dokiraw\.[a-z]+/i);
                if (m) {
                    const path = url.split('/').filter(Boolean).pop();
                    if (path && !/^(search|genres|bookmark|history|ranking|all-manga|all|page|about|privacy)$/i.test(path)) {
                        return path;
                    }
                }
                return null;
            },
        },
    };
}
