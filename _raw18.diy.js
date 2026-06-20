class Raw18Diy extends ComicSource {
  name = "Raw18.diy";
  key = "raw18diy";
  version = "3.0.0";
  minAppVersion = "1.0.0";
  
  // アプリ識別用の初期URL
  url = "https://raw18.diy";

  // 設定されたドメインから動的にbaseUrlを生成
  get baseUrl() {
      let customDomain = this.loadSetting('customDomain');
      if (!customDomain || customDomain.trim() === '') {
          return "https://raw18.diy"; // デフォルト値
      }
      return `https://${customDomain.trim()}`;
  }

  // 設定ドメインからホスト名（例: raw18.diy）を抽出
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
      
      // Base64などの長大なインラインデータはここで瞬時に除外し、クラッシュとフリーズを防止
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

      // クエリパラメータやハッシュがエンコードで破損しないように分離して処理
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
          if (idx < 3) return part; // プロトコルとドメイン部分はそのまま
          return encodeURIComponent(decodeURIComponent(part));
      });

      return encodedParts.join('/') + searchAndHash;
  }

  _getAttr(html = "", attrName = "") {
      // ★onerrorの中にある「this.src」を誤検知してしまわないよう、直前に「スペース（空白）」を必須にする安全対策
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
              if (rawUrl.startsWith("data:")) continue; // インラインデータは事前にスキップ
              const url = this._absoluteUrl(rawUrl);
              // サイトの共通ロゴやテーマ素材画像を除外
              if (/^https?:\/\//i.test(url) && !/(loading|logo|blank|spinner|avatar|banner|chevron|icon|public\/assets|public\/apple|favicon)/i.test(url)) {
                  return url; // 最初に見つかった最も条件に合致する画像を即時返却
              }
          }
      }

      return "";
  }
  
  _parseComicList(html) {
      const comics = [];
      const seen = new Set();
      
      const linkRe = /href\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;
      let m;

      while ((m = linkRe.exec(html)) !== null) {
          const rawUrl = m[2] || m[3] || "";
          
          const mangaMatch = rawUrl.match(/\/manga\/([^"'\/\?#\s>]+)/i);
          if (!mangaMatch) continue;
          
          const id = mangaMatch[1].replace(/\/+$/, "").trim();
          if (seen.has(id)) continue;
          
          if (/^(?:genres|author|artist|page|search|wp-login|category|tags|all-manga)$/i.test(id)) continue;

          const start = Math.max(0, html.lastIndexOf("<div", m.index));
          const end = html.indexOf("</div>", m.index);
          const block = html.slice(start, end > m.index ? end + 6 : m.index + 1600);
          
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
              categories: ["フルカラー", "Ecchi", "エロい", "ハーレム"],
              categoryParams: ["フルカラー", "ecchi", "エロい", "ハーレム"],
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

          // ★★★ 作品名(alt属性) または 作品ID(画像URL) と自動連動させる確実なカバー選別ロジック ★★★
          let cover = "";

          // 1. クォーテーション有無を問わないカバー用divエリア（col-image, box_img, uwthumb）からの抽出を優先
          const thumbMatch = html.match(/<div\b[^>]*?(?:uwthumb|box_img|col-image|summary_image)[^>]*>([\s\S]*?)<\/div>/i);
          if (thumbMatch) {
              cover = this._findImage(thumbMatch[1]);
          }

          // 2. 失敗した場合のみ、HTML全体から「作品名(alt)」または「作品ID(画像URL)」を含むものを自動検索
          if (!cover) {
              const imgRe = /<img\b[^>]+>/gi;
              let m;
              while ((m = imgRe.exec(html)) !== null) {
                  const imgTag = m[0];
                  const alt = this._getAttr(imgTag, "alt") || this._getAttr(imgTag, "title") || "";
                  const rawUrl = this._getAttr(imgTag, "data-original") || 
                                 this._getAttr(imgTag, "data-src") || 
                                 this._getAttr(imgTag, "data-lazy-src") || 
                                 this._getAttr(imgTag, "src");

                  if (rawUrl && !rawUrl.startsWith("data:")) {
                      const url = this._absoluteUrl(rawUrl);
                      
                      // alt属性に作品タイトルが含まれているか判定
                      const isTitleMatch = alt && title && (alt.toLowerCase().includes(title.toLowerCase()) || title.toLowerCase().includes(alt.toLowerCase()));
                      // 画像URL自体に作品IDが含まれているか判定
                      const isIdMatch = url.includes(id);

                      if (isTitleMatch || isIdMatch) {
                          cover = url;
                          break; // 最初に見つかった最も条件に合致する画像をカバー画像に決定
                      }
                  }
              }
          }

          // 3. 最終フォールバック
          if (!cover) {
              cover = this._findImage(html);
          }

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

          // 動的な現在のドメインを参照したチャプター抽出
          const domainEscaped = this.domain.replace(/\./g, "\\.");
          const epRe = new RegExp(`href\\s*=\\s*(["']?)(?:https?:\\/\\/${domainEscaped})?\\/manga\\/${id}\\/([^"'/?#\\s>]+?)\\/?\\1(?:\\s|>)[^>]*>([\\s\\S]*?)<\\/a>`, "gi");
          let em;
          while ((em = epRe.exec(chapterHtml)) !== null) {
              const epId = em[2].replace(/\/+$/, "").trim();
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
          domains: ["raw18.diy", "raw18.xyz", "raw18.fun", "raw18.rest", "raw18.love", "mangaraw18.net"],
          linkToId: (url) => {
              const m = url.match(/(?:raw18|mangaraw18)[^/]*\/manga\/([^/?#\\s>]+)/i);
              return m ? m[1] : null;
          },
      },
  };

  settings = {
      customDomain: {
          title: "Custom Domain",
          type: "input",
          validator: String.raw`^(?!:\/\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
          default: 'raw18.diy',
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