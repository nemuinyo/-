class Dokiraw extends ComicSource {
  name = "Dokiraw"
  key = "dokiraw"
  version = "1.0.0"
  minAppVersion = "1.0.0"
  url = "https://dokiraw.best"
  static BASE = "https://dokiraw.best"
  static SEARCH_URL = `${Dokiraw.BASE}/search/manga`

  async _fetch(url) {
    const resp = await Network.get(url, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": Dokiraw.BASE,
    })
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}: ${url}`)
    return resp.body
  }

  _absoluteUrl(url = "") {
    if (!url) return ""
    url = String(url).trim()
    if (/^https?:\/\//i.test(url)) return url
    if (url.startsWith("//")) return `https:${url}`
    if (url.startsWith("/")) return `${Dokiraw.BASE}${url}`
    return `${Dokiraw.BASE}/${url}`
  }

  _stripTags(html = "") {
    return (html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  _parseComicList(html) {
    const doc = new HtmlDocument(html)
    let items = doc.querySelectorAll(
      ".manga-list .manga-item, .list-manga .card, .manga-list-cards .card, .manga-card, .card, .manga-item"
    )
    if (!items || items.length === 0) {
      items = doc.querySelectorAll("a[href*='/manga/']")
    }

    const comics = []
    const seen = new Set()

    for (const item of items) {
      const link = item.matches && item.matches("a[href*='/manga/']")
        ? item
        : item.querySelector("a[href*='/manga/']")
      if (!link) continue

      const href = link.getAttribute("href") || ""
      const idMatch = href.match(/\/manga\/([^\/\?#]+)/i)
      const id = idMatch ? idMatch[1] : href.replace(/\/$/, "")
      if (!id || seen.has(id)) continue

      const titleEl = item.querySelector(".title, .card-title, h3, .manga-title, a")
      let title = titleEl ? (titleEl.text || titleEl.textContent || "").trim() : ""
      if (!title) {
        title = link.getAttribute("title") || (link.textContent || "").trim() || id
      }
      if (!title) continue

      let cover = ""
      const img = item.querySelector("img")
      if (img) {
        cover = this._absoluteUrl(
          img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("src") || ""
        )
      }

      comics.push({ id, title, cover, tags: [] })
      seen.add(id)
    }

    return comics
  }

  _parseMaxPage(html, currentPage = 1) {
    const pages = []
    let m
    const re = /[?&]page=(\d+)/gi
    while ((m = re.exec(html)) !== null) {
      const num = parseInt(m[1], 10)
      if (num > 0) pages.push(num)
    }
    if (pages.length) return Math.max(...pages)

    const pageMatch = html.match(/Page\s*\d+\s*\/\s*(\d+)/i)
    if (pageMatch) return parseInt(pageMatch[1], 10) || currentPage

    return currentPage
  }

  search = {
    load: async (keyword, options, page = 1) => {
      const pageNum = Math.max(1, page || 1)
      const isFullColor = options && options[0] === "fullcolor"
      const url = isFullColor
        ? `${Dokiraw.SEARCH_URL}?genre=%E3%83%95%E3%83%AB%E3%82%AB%E3%83%A9%E3%83%BC&page=${pageNum}`
        : `${Dokiraw.SEARCH_URL}?keyword=${encodeURIComponent(keyword || "")}&page=${pageNum}`

      const html = await this._fetch(url)
      return {
        comics: this._parseComicList(html),
        maxPage: this._parseMaxPage(html, pageNum),
      }
    },
    optionList: [
      {
        type: "select",
        label: "ジャンル",
        default: "none",
        options: ["none-指定なし", "fullcolor-フルカラー"],
      },
    ],
  }
}
