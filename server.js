const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const COLES_HOST = "coles-product-price-api.p.rapidapi.com";
const WOOLWORTHS_HOST = "woolworths-products-api.p.rapidapi.com";
const ALDI_AU_BASE_URL = "https://api.aldi.com.au";
const ALDI_AU_ALLOWED_LIMITS = [12, 16, 24, 30, 32, 48, 60];
const CATEGORIES = ["all", "dairy", "fruit_veg", "bakery", "pantry", "beverages", "snacks", "household", "other"];

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function serveStatic(req, res) {
  const rawPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(rawPath).replace(/^\.+/, "");
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function getApiKey(store) {
  if (store === "woolworths") {
    return process.env.RAPIDAPI_KEY_WOOLWORTHS || process.env.RAPIDAPI_KEY || "";
  }
  if (store === "coles") {
    return process.env.RAPIDAPI_KEY_COLES || process.env.RAPIDAPI_KEY || "";
  }
  return process.env.RAPIDAPI_KEY || "";
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function parsePriceValue(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v || "").replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function sanitizeCategory(value) {
  const normalized = normalizeText(value || "").replace(/\s+/g, "_");
  return CATEGORIES.includes(normalized) ? normalized : "all";
}

function detectCategoryFromText(text) {
  const t = normalizeText(text);
  if (!t) return "other";
  if (/\b(frother|machine|maker|vacuum|detergent|cleaner|toilet|tissue|soap|shampoo|household|foil|wrap|bag)\b/.test(t)) return "household";
  if (/\b(chips|chocolate|biscuit|cookie|snack|cracker|bar)\b/.test(t)) return "snacks";
  if (/\b(milk|cheese|yoghurt|yogurt|butter|cream)\b/.test(t)) return "dairy";
  if (/\b(apple|banana|orange|grape|pear|berry|fruit|vegetable|veg|tomato|potato|onion|carrot|avocado)\b/.test(t)) return "fruit_veg";
  if (/\b(bread|bun|roll|croissant|muffin|bakery|cake|bagel|crumpet)\b/.test(t)) return "bakery";
  if (/\b(rice|pasta|flour|oil|sauce|salt|sugar|spice|cereal|beans|pantry|soup)\b/.test(t)) return "pantry";
  if (/\b(water|juice|drink|soda|coffee|tea|cola)\b/.test(t)) return "beverages";
  return "other";
}

function offerCategory(offer) {
  const text = `${offer.product_name || ""} ${offer.product_brand || ""} ${offer.product_size || ""}`;
  return detectCategoryFromText(text);
}

function filterOffersByCategory(offers, category) {
  if (category === "all") return offers;
  return offers.filter((offer) => offer.category === category);
}

const FOOD_INTENT_TOKENS = new Set([
  "milk",
  "cheese",
  "yoghurt",
  "yogurt",
  "butter",
  "cream",
  "banana",
  "apple",
  "bread",
  "rice",
  "eggs",
  "oat",
  "oatmilk"
]);

const NON_GROCERY_TOKENS = new Set([
  "bag", "bags", "slider", "resealable", "freezer", "garbage", "bin",
  "bottle", "bottles", "cleaner", "detergent", "soap", "shampoo", "toilet", "tissue", "foil", "wrap", "biscuit", "biscuits", "cookie", "cookies", "cracker", "crackers", "arrowroot", "lolly", "lollies", "candy"
]);

function queryTokens(query) {
  return normalizeText(query).split(" ").filter((t) => t && t.length > 1);
}

function tokenSet(text) {
  return new Set(normalizeText(text).split(" ").filter(Boolean));
}

function hasToken(text, token) {
  return tokenSet(text).has(token);
}

function scoreOfferForQuery(offer, query, tokens) {
  const name = String(offer.product_name || "");
  const brand = String(offer.product_brand || "");
  const size = String(offer.product_size || "");
  const hay = normalizeText(name + " " + brand + " " + size);
  const fullQ = normalizeText(query);
  const nameNorm = normalizeText(name);
  if (!tokens.length) return -1;

  let score = 0;
  const hayTokens = tokenSet(hay);
  const allTokensFound = tokens.every((t) => hayTokens.has(t));
  if (!allTokensFound) return -1;

  if (nameNorm === fullQ) score += 200;
  if (nameNorm.startsWith(fullQ + " ") || nameNorm === fullQ) score += 90;
  if (hasToken(nameNorm, tokens[0])) score += 45;
  if (hay.includes(fullQ)) score += 40;
  score += tokens.length * 10;

  const hasFoodIntent = tokens.some((t) => FOOD_INTENT_TOKENS.has(t));
  const hasNonGroceryWord = [...NON_GROCERY_TOKENS].some((t) => hayTokens.has(t));
  const category = String(offer.category || "other");

  if (tokens.length === 1) {
    const t0 = tokens[0];
    if (t0 === "milk" && !["dairy", "beverages"].includes(category)) return -1;
    if (t0 === "banana" && category !== "fruit_veg") return -1;
    if (t0 === "rice" && !["pantry", "beverages"].includes(category)) return -1;
  }

  if (tokens.includes("milk") && hasNonGroceryWord) return -1;

  if (hasFoodIntent && category === "dairy") score += 60;
  if (hasFoodIntent && category === "household") score -= 120;
  if (hasFoodIntent && hasNonGroceryWord) score -= 140;

  if (tokens.includes("milk")) {
    const sizeNorm = normalizeText(size);
    const likelyDrinkPack = /(ml| l | litre| liter|1l|2l|3l)/.test(" " + sizeNorm + " " );
    const inName = hasToken(nameNorm, "milk");
    if (!inName) return -1;
    const dairyish = category === "dairy" || inName;
    if (dairyish && likelyDrinkPack) score += 80;
    if (hasNonGroceryWord && !likelyDrinkPack) score -= 180;
  }

  return score;
}

function rankAndFilterOffers(offers, query) {
  const tokens = queryTokens(query);
  const ranked = [];

  for (const offer of offers) {
    const score = scoreOfferForQuery(offer, query, tokens);
    if (score < 0) continue;
    ranked.push({ ...offer, relevance_score: score });
  }

  ranked.sort((a, b) => {
    if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
    const pa = Number.isFinite(a.current_price) ? a.current_price : Number.POSITIVE_INFINITY;
    const pb = Number.isFinite(b.current_price) ? b.current_price : Number.POSITIVE_INFINITY;
    return pa - pb;
  });

  return ranked;
}

function sanitizeAldiLimit(limit) {
  const n = clamp(parseNumber(limit, 12), 1, 60);
  if (ALDI_AU_ALLOWED_LIMITS.includes(n)) return n;
  for (const allowed of ALDI_AU_ALLOWED_LIMITS) {
    if (n <= allowed) return allowed;
  }
  return 60;
}

async function rapidGet(host, pathWithQuery, apiKey, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`https://${host}${pathWithQuery}`, {
      method: "GET",
      headers: {
        "x-rapidapi-host": host,
        "x-rapidapi-key": apiKey
      },
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      status: 502,
      data: { error: error?.name === "AbortError" ? "Request timed out" : error.message || "Request failed" }
    };
  }

  clearTimeout(timeoutId);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function fetchJson(url, timeoutMs = 6500, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      status: 502,
      data: { error: error?.name === "AbortError" ? "Request timed out" : error.message || "Request failed" }
    };
  }

  clearTimeout(timeoutId);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return { ok: res.ok, status: res.status, data };
}

