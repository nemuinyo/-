class Dokiraw extends ComicSource {
  name = "Dokiraw";
  key = "dokiraw";
  version = "1.2.3";
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

  _findImage(html = "") {
      const candidates = [];
      const imgRe = /<img\b[^>]+>/gi;
      let m;

      while ((m = imgRe.exec(html)) !== null) {
          const imgTag = m[0];
          
          const dataOriginal = imgTag.match(/\bdata-original\s*=\s*(["']?)([^"'\s>]+)\1/i);
          const dataSrc = imgTag.match(/\b(?:data-src|data-lazy-src)\s*=\s*(["']?)([^"'\s>]+)\1/i);
          const src = imgTag.match(/\bsrc\s*=\s*(["']?)([^"'\s>]+)\1/i);
          
          const rawUrl = (dataOriginal && dataOriginal[2]) || (dataSrc && dataSrc[2]) || (src && src[2]);

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
      
      const startRe = /<div\b[^>]*?class=["'][^"']*?manga-item_item[^"']*?["']/g;
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
          // ID末尾のスラッシュを確実にカット
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
          const url = `${Dokiraw.BASE}/search/manga?keyword=${q}${page > 1 ? `&page=${page}` : ''}`;
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
          const html = await this._fetch(`${Dokiraw.BASE}/search/manga?genre=${encodeURIComponent(param)}${pageParam}`);
          return {
              comics: this._parseComicList(html),
              maxPage: this._parseMaxPage(html),
          };
      },
  };

  ranking = { enable: false, list: [] };

  comic = {
      loadInfo: async (id) => {
          // 末尾のスラッシュを削除
          const html = await this._fetch(`${Dokiraw.BASE}/manga/${id}`);

          const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<meta\b[^>]*property=['"]og:title['"][^>]*content=['"]([^"']+)['"]/i);
          const title = titleM ? this._stripTags(titleM[1]).replace(/\s*RAW$/i, "").trim() : id;

          const cover = this._findImage(html);

          const authorBlock = html.match(/(?:Author|Artist|作者|作家)[\s\S]{0,400}?<a\b[^>]*>([\s\S]*?)<\/a>/i) || html.match(/(?:Author|Artist|作者|作家)[\s\S]{0,300}?(?:<td>|<span>)([\s\S]*?)(?:<\/td>|<\/span>)/i);
          const author = authorBlock ? this._stripTags(authorBlock[1]).trim() : "";

          let status = 0;
          const statusBlock = this._stripTags((html.match(/(?:Status|状態|狀態|状態)[\s\S]{0,240}/i) || [""])[0]);
          if (/(Completed|Complete|完結|已完結|已完成)/i.test(statusBlock)) status = 1;

          const tags = [];
          const tagRe = /<a\b[^>]*href=['"](?:https?:\/\/dokiraw\.best)?\/genres\/[^"']+["][^>]*>([\s\S]*?)<\/a>/gi;
          let gm;
          while ((gm = tagRe.exec(html)) !== null) {
              const tag = this._stripTags(gm[1]).trim();
              if (tag && !tags.includes(tag)) tags.push(tag);
          }

          const descM = html.match(/<div[^>]*class=['"]entry-content[^"']*['"][^>]*>([\s\S]*?)<\/div>/i) || html.match(/<div[^>]*itemprop=['"]description['"][^>]*>([\s\S]*?)<\/div>/i) || html.match(/<meta\b[^>]*name=['"]description['"][^>]*content=['"]([^"']+)['"]/i);
          const description = descM ? this._stripTags(descM[1]).trim() : "";

          const chapterList = [];
          const seen = new Set();
          const sectionMatch = html.match(/<div[^>]*id=['"]chapterlist['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || html.match(/<ul[^>]*class=['"]clstyle['"][^>]*>([\s\S]*?)<\/ul>/i);
          const chapterHtml = sectionMatch ? sectionMatch[1] : html;

          const epRe = new RegExp(`href\\s*=\\s*(["']?)(?:https?:\\/\\/dokiraw\\.best)?\\/manga\\/${id}\\/([^"'/?#\\s>]+?)\\/?\\1(?:\\s|>)[^>]*>([\\s\\S]*?)<\\/a>`, "gi");
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
          // 末尾のスラッシュを削除
          const url = `${Dokiraw.BASE}/manga/${comicId}/${epId}`;

          const html = await this._fetch(url);
          const images = [];
          const seen = new Set();

          const readerAreaM = html.match(/<div[^>]*id=['"]readerarea['"][^>]*>([\s\S]*?)<\/div>/i);
          const content = readerAreaM ? readerAreaM[1] : html;

          const imgRe = /<img\b[^>]+>/gi;
          let m;
          while ((m = imgRe.exec(content)) !== null) {
              const imgTag = m[0];
              const dataOriginal = imgTag.match(/\bdata-original\s*=\s*(["']?)([^"'\s>]+)\1/i);
              const dataSrc = imgTag.match(/\b(?:data-src|data-lazy-src)\s*=\s*(["']?)([^"'\s>]+)\1/i);
              const src = imgTag.match(/\bsrc\s*=\s*(["']?)([^"'\s>]+)\1/i);
              
              const rawUrl = (dataOriginal && dataOriginal[2]) || (dataSrc && dataSrc[2]) || (src && src[2]);
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
          // 末尾のスラッシュを削除
          const html = await this._fetch(`${Dokiraw.BASE}/manga/${id}`);
          const images = [];
          const seen = new Set();

          const imgRe = /<img\b[^>]+>/gi;
          let m;
          while ((m = imgRe.exec(html)) !== null) {
              const imgTag = m[0];
              const dataOriginal = imgTag.match(/\bdata-original\s*=\s*(["']?)([^"'\s>]+)\1/i);
              const dataSrc = imgTag.match(/\b(?:data-src|data-lazy-src)\s*=\s*(["']?)([^"'\s>]+)\1/i);
              const src = imgTag.match(/\bsrc\s*=\s*(["']?)([^"'\s>]+)\1/i);
              
              const rawUrl = (dataOriginal && dataOriginal[2]) || (dataSrc && dataSrc[2]) || (src && src[2]);
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
                  // リファラからも末尾スラッシュを削除
                  "Referer": `${Dokiraw.BASE}/manga/${comicId}/${epId}`,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
          };
      },

      onThumbnailLoad: () => {
          return {
              headers: {
                  "Referer": Dokiraw.BASE,
                  "User-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
          };
      },

      link: {
          domains: ["dokiraw.best", "dokiraw.blog", "dokiraw.life", "dokiraw.my", "dokiraw.lat", "dokiraw.fun", "dokiraw.rest", "dokiraw.love", "dokiraw.bid"],
          linkToId: (url) => {
              const m = url.match(/dokiraw\.best\/manga\/([^\/?#]+)/i);
              return m ? m[1] : null;
          },
      },
  };
}