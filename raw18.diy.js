class Raw18Diy extends ComicSource {
  name = "Raw18.diy";
  key = "raw18diy";
  version = "1.1.0";
  minAppVersion = "1.0.0";
  url = "https://raw18.diy";

  static BASE = "https://raw18.diy";

  async _fetch(url) {
      const resp = await Network.get(url, {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": Raw18Diy.BASE,
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
          const absUrl = `${Raw18Diy.BASE}${clean}`;
          return absUrl.split('/').map((part, idx) => {
              if (idx < 3) return part;
              return encodeURIComponent(decodeURIComponent(part));
          }).join('/');
      }
      
      const absUrl = `${Raw18Diy.BASE}/${clean}`;
      return absUrl.split('/').map((part, idx) => {
          if (idx < 3) return part;
          return encodeURIComponent(decodeURIComponent(part));
      }).join('/').replace(/\/\+/g, '/').replace(/:\//g, "://");
  }

  // ★超頑健な属性抽出ヘルパー
  // クォーテーションの有無（href=url または href="url"）や空白混じりを全て安全に処理します
  _getAttr(html = "", attrName = "") {
      const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, "i");
      const m = html.match(re);
      if (!m) return "";
      return this._htmlDecode(m[2] || m[3] || "").trim();
  }

  // クォーテーション省略に対応した画像抽出
  _findImage(html = "") {
      const candidates = [];
      const imgRe = /<img\b[^>]+>/gi;
      let m;

      while ((m = imgRe.exec(html)) !== null) {
          const imgTag = m[0];
          
          const rawUrl = this._getAttr(imgTag, "data-original") || 
                         this._getAttr(imgTag, "data-src") || 
                         this._getAttr(imgTag, "data-lazy-src") || 
                         this._getAttr(imgTag, "src");

          if (rawUrl) {
              const url = this._absoluteUrl(rawUrl);
              if (/^https?:\/\//i.test(url) && !/(loading|logo|blank|spinner|avatar|banner|chevron|icon)/i.test(url)) {
                  candidates.push(url);
              }
          }
      }

      return candidates[0] || "";
  }
  
  // HTMLテーマに依存しない、リンク起点の頑健な漫画リスト解析
  _parseComicList(html) {
      const comics = [];
      const seen = new Set();
      
      // href 属性をクォーテーションの有無を問わず探す
      const linkRe = /href\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;
      let m;

      while ((m = linkRe.exec(html)) !== null) {
          const rawUrl = m[2] || m[3] || "";
          
          // /manga/ID の形式であるかチェック
          const mangaMatch = rawUrl.match(/\/manga\/([^"'\/\?#\s>]+)/i);
          if (!mangaMatch) continue;
          
          const id = mangaMatch[1].replace(/\/+$/, "").trim();
          if (seen.has(id)) continue;
          
          if (/^(?:genres|author|artist|page|search|wp-login|category|tags|all-manga)$/i.test(id)) continue;

          // マッチした位置の直前の <div を探し、ブロックを切り出す (最大1600文字)
          const start = Math.max(0, html.lastIndexOf("<div", m.index));
          const end = html.indexOf("</div>", m.index);
          const block = html.slice(start, end > m.index ? end + 6 : m.index + 1600);
          
          // ヘルパーを使ってタイトル属性やalt属性を完璧に抽出
          const attrTitle = this._getAttr(m[0], "title");
          const imgTag = block.match(/<img\b[^>]+>/i);
          const imgTitle = imgTag ? this._getAttr(imgTag[0], "alt") : "";
          const linkText = this._stripTags(m[0]);
          
          let title = attrTitle || imgTitle || linkText || id;
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
          const url = `${Raw18Diy.BASE}/search/manga?keyword=${q}${page > 1 ? `&page=${page}` : ''}`;
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
              categories: ["フルカラー", "Ecchi", "エロい", "ハーレム"],
              categoryParams: ["フルカラー", "ecchi", "エロい", "ハーレム"],
          },
      ],
      enableRankingPage: true,
  };

  categoryComics = {
      load: async (category, param, options, page = 1) => {
          const pageParam = page > 1 ? `&page=${page}` : "";
          const html = await this._fetch(`${Raw18Diy.BASE}/search/manga?genre=${encodeURIComponent(param)}${pageParam}`);
          return {
              comics: this._parseComicList(html),
              maxPage: this._parseMaxPage(html),
          };
      },
  };

  ranking = { enable: false, list: [] };

  comic = {
      loadInfo: async (id) => {
          // 末尾スラッシュなしURL
          const html = await this._fetch(`${Raw18Diy.BASE}/manga/${id}`);

          const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<meta\b[^>]*property=['"]og:title['"][^>]*content=['"]([^"']+)['"]/i);
          const title = titleM ? this._stripTags(titleM[1]).replace(/\s*RAW$/i, "").trim() : id;

          const cover = this._findImage(html);

          const authorBlock = html.match(/(?:Author|Artist|作者|作家)[\s\S]{0,400}?<a\b[^>]*>([\s\S]*?)<\/a>/i) || html.match(/(?:Author|Artist|作者|作家)[\s\S]{0,300}?(?:<td>|<span>)([\s\S]*?)(?:<\/td>|<\/span>)/i);
          const author = authorBlock ? this._stripTags(authorBlock[1]).trim() : "";

          let status = 0;
          const statusBlock = this._stripTags((html.match(/(?:Status|状態|狀態|状態)[\s\S]{0,240}/i) || [""])[0]);
          if (/(Completed|Complete|完結|已完結|已完成)/i.test(statusBlock)) status = 1;

          const tags = [];
          const tagRe = /<a\b[^>]*href=['"](?:https?:\/\/raw18\.diy)?\/genres\/[^"']+["][^>]*>([\s\S]*?)<\/a>/gi;
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

          // タグの閉じ位置を探すことで、クォーテーションの乱れやMinifyに一切影響されずにチャプターテキストを抽出
          const epRe = /<a\b[^>]+>/gi;
          let em;
          while ((em = epRe.exec(chapterHtml)) !== null) {
              const aTag = em[0];
              const href = this._getAttr(aTag, "href");
              if (!href) continue;

              const chapterMatch = href.match(new RegExp(`\\/manga\\/${id}\\/([^"'/?#\\s>]+)`, "i"));
              if (!chapterMatch) continue;

              const epId = chapterMatch[1].replace(/\/+$/, "").trim();
              if (seen.has(epId)) continue;
              seen.add(epId);

              const tagCloseIndex = chapterHtml.indexOf(">", em.index);
              const nextOpenIndex = chapterHtml.indexOf("</a>", tagCloseIndex);
              let epTitle = "";
              if (tagCloseIndex !== -1 && nextOpenIndex !== -1 && nextOpenIndex > tagCloseIndex) {
                  epTitle = this._stripTags(chapterHtml.substring(tagCloseIndex + 1, nextOpenIndex)).trim();
              }

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
          const url = `${Raw18Diy.BASE}/manga/${comicId}/${epId}`;

          const html = await this._fetch(url);
          const images = [];
          const seen = new Set();

          const readerAreaM = html.match(/<div[^>]*id=['"]readerarea['"][^>]*>([\s\S]*?)<\/div>/i);
          const content = readerAreaM ? readerAreaM[1] : html;

          // 画像一覧もクォーテーションの有無、data-original / src 混在に対応して完全に取得
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
          const html = await this._fetch(`${Raw18Diy.BASE}/manga/${id}`);
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
                  "Referer": `${Raw18Diy.BASE}/manga/${comicId}/${epId}`,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
          };
      },

      onThumbnailLoad: () => {
          return {
              headers: {
                  "Referer": Raw18Diy.BASE,
                  "User-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
          };
      },

      link: {
          domains: ["raw18.diy", "raw18.xyz", "mangaraw18.net"],
          linkToId: (url) => {
              const m = url.match(/raw18\.diy\/manga\/([^\/?#]+)/i);
              return m ? m[1] : null;
          },
      },
  };
}