function normalizeOffer(item, store, source = "api") {
  const priceCandidates = [
    item.current_price,
    item.new_price,
    item.price,
    item.sale_price,
    item.unit_price,
    item?.price?.amountRelevantDisplay,
    item?.price?.amount
  ];

  let price = null;
  for (const c of priceCandidates) {
    const parsed = parsePriceValue(c);
    if (Number.isFinite(parsed)) {
      price = parsed;
      break;
    }
  }

  const slug = String(item.urlSlugText || item.url_slug || item.slug || "").replace(/^\/+/, "");
  const sku = String(item.sku || "").trim();
  let aldiUrl = null;
  if (slug && sku) {
    aldiUrl = `https://www.aldi.com.au/product/${slug}-${sku}`;
  } else if (slug) {
    aldiUrl = `https://www.aldi.com.au/product/${slug}`;
  }

  const offer = {
    store,
    product_name: item.product_name || item.name || item.title || "Unknown",
    product_brand: item.product_brand || item.brand || item.brandName || "Unknown",
    product_size: item.product_size || item.size || item.unit || item.sellingSize || null,
    current_price: Number.isFinite(price) ? Number(price) : null,
    currency: item.currency || item?.price?.currencyCode || (store === "Aldi" ? "AUD" : null),
    url: item.url || item.product_url || aldiUrl,
    source,
    category: "other"
  };
  offer.category = offerCategory(offer);
  return offer;
}

