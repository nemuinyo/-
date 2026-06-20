class Dokiraw extends ComicSource {
  name = "Dokiraw";
  key = "dokiraw";
  version = "3.0.0";
  minAppVersion = "1.0.0";
  
  // アプリ識別用の初期URL
  url = "https://dokiraw.best";

  // 設定されたドメインから動的にbaseUrlを生成
  get baseUrl() {
      let customDomain = this.loadSetting('customDomain');
      if (!customDomain || customDomain.trim() === '') {
          return "https://dokiraw.best"; // デフォルト値
      }
      return `https://${customDomain.trim()}`;
  }

  // 設定ドメインからホスト名（例: dokiraw.best）を抽出
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
          .replace(/&quot;/g, '"')
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
      
      const startRe = /<div\s+[^>]*?class=["'][^"']*?manga-item_item/gi;
      let match;
      const starts = [];
      while ((match = startRe.exec(html)) !== null) {
          starts.push(match.index);
      }
      if (starts.length === 0) return [];

      for (let i = 0; i < starts.length; i++) {
          const start = starts[i];
          const end = (i + 1 < starts.length) ? starts[i + 1] : html.length;
          const block = html.substring(start, end);

          const idMatch = block.match(/href\s*=\s*(["']?)(?:https?:\/\/[^\/]+)?\/manga\/([^"'\/\?#\s>]+?)\/?\1(?:\s|>)/i);
          if (!idMatch) continue;
          const id = idMatch[2].replace(/\/+$/, "").trim();
          
          if (seen.has(id)) continue;

          const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
          let title = "";
          if (titleMatch) {
              title = this._stripTags(titleMatch[1]).trim();
          } else {
              const altMatch = block.match(/alt\s*=\s*(["']?)([^"'\s>]+)\1/i);
              if (altMatch) title = this._htmlDecode(altMatch[2]).trim();
          }
          
          title = title.replace(/\s*RAW$/i, "").trim();

          if (!title || /^(\d+|next|prev|previous|more|page|home|logo)$/i.test(title)) continue;

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
          /\/page\/(\d+)/gi,
          /[?&]page=(\d+)/gi,
      ];

      for (const re of patterns) {
          let m;
          while ((m = re.exec(html)) !== null) nums.push(parseInt(m[1], 10));
      }

      const textNums = html.match(/class=['"]page-numbers['"][^>]*>(\d+)</gi);
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
          const q = encodeURIComponent(keyword || "");
          const url = `${this.baseUrl}/search/manga?keyword=${q}${page > 1 ? `&page=${page}` : ''}`;
          const html = await this._fetch(url);

          return {
              comics: this._parseComicList(html),
              maxPage: this._parseMaxPage(html),
          };
      },
  };

  explore = [];

  category = {
      title: "ジャンル",
      parts: [
          {
              name: "Genres",
              type: "fixed",
              itemType: "category",
              categories: ["フルカラー", "Ecchi", "エロい", "コメディ", "ロマンス", "アクション", "スポーツ", "ファンタジー", "SF", "異世界", "ドラマ", "青年", "アダルト"],
              categoryParams: ["フルカラー", "Ecchi", "エロい", "コメディ", "ロマンス", "アクション", "スポーツ", "ファンタジー", "SF", "異世界", "ドラマ", "青年", "アダルト"],
          },
      ],
      enableRankingPage: true,
  };

  categoryComics = {
      load: async (category, param, options, page = 1) => {
          const pageParam = page > 1 ? `&page=${page}` : "";
          const html = await this._fetch(`${this.baseUrl}/search/manga?genre=${encodeURIComponent(param)}${pageParam}`);
          return {
              comics: this._parseComicList(html),
              maxPage: this._parseMaxPage(html),
          };
      },
  };

  ranking = { enable: false, list: [] };

  comic = {
      loadInfo: async (id) => {
          const html = await this._fetch(`${this.baseUrl}/manga/${id}`);

          const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<meta\b[^>]*property=['"]og:title['"][^>]*content=['"]([^"']+)['"]/i);
          const title = titleM ? this._stripTags(titleM[1]).replace(/\s*RAW$/i, "").trim() : id;

          const cover = this._findImage(html);

          const authorBlock = html.match(/(?:Author|Artist|作者|作家)[\s\S]{0,400}?<a\b[^>]*>([\s\S]*?)<\/a>/i) || html.match(/(?:Author|Artist|作者|作家)[\s\S]{0,300}?(?:<td>|<span>)([\s\S]*?)(?:<\/td>|<\/span>)/i);
          const author = authorBlock ? this._stripTags(authorBlock[1]).trim() : "";

          let status = 0;
          const statusBlock = this._stripTags((html.match(/(?:Status|状態|狀態|状態)[\s\S]{0,240}/i) || [""])[0]);
          if (/(Completed|Complete|完結|已完結|已完成)/i.test(statusBlock)) status = 1;

          const tags = [];
          const tagRe = /<a\b[^>]*href=['"](?:https?:\/\/[^\/]+)?\/genres\/[^"']+["][^>]*>([\s\S]*?)<\/a>/gi;
          let gm;
          while ((gm = tagRe.exec(html)) !== null) {
              const tag = this._stripTags(gm[1]).trim();
              if (tag && !tags.includes(tag)) tags.push(tag);
          }

          const descM = html.match(/<div[^>]*class=['']entry-content[^"']*['"][^>]*>([\s\S]*?)<\/div>/i) || html.match(/<div[^>]*itemprop=['"]description['"][^>]*>([\s\S]*?)<\/div>/i) || html.match(/<meta\b[^>]*name=['"]description['"][^>]*content=['"]([^"']+)['"]/i);
          const description = descM ? this._stripTags(descM[1]).trim() : "";

          const chapterList = [];
          const seen = new Set();
          const sectionMatch = html.match(/<div[^>]*id=['"]chapterlist['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || html.match(/<ul[^>]*class=['"]clstyle['"][^>]*>([\s\S]*?)<\/ul>/i);
          const chapterHtml = sectionMatch ? sectionMatch[1] : html;

          // 動的にドメインをエスケープして正規表現に自動埋め込み
          const domainEscaped = this.domain.replace(/\./g, "\\.");
          const epRe = new RegExp(`href\\s*=\\s*(["']?)(?:https?:\\/\\/${domainEscaped})?\\/manga\\/${id}\\/([^"'/?#\\s>]+?)\\/?\\1(?:\\s|>)[^>]*>([\\s\\S]*?)<\\/a>`, "gi");
          let em;
          while ((em = epRe.exec(chapterHtml)) !== null) {
              const epId = em[2].replace(/\/+$/, "").trim();
              if (seen.has(epId)) continue;
              seen.add(epId);

              let epTitle = this._stripTags(em[3]).trim();

              if (!epTitle || epTitle === epId) {
                  const numMatch = epId.match(/(\d+(?:\.\d+)?)/);
                  if (numMatch) epTitle = `第${numMatch[1]}話`;
                  else epTitle = epId;
              }
              chapterList.push({ id: epId, title: epTitle });
          }

          chapterList.sort((a, b) => {
              const na = parseFloat((a.id.match(/\d+(?:\.\d+)?(?!.*\d)/g) || ["0"]).pop());
              const nb = parseFloat((b.id.match(/\d+(?:\.\d+)?(?!.*\d)/g) || ["0"]).pop());
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
          const url = `${this.baseUrl}/manga/${comicId}/${epId}`;

          const html = await this._fetch(url);
          const images = [];
          const seen = new Set();

          const readerAreaM = html.match(/<div[^>]*id=['"]readerarea['"][^>]*>([\s\S]*?)<\/div>/i);
          const content = readerAreaM ? readerAreaM[1] : html;

          const imgRe = /<img\b[^>]+>/gi;
          let m;
          while ((m = imgRe.exec(content)) !== null) {
              const imgTag = m[0];
              const rawUrl = this._getAttr(imgTag, "data-original") || 
                             this._getAttr(imgTag, "data-src") || 
                             this._getAttr(imgTag, "data-lazy-src") || 
                             this._getAttr(imgTag, "src");

              const url = this._absoluteUrl(rawUrl);
              
              if (!url) continue;
              if (!/^https?:\/\//i.test(url)) continue;
              if (/(loading|logo|blank|spinner|avatar|banner|themes?\/)/i.test(url)) continue;
              if (seen.has(url)) continue;

              seen.add(url);
              images.push(url);
          }

          return { images };
      },

      loadThumbnails: async (id) => {
          const html = await this._fetch(`${this.baseUrl}/manga/${id}`);
          const images = [];
          const seen = new Set();

          const imgRe = /<img\b[^>]+>/gi;
          let m;
          while ((m = imgRe.exec(html)) !== null) {
              const imgTag = m[0];
              const rawUrl = this._getAttr(imgTag, "data-original") || 
                             this._getAttr(imgTag, "data-src") || 
                             this._getAttr(imgTag, "data-lazy-src") || 
                             this._getAttr(imgTag, "src");

              const url = this._absoluteUrl(rawUrl);
              
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
                  "Referer": `${this.baseUrl}/manga/${comicId}/${epId}`,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
          };
      },

      onThumbnailLoad: () => {
          return {
              headers: {
                  "Referer": this.baseUrl,
                  "User-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
          };
      },

      link: {
          get domains() {
              let customDomain = "dokiraw.best";
              try {
                  let d = this.loadSetting('customDomain');
                  if (d && d.trim() !== '') customDomain = d.trim();
              } catch(e) {}
              return [customDomain, "dokiraw.best", "dokiraw.blog", "dokiraw.life", "dokiraw.my", "dokiraw.lat", "dokiraw.fun", "dokiraw.rest", "dokiraw.love", "dokiraw.bid"];
          },
          linkToId: (url) => {
              let customDomain = "dokiraw.best";
              try {
                  let d = this.loadSetting('customDomain');
                  if (d && d.trim() !== '') customDomain = d.trim();
              } catch(e) {}
              const domainEscaped = customDomain.replace(/\./g, "\\.");
              const m = url.match(new RegExp(`${domainEscaped}\\/manga\\/([^/?#\\s>]+)`, "i"));
              return m ? m[1] : null;
          },
      },
  };

  settings = {
      customDomain: {
          title: "Custom Domain",
          type: "input",
          validator: String.raw`^(?!:\/\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
          default: 'dokiraw.best',
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