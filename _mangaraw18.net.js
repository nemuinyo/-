class MangaRaw18 extends ComicSource {
    name = "MangaRaw18";
    key = "mangaraw18";
    version = "3.0.0";
    minAppVersion = "1.0.0";
    
    // アプリ識別用の初期URL
    url = "https://mangaraw18.net";

    // 設定されたドメインから動的にbaseUrlを生成
    get baseUrl() {
        let customDomain = this.loadSetting('customDomain');
        if (!customDomain || customDomain.trim() === '') {
            return "https://mangaraw18.net"; // デフォルト値
        }
        return `https://${customDomain.trim()}`;
    }

    // 設定ドメインからホスト名（例: mangaraw18.net）を抽出
    get domain() {
        return this.baseUrl.replace(/https?:\/\//, "").trim();
    }

    async _fetch(url) {
        const resp = await Network.get(url, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": this.baseUrl,
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
        
        if (clean.startsWith("data:")) return "";

        clean = this._htmlDecode(clean);
        
        let absUrl = "";
        if (/^https?:\/\//i.test(clean)) {
            absUrl = clean;
        } else if (clean.startsWith("//")) {
            absUrl = `https:${clean}`;
        } else if (clean.startsWith("/")) {
            absUrl = `${this.baseUrl}${clean}`;
        } else {
            absUrl = `${this.baseUrl}/${clean}`;
        }

        const qIdx = absUrl.indexOf('?');
        const hIdx = absUrl.indexOf('#');
        let main = absUrl;
        let searchAndHash = "";

        let splitIdx = -1;
        if (qIdx !== -1 && hIdx !== -1) {
            splitIdx = Math.min(qIdx, hIdx);
        } else {
            splitIdx = qIdx !== -1 ? qIdx : hIdx;
        }

        if (splitIdx !== -1) {
            main = absUrl.slice(0, splitIdx);
            searchAndHash = absUrl.slice(splitIdx);
        }

        const parts = main.split('/');
        const encodedParts = parts.map((part, idx) => {
            if (idx < 3) return part;
            return encodeURIComponent(decodeURIComponent(part));
        });

        return encodedParts.join('/') + searchAndHash;
    }

    _getAttr(html = "", attrName = "") {
        const prefix = (attrName === "src") ? "\\s+" : "\\b";
        const re = new RegExp(`${prefix}${attrName}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, "i");
        const m = html.match(re);
        if (!m) return "";
        return this._htmlDecode(m[2] || m[3] || "").trim();
    }

    _findImage(html = "") {
        const imgRe = /<img\b[^>]+>/gi;
        let m;

        while ((m = imgRe.exec(html)) !== null) {
            const imgTag = m[0];
            const rawUrl = this._getAttr(imgTag, "data-original") || 
                           this._getAttr(imgTag, "data-src") || 
                           this._getAttr(imgTag, "data-lazy-src") || 
                           this._getAttr(imgTag, "src");

            if (rawUrl) {
                if (rawUrl.startsWith("data:")) continue;
                const url = this._absoluteUrl(rawUrl);
                if (/^https?:\/\//i.test(url) && !/(loading|logo|blank|spinner|avatar|banner|chevron|icon)/i.test(url)) {
                    return url;
                }
            }
        }

        return "";
    }

    _parseComicList(html) {
        const comics = [];
        const seen = new Set();
        
        const domainEscaped = this.domain.replace(/\./g, "\\.");
        const linkRe = new RegExp(`<a\\b[^>]*href=["'](?:https?:\\/\\/${domainEscaped})?\\/manga\\/([^"'/\\?#]+)\\/?["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi");
        let m;

        while ((m = linkRe.exec(html)) !== null) {
            const id = m[1];
            if (seen.has(id)) continue;

            const start = Math.max(0, html.lastIndexOf("<div", m.index));
            const end = html.indexOf("</div>", m.index);
            const block = html.slice(start, end > m.index ? end + 6 : m.index + 1600);
            const attrTitle = m[0].match(/\btitle=["']([^"']+)["']/i);
            const imgTitle = block.match(/<img\b[^>]*\balt=["']([^"']+)["']/i);
            const title = this._htmlDecode((attrTitle && attrTitle[1]) || (imgTitle && imgTitle[1]) || this._stripTags(m[2]) || id);

            if (!title || /^(\d+|next|prev|previous|more)$/i.test(title)) continue;

            seen.add(id);
            comics.push({
                id,
                title,
                cover: this._findImage(block),
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
            /\/filter\/(\d+)\/?/gi,
            /\/all-manga\/(\d+)\/?/gi,
            /\/genres\/[^/]+\/(\d+)\/?/gi,
            /[?&]page=(\d+)/gi,
        ];

        for (const re of patterns) {
            let m;
            while ((m = re.exec(html)) !== null) nums.push(parseInt(m[1], 10));
        }

        return nums.length ? Math.max(...nums.filter(Boolean)) : 1;
    }

    search = {
        load: async (keyword, options, page = 1) => {
            const q = encodeURIComponent(keyword || "");
            const pagePath = page > 1 ? `/${page}` : "";
            const url = `${this.baseUrl}/search${pagePath}/?keyword=${q}`;
            const html = await this._fetch(url);

            return {
                comics: this._parseComicList(html),
                maxPage: this._parseMaxPage(html),
            };
        },
    };

    explore = [
        {title: "Latest updated", type: "multiPageComicList", load: async (page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=latest-updated`);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "Most viewed", type: "multiPageComicList", load: async (page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=views`);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "Monthly views", type: "multiPageComicList", load: async (page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=views_month`);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "Weekly views", type: "multiPageComicList", load: async (page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=views_week`);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "Daily views", type: "multiPageComicList", load: async (page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=views_day`);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "Top rated", type: "multiPageComicList", load: async (page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=score`);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "New releases", type: "multiPageComicList", load: async (page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=release-date`);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
        {title: "Most bookmarked", type: "multiPageComicList", load: async (page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=bookmarks`);
            return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
        }},
    ];

    category = {
        title: "Genres",
        parts: [
            {
                name: "Genres",
                type: "fixed",
                itemType: "category",
                categories: ["Adult", "Erotic", "Full color", "Harem", "Romance","NTR", "Popular", "Milf", "Fantasy", "Isekai","Reincarnation", "Action", "Drama", "Comedy", "Ecchi"],
                categoryParams: ["adaruto", "eroi", "furukara", "haremu", "romansu","ntr", "ren-qi", "milf", "fantaji", "yi-shi-jie","zhuan-sheng", "akushon", "dorama", "komedi", "ecchi"],
            },
        ],
        enableRankingPage: true,
    };

    categoryComics = {
        load: async (category, param, options, page = 1) => {
            const html = await this._fetch(`${this.baseUrl}/genres/${param}/${page}/`);
            return {
                comics: this._parseComicList(html),
                maxPage: this._parseMaxPage(html),
            };
        },
    };

    ranking = {
        enable: true,
        list: [
            {title: "Latest updated", load: async (page = 1) => {
                const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=latest-updated`);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
            {title: "Most viewed", load: async (page = 1) => {
                const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=views`);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
            {title: "Monthly views", load: async (page = 1) => {
                const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=views_month`);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
            {title: "Weekly views", load: async (page = 1) => {
                const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=views_week`);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
            {title: "Top rated", load: async (page = 1) => {
                const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=score`);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
            {title: "New releases", load: async (page = 1) => {
                const html = await this._fetch(`${this.baseUrl}/all-manga/${page}/?sort=release-date`);
                return { comics: this._parseComicList(html), maxPage: this._parseMaxPage(html) };
            }},
        ]
    };

    comic = {
        loadInfo: async (id) => {
            const html = await this._fetch(`${this.baseUrl}/manga/${id}`);

            const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
            const title = titleM ? this._stripTags(titleM[1]) : id;

            const cover = this._findImage(html);

            const authorBlock = html.match(/(?:Author|Artist|作者|作家)[\s\S]{0,400}?<a\b[^>]*>([\s\S]*?)<\/a>/i);
            const author = authorBlock ? this._stripTags(authorBlock[1]) : "";

            let status = 0;
            const statusBlock = this._stripTags((html.match(/(?:Status|状態|狀態|状態)[\s\S]{0,240}/i) || [""])[0]);
            if (/(Completed|Complete|完結|已完結|已完成)/i.test(statusBlock)) status = 1;

            const tags = [];
            
            // 動的ドメインを正規表現に自動埋め込み
            const domainEscaped = this.domain.replace(/\./g, "\\.");
            const tagRe = new RegExp(`<a\\b[^>]*href=["'](?:https?:\\/\\/${domainEscaped})?\\/genres\\/[^"']+["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi");
            let gm;
            while ((gm = tagRe.exec(html)) !== null) {
                const tag = this._stripTags(gm[1]);
                if (tag && !tags.includes(tag)) tags.push(tag);
            }

            const descM = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || html.match(/(?:Summary|Synopsis|Description|あらすじ)[\s\S]{0,5000}?<p[^>]*>([\s\S]*?)<\/p>/i);
            const description = descM ? this._stripTags(descM[1]) : "";

            const chapterList = [];
            const seen = new Set();
            let chapterHtml = html;
            const sectionMatch = html.match(/<div[^>]*(?:class=["'][^"']*\b(?:list-chapter|nt_listchapter)\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>\s*<div[^>]*class=["'][^"']*\bad_info\b[^"']*["'][^>]*>/i);
            if (sectionMatch) chapterHtml = sectionMatch[1];

            // 動的ドメインを正規表現に自動埋め込み
            const epRe = new RegExp(`<a\\b[^>]*href=["'](?:https?:\\/\\/${domainEscaped})?\\/manga\\/${id}\\/([^"'/?#]+)\\/?["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi");
            let em;
            while ((em = epRe.exec(chapterHtml)) !== null) {
                const epId = em[1];
                if (seen.has(epId)) continue;
                seen.add(epId);

                let epTitle = this._stripTags(em[2]) || epId;
                const numMatch = (epId && epId.match(/(\d+)/));
                if (!epTitle || epTitle === epId) {
                    if (numMatch) epTitle = `第${numMatch[1]}話`;
                    else epTitle = epId;
                }
                chapterList.push({ id: epId, title: epTitle });
            }

            chapterList.sort((a, b) => {
                const na = parseInt((a.id.match(/\d+/) || ["0"])[0], 10);
                const nb = parseInt((b.id.match(/\d+/) || ["0"])[0], 10);
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
            const html = await this._fetch(`${this.baseUrl}/manga/${comicId}/${epId}`);
            const images = [];
            const seen = new Set();

            // バックトラッキング防止のため、コンテナ div 単位でパース
            const pageRe = /<div\s+[^>]*?class=["'][^"']*?page-chapter[^"']*?["'][^>]*>([\s\S]*?)<\/div>/gi;
            let pm;
            while ((pm = pageRe.exec(html)) !== null) {
                const block = pm[1];
                const rawUrl = this._getAttr(block, "data-original") || 
                               this._getAttr(block, "data-src") || 
                               this._getAttr(block, "src");
                const url = this._absoluteUrl(rawUrl);
                if (url && /^https?:\/\//i.test(url) && !seen.has(url)) {
                    seen.add(url);
                    images.push(url);
                }
            }

            // 何らかの原因でコンテナ分割が不可能な場合のフォールバック抽出
            if (images.length === 0) {
                const imgRe = /<img\b[^>]+>/gi;
                let m;
                while ((m = imgRe.exec(html)) !== null) {
                    const imgTag = m[0];
                    const rawUrl = this._getAttr(imgTag, "data-original") || 
                                   this._getAttr(imgTag, "data-src") || 
                                   this._getAttr(imgTag, "src");
                    const url = this._absoluteUrl(rawUrl);
                    
                    if (!url) continue;
                    if (!/^https?:\/\//i.test(url)) continue;
                    if (/(loading|logo|blank|spinner|avatar|banner|themes?\/)/i.test(url)) continue;
                    if (seen.has(url)) continue;

                    seen.add(url);
                    images.push(url);
                }
            }

            return { images };
        },

        loadThumbnails: async (id) => {
            const html = await this._fetch(`${this.baseUrl}/manga/${id}`);
            const thumbnails = [];
            const seen = new Set();

            const coverRe = /<img\b[^>]*(?:src|data-src|data-original)=["']([^"']+)["'][^>]*alt=["']([^"']+)["']/gi;
            let m;
            while ((m = coverRe.exec(html)) !== null) {
                const url = this._absoluteUrl(m[1]);
                if (!url) continue;
                if (!/^https?:\/\//i.test(url)) continue;
                if (/(loading|logo|blank|spinner|avatar|banner|themes?\/)/i.test(url)) continue;
                if (seen.has(url)) continue;

                seen.add(url);
                thumbnails.push(url);
            }

            return {
                thumbnails: thumbnails.length > 0 ? thumbnails : [],
                next: null
            };
        },

        onImageLoad: (url, comicId, epId) => {
            return {
                headers: {
                    "Referer": `${this.baseUrl}/manga/${comicId}/${epId}`,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            };
        },

        onThumbnailLoad: () => {
            return {
                headers: {
                    "Referer": this.baseUrl,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            };
        },

        link: {
            get domains() {
                let customDomain = "mangaraw18.net";
                try {
                    let d = this.loadSetting('customDomain');
                    if (d && d.trim() !== '') customDomain = d.trim();
                } catch(e) {}
                return [customDomain, "mangaraw18.net"];
            },
            linkToId: (url) => {
                let customDomain = "mangaraw18.net";
                try {
                    let d = this.loadSetting('customDomain');
                    if (d && d.trim() !== '') customDomain = d.trim();
                } catch(e) {}
                const domainEscaped = customDomain.replace(/\./g, "\\.");
                const m = url.match(new RegExp(`${domainEscaped}\\/manga\\/([^/?#]+)`, "i"));
                return m ? m[1] : null;
            },
        },
    };

    settings = {
        customDomain: {
            title: "Custom Domain",
            type: "input",
            validator: String.raw`^(?!:\/\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
            default: 'mangaraw18.net',
        }
    };

    translation = {
        'zh_CN': {
            'Custom Domain': '自定义域名',
        },
        'zh_TW': {
            'Custom Domain': '自定義域名',
        },
        'ja_JP': {
            'Custom Domain': 'カスタムドメイン',
        }
    };
}