function compareByUnitOrPrice(a, b) {
  const aSize = String(a.product_size || "").toLowerCase();
  const bSize = String(b.product_size || "").toLowerCase();
  const aUnit = /(kg|\d+\s*g\b|\bg\b)/.test(aSize) ? "kg" : /(ml|\d+\s*l\b|\bl\b)/.test(aSize) ? "l" : null;
  const bUnit = /(kg|\d+\s*g\b|\bg\b)/.test(bSize) ? "kg" : /(ml|\d+\s*l\b|\bl\b)/.test(bSize) ? "l" : null;

  const aUnitPrice = parsePriceValue(a.unit_price);
  const bUnitPrice = parsePriceValue(b.unit_price);
  if (Number.isFinite(aUnitPrice) && Number.isFinite(bUnitPrice) && aUnit && bUnit && aUnit === bUnit) {
    return aUnitPrice - bUnitPrice;
  }

  const pa = Number.isFinite(a.current_price) ? a.current_price : Number.POSITIVE_INFINITY;
  const pb = Number.isFinite(b.current_price) ? b.current_price : Number.POSITIVE_INFINITY;
  return pa - pb;
}

function offerMatchKey(offer) {
  const text = normalizeText(`${offer.product_name || ""} ${offer.product_brand || ""}`)
    .replace(/\b(coles|woolworths|aldi|brand|original|classic|value|pack|pk|each|ea)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = text
    .split(" ")
    .filter((t) => t && t.length > 1 && !/^\d+$/.test(t))
    .sort()
    .slice(0, 6);

  const sizeText = normalizeText(offer.product_size || "");
  const unit = /(kg|\d+\s*g\b|\bg\b)/.test(sizeText) ? "kg" : /(ml|\d+\s*l\b|\bl\b)/.test(sizeText) ? "l" : "na";
  return `${tokens.join("_")}|${unit}`;
}
async function fetchColesProductSearch(query, page) {
  const apiKey = getApiKey("coles");
  if (!apiKey) return { ok: false, status: 500, data: { error: "Missing RAPIDAPI key for Coles" } };

  const params = new URLSearchParams({ query: String(query), page: String(page) });
  return rapidGet(COLES_HOST, `/coles/product-search/?${params.toString()}`, apiKey);
}

async function fetchWoolworthsProductSearch(query, page) {
  const apiKey = getApiKey("woolworths");
  if (!apiKey) return { ok: false, status: 500, data: { error: "Missing RAPIDAPI key for Woolworths" } };

  const params = new URLSearchParams({ query: String(query), page: String(page) });
  return rapidGet(WOOLWORTHS_HOST, `/woolworths/product-search/?${params.toString()}`, apiKey);
}

async function fetchAldiAuProductSearch(query, limit = 12, offset = 0) {
  const safeLimit = sanitizeAldiLimit(limit);
  const safeOffset = Math.max(0, parseNumber(offset, 0));
  const params = new URLSearchParams({ limit: String(safeLimit), offset: String(safeOffset) });
  if (query && String(query).trim()) params.set("q", String(query).trim());

  const url = `${ALDI_AU_BASE_URL}/v3/product-search?${params.toString()}`;
  return fetchJson(url, 7000, {
    Accept: "application/json",
    "User-Agent": "AussieSaver/1.0 (+https://localhost)"
  });
}

function getSearchResults(data) {
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function fetchColesPriceChanges(date, page, pageSize) {
  const apiKey = getApiKey("coles");
  if (!apiKey) return { ok: false, status: 500, data: { error: "Missing RAPIDAPI key for Coles" } };

  const params = new URLSearchParams({ date: String(date), page: String(page), page_size: String(pageSize) });
  return rapidGet(COLES_HOST, `/coles/price-changes/?${params.toString()}`, apiKey, 4000);
}

async function fetchWoolworthsPriceChanges(date, page, pageSize) {
  const apiKey = getApiKey("woolworths");
  if (!apiKey) return { ok: false, status: 500, data: { error: "Missing RAPIDAPI key for Woolworths" } };

  const params = new URLSearchParams({ date: String(date), page: String(page), page_size: String(pageSize) });
  return rapidGet(WOOLWORTHS_HOST, `/woolworths/price-changes/?${params.toString()}`, apiKey, 4000);
}

async function collectStoreOffers(query, limit) {
  const maxPages = 3;
  const targetCount = Math.max(limit * 2, 20);

  const tasks = [
    {
      store: "Coles",
      run: async () => {
        const found = [];
        const seen = new Set();

        for (let page = 1; page <= maxPages; page += 1) {
          const res = await fetchColesProductSearch(query, page);
          if (!res.ok) {
            return { ok: false, error: res.data?.message || res.data?.error || "Coles API failed", offers: found };
          }

          const list = getSearchResults(res.data);
          if (list.length === 0) break;

          for (const raw of list) {
            const offer = normalizeOffer(raw, "Coles", "coles-rapidapi");
            const key = offer.url || `${offer.product_name}|${offer.product_size}|${offer.current_price}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found.push(offer);
            if (found.length >= targetCount) break;
          }

          if (found.length >= targetCount) break;
        }

        return { ok: true, offers: found };
      }
    },
    {
      store: "Woolworths",
      run: async () => {
        const found = [];
        const seen = new Set();

        for (let page = 1; page <= maxPages; page += 1) {
          const res = await fetchWoolworthsProductSearch(query, page);
          if (!res.ok) {
            return {
              ok: false,
              error: res.data?.message || res.data?.error || "Woolworths API failed",
              offers: found
            };
          }

          const list = getSearchResults(res.data);
          if (list.length === 0) break;

          for (const raw of list) {
            const offer = normalizeOffer(raw, "Woolworths", "woolworths-rapidapi");
            const key = offer.url || `${offer.product_name}|${offer.product_size}|${offer.current_price}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found.push(offer);
            if (found.length >= targetCount) break;
          }

          if (found.length >= targetCount) break;
        }

        return { ok: true, offers: found };
      }
    },
    {
      store: "Aldi",
      run: async () => {
        const res = await fetchAldiAuProductSearch(query, Math.max(12, limit * 2), 0);
        if (!res.ok) {
          return {
            ok: false,
            error: res.data?.message || res.data?.error || "ALDI AU API failed",
            offers: []
          };
        }

        const list = getSearchResults(res.data);
        const offers = list
          .map((raw) => normalizeOffer(raw, "Aldi", "aldi-au-public-api"))
          .filter((offer) => offer.product_name && (Number.isFinite(offer.current_price) || offer.url));

        return { ok: true, offers };
      }
    }
  ];

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  const offers = [];
  const stores = {};

  settled.forEach((result, idx) => {
    const store = tasks[idx].store;
    if (result.status === "fulfilled") {
      stores[store] = { ok: result.value.ok, error: result.value.error || null };
      offers.push(...(Array.isArray(result.value.offers) ? result.value.offers : []));
      return;
    }

    stores[store] = { ok: false, error: result.reason?.message || "Request failed" };
  });

  return { offers, stores };
}

function buildComparison(offers, limit) {
  const grouped = new Map();

  for (const offer of offers) {
    const key = offerMatchKey(offer);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        product_name: offer.product_name,
        product_brand: offer.product_brand,
        product_size: offer.product_size,
        offers: []
      });
    }

    grouped.get(key).offers.push(offer);
  }

  const compared = [];
  for (const group of grouped.values()) {
    group.offers.sort(compareByUnitOrPrice);

    const best = group.offers.find((o) => Number.isFinite(o.current_price)) || null;
    const max = [...group.offers].reverse().find((o) => Number.isFinite(o.current_price)) || null;
    const savings =
      best && max && Number.isFinite(best.current_price) && Number.isFinite(max.current_price)
        ? Number((max.current_price - best.current_price).toFixed(2))
        : null;

    compared.push({ ...group, best_offer: best, savings });
  }

  compared.sort((a, b) => {
    const sa = Number.isFinite(a.savings) ? a.savings : -1;
    const sb = Number.isFinite(b.savings) ? b.savings : -1;
    if (sb !== sa) return sb - sa;

    const pa = Number.isFinite(a.best_offer?.current_price) ? a.best_offer.current_price : Number.POSITIVE_INFINITY;
    const pb = Number.isFinite(b.best_offer?.current_price) ? b.best_offer.current_price : Number.POSITIVE_INFINITY;
    return pa - pb;
  });

  return compared.slice(0, limit);
}

function buildVisibleOffers(offers, maxCount) {
  const buckets = {};

  for (const offer of offers) {
    const store = offer.store || "Other";
    if (!buckets[store]) buckets[store] = [];
    buckets[store].push(offer);
  }

  for (const store of Object.keys(buckets)) {
    buckets[store].sort((a, b) => {
      const pa = Number.isFinite(a.current_price) ? a.current_price : Number.POSITIVE_INFINITY;
      const pb = Number.isFinite(b.current_price) ? b.current_price : Number.POSITIVE_INFINITY;
      return pa - pb;
    });
  }

  const stores = Object.keys(buckets).sort();
  const out = [];
  let idx = 0;
  let progressed = true;

  while (out.length < maxCount && progressed) {
    progressed = false;
    for (const store of stores) {
      const list = buckets[store];
      if (idx < list.length) {
        out.push(list[idx]);
        progressed = true;
        if (out.length >= maxCount) break;
      }
    }
    idx += 1;
  }

  return out;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  return fetchJson(url, timeoutMs, { "User-Agent": "AussieSaver/1.0 (student shopping app)" });
}

function guessStore(name) {
  const text = normalizeText(name);
  if (text.includes("coles")) return "Coles";
  if (text.includes("woolworth")) return "Woolworths";
  if (text.includes("aldi")) return "Aldi";
  if (text.includes("kmart")) return "Kmart";
  if (text.includes("big w")) return "Big W";
  return "Other";
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

async function fetchNearbyOutlets(lat, lng, radiusKm, limit) {
  const reverseUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&addressdetails=1`;
  const reverse = await fetchJsonWithTimeout(reverseUrl, 5000);
  const address = reverse.data?.address || {};
  const areaToken =
    address.suburb || address.city || address.town || address.state_district || address.state || "Australia";

  const brandQueries = [
    { store: "Coles", terms: ["Coles"] },
    { store: "Woolworths", terms: ["Woolworths"] },
    { store: "Aldi", terms: ["ALDI"] },
    { store: "Kmart", terms: ["Kmart"] },
    { store: "Big W", terms: ["Big W"] }
  ];
  const results = [];
  const fallbackCandidates = [];
  const seen = new Set();
  const perBrandLimit = Math.min(Math.max(Math.ceil(limit / brandQueries.length) + 2, 3), 10);
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLon = lng - lonDelta;
  const maxLon = lng + lonDelta;
  const viewbox = `${minLon},${maxLat},${maxLon},${minLat}`;

  for (const brand of brandQueries) {
    for (const term of brand.terms) {
      const queryVariants = [term + " " + areaToken];
      for (const queryText of queryVariants) {
        const q = encodeURIComponent(queryText);
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&bounded=1&viewbox=${encodeURIComponent(viewbox)}&q=${q}&limit=${perBrandLimit}`;
        const response = await fetchJsonWithTimeout(url, 3500);
        if (!response.ok || !Array.isArray(response.data)) continue;

        for (const place of response.data) {
          const pLat = Number(place.lat);
          const pLng = Number(place.lon);
          if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;

          const distanceKm = haversineKm(lat, lng, pLat, pLng);
          const key = `${place.osm_type || "x"}-${place.osm_id || `${pLat}-${pLng}`}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const name = place.name || term;
          const detectedStore = guessStore(`${name} ${place.display_name || ""} ${term}`);
          const normalized = {
            name,
            store: detectedStore === "Other" ? brand.store : detectedStore,
            latitude: pLat,
            longitude: pLng,
            distance_km: Number(distanceKm.toFixed(2)),
            address: place.display_name || "",
            within_radius: distanceKm <= radiusKm
          };

          fallbackCandidates.push(normalized);
          if (distanceKm <= radiusKm) results.push(normalized);
        }
      }
    }
  }

  const sortedInRadius = [...results].sort((a, b) => a.distance_km - b.distance_km);
  if (sortedInRadius.length > 0) {
    return { ok: true, status: 200, data: { results: sortedInRadius.slice(0, limit), strict_radius: true } };
  }

  const sortedFallback = [...fallbackCandidates].sort((a, b) => a.distance_km - b.distance_km);
  return { ok: true, status: 200, data: { results: sortedFallback.slice(0, limit), strict_radius: false } };
}

async function handleCombinedSearch(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const q = (requestUrl.searchParams.get("q") || "").trim();
  const limit = clamp(parseNumber(requestUrl.searchParams.get("limit"), 15), 1, 60);
  const category = sanitizeCategory(requestUrl.searchParams.get("category"));

  if (!q) {
    sendJson(res, 400, { error: "Missing query parameter: q" });
    return;
  }

  try {
    const { offers, stores } = await collectStoreOffers(q, limit);
    const categoryFiltered = filterOffersByCategory(offers, category);
    const filteredOffers = rankAndFilterOffers(categoryFiltered, q);
    const comparisons = buildComparison(filteredOffers, limit);
    const visibleOffers = buildVisibleOffers(filteredOffers, limit * 8);

    sendJson(res, 200, {
      query: q,
      category,
      count: comparisons.length,
      offers_count: filteredOffers.length,
      raw_offers_count: offers.length,
      stores,
      comparisons,
      offers: visibleOffers
    });
  } catch (error) {
    sendJson(res, 502, { error: "Unable to fetch product comparison", details: error.message });
  }
}

async function handleAldiSearch(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const q = (requestUrl.searchParams.get("q") || "").trim();
  const limit = sanitizeAldiLimit(requestUrl.searchParams.get("limit") || 12);
  const offset = Math.max(0, parseNumber(requestUrl.searchParams.get("offset"), 0));
  const category = sanitizeCategory(requestUrl.searchParams.get("category"));

  if (!q) {
    sendJson(res, 400, { error: "Missing query parameter: q" });
    return;
  }

  const upstream = await fetchAldiAuProductSearch(q, limit, offset);
  if (!upstream.ok) {
    sendJson(res, upstream.status || 502, {
      error: upstream.data?.message || upstream.data?.error || "ALDI AU search failed",
      upstream: upstream.data
    });
    return;
  }

  const list = getSearchResults(upstream.data);
  const allResults = list.map((raw) => normalizeOffer(raw, "Aldi", "aldi-au-public-api"));
  const results = filterOffersByCategory(allResults, category);

  sendJson(res, 200, {
    query: q,
    category,
    limit,
    offset,
    count: results.length,
    total: parseNumber(upstream.data?.total, allResults.length),
    results,
    source: "aldi-au-public-api"
  });
}

async function handlePriceChanges(req, res, store) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const date = requestUrl.searchParams.get("date");
  const page = requestUrl.searchParams.get("page") || "1";
  const pageSize = requestUrl.searchParams.get("page_size") || "20";

  if (!date) {
    sendJson(res, 400, { error: "Missing required query parameter: date (YYYY-MM-DD)." });
    return;
  }

  const fetcher = store === "woolworths" ? fetchWoolworthsPriceChanges : fetchColesPriceChanges;
  const upstream = await fetcher(date, page, pageSize);
  if (!upstream.ok) {
    sendJson(res, upstream.status, {
      error: upstream.data?.message || upstream.data?.error || `${store} API request failed`,
      upstream: upstream.data
    });
    return;
  }

  sendJson(res, 200, upstream.data);
}

async function handleCombinedNews(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const q = (requestUrl.searchParams.get("q") || "").trim();
  const days = clamp(parseNumber(requestUrl.searchParams.get("days"), 7), 1, 14);
  const limit = clamp(parseNumber(requestUrl.searchParams.get("limit"), 25), 1, 100);
  const endDateParam = requestUrl.searchParams.get("end_date");
  const endDate = parseDate(endDateParam) || new Date();

  const results = [];
  const seen = new Set();
  const stores = {
    Coles: { ok: true, error: null },
    Woolworths: { ok: true, error: null },
    Aldi: { ok: false, error: "Price-change endpoint not available for ALDI AU" }
  };

  const deadlineMs = Date.now() + 12000;

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    if (Date.now() > deadlineMs || results.length >= limit) break;

    const d = new Date(endDate);
    d.setDate(endDate.getDate() - dayOffset);
    const date = formatDate(d);

    const [colesRes, wooliesRes] = await Promise.all([
      fetchColesPriceChanges(date, 1, 20),
      fetchWoolworthsPriceChanges(date, 1, 20)
    ]);

    const batches = [
      { store: "Coles", upstream: colesRes },
      { store: "Woolworths", upstream: wooliesRes }
    ];

    for (const { store, upstream } of batches) {
      if (!upstream.ok) {
        stores[store] = { ok: false, error: upstream.data?.message || upstream.data?.error || "Unavailable" };
        continue;
      }

      const list = Array.isArray(upstream.data.results) ? upstream.data.results : [];
      for (const raw of list) {
        const name = raw.product_name || raw.name || "Unknown";
        const brand = raw.product_brand || raw.brand || "Unknown";
        if (q && !normalizeText(`${name} ${brand}`).includes(normalizeText(q))) continue;

        const oldPrice = parsePriceValue(raw.old_price);
        const newPrice = parsePriceValue(raw.new_price);
        const key = `${store}|${date}|${raw.url || `${name}|${brand}`}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          store,
          date,
          product_name: name,
          product_brand: brand,
          old_price: Number.isFinite(oldPrice) ? oldPrice : null,
          new_price: Number.isFinite(newPrice) ? newPrice : null,
          delta:
            Number.isFinite(oldPrice) && Number.isFinite(newPrice)
              ? Number((newPrice - oldPrice).toFixed(2))
              : null,
          url: raw.url || null
        });

        if (results.length >= limit) break;
      }
    }
  }

  results.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return Math.abs(b.delta || 0) - Math.abs(a.delta || 0);
  });

  sendJson(res, 200, {
    query: q,
    days,
    end_date: formatDate(endDate),
    count: Math.min(results.length, limit),
    stores,
    results: results.slice(0, limit)
  });
}

async function handleNearbyOutlets(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const lat = parseNumber(requestUrl.searchParams.get("lat"), NaN);
  const lng = parseNumber(requestUrl.searchParams.get("lng"), NaN);
  const radiusKm = clamp(parseNumber(requestUrl.searchParams.get("radius_km"), 5), 1, 25);
  const limit = clamp(parseNumber(requestUrl.searchParams.get("limit"), 15), 1, 50);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJson(res, 400, { error: "Missing valid lat/lng query params." });
    return;
  }

  try {
    const upstream = await fetchNearbyOutlets(lat, lng, radiusKm, limit);
    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: "Outlet search failed", upstream: upstream.data });
      return;
    }

    sendJson(res, 200, {
      latitude: lat,
      longitude: lng,
      radius_km: radiusKm,
      strict_radius: upstream.data.strict_radius !== false,
      count: upstream.data.results.length,
      results: upstream.data.results
    });
  } catch (error) {
    sendJson(res, 502, { error: "Unable to fetch nearby outlets", details: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/api/outlets/nearby")) {
    await handleNearbyOutlets(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/news")) {
    await handleCombinedNews(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/compare/search")) {
    await handleCombinedSearch(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/aldi/search")) {
    await handleAldiSearch(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/coles/price-changes")) {
    await handlePriceChanges(req, res, "coles");
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/woolworths/price-changes")) {
    await handlePriceChanges(req, res, "woolworths");
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
});

server.listen(PORT, () => {
  console.log(`Aussie Saver running at http://localhost:${PORT}`);
});
