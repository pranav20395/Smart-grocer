const STORAGE_KEY = "aussie-saver-v1";

const state = {
  items: [],
  prices: [],
  liveResults: [],
  searchOffers: [],
  visibleOffers: [],
  compareSummary: null,
  newsResults: [],
  outletsResults: [],
  user: null,
  cloudEnabled: false,
  cloudSyncError: null,
  lastCloudSyncAt: null
};

const els = {
  authForm: document.getElementById("auth-form"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authSignIn: document.getElementById("auth-signin"),
  authSignUp: document.getElementById("auth-signup"),
  authSignOut: document.getElementById("auth-signout"),
  authStatus: document.getElementById("auth-status"),
  colesSearchForm: document.getElementById("coles-search-form"),
  colesSearchQuery: document.getElementById("coles-search-query"),
  colesSearchLimit: document.getElementById("coles-search-limit"),
  compareSort: document.getElementById("compare-sort"),
  compareStore: document.getElementById("compare-store"),
  compareCategory: document.getElementById("compare-category"),
  cheapestOnly: document.getElementById("cheapest-only"),
  colesSearchStatus: document.getElementById("coles-search-status"),
  compareSummary: document.getElementById("compare-summary"),
  colesSearchResults: document.getElementById("coles-search-results"),
  newsForm: document.getElementById("news-form"),
  newsQuery: document.getElementById("news-query"),
  newsDays: document.getElementById("news-days"),
  newsLimit: document.getElementById("news-limit"),
  newsStatus: document.getElementById("news-status"),
  newsResults: document.getElementById("news-results"),
  outletsRadius: document.getElementById("outlets-radius"),
  outletsLimit: document.getElementById("outlets-limit"),
  useLocation: document.getElementById("use-location"),
  outletsStatus: document.getElementById("outlets-status"),
  outletsResults: document.getElementById("outlets-results"),
  livePricesForm: document.getElementById("live-prices-form"),
  liveDate: document.getElementById("live-date"),
  livePage: document.getElementById("live-page"),
  livePageSize: document.getElementById("live-page-size"),
  liveQuery: document.getElementById("live-query"),
  liveStatus: document.getElementById("live-status"),
  liveResults: document.getElementById("live-results"),
  itemForm: document.getElementById("item-form"),
  itemName: document.getElementById("item-name"),
  itemCategory: document.getElementById("item-category"),
  itemQuantity: document.getElementById("item-quantity"),
  shoppingList: document.getElementById("shopping-list"),
  priceForm: document.getElementById("price-form"),
  priceItem: document.getElementById("price-item"),
  priceStore: document.getElementById("price-store"),
  priceValue: document.getElementById("price-value"),
  comparison: document.getElementById("comparison"),
  recalculate: document.getElementById("recalculate")
};

let supabaseClient = null;
let cloudSaveTimer = null;

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMoney(n) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.items = Array.isArray(parsed.items) ? parsed.items : [];
    state.prices = Array.isArray(parsed.prices) ? parsed.prices : [];
  } catch {
    state.items = [];
    state.prices = [];
  }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items, prices: state.prices }));
}

function save() {
  saveLocal();
  scheduleCloudSave();
}

function getSupabaseConfig() {
  const config = window.APP_CONFIG || {};
  const url = config.SUPABASE_URL || "";
  const anon = config.SUPABASE_ANON_KEY || "";
  return { url: String(url).trim(), anon: String(anon).trim() };
}

function setAuthStatus(message) {
  if (els.authStatus) els.authStatus.textContent = message;
}

function updateAuthUI() {
  const signedIn = Boolean(state.user);
  if (els.authSignOut) els.authSignOut.style.display = signedIn ? "inline-block" : "none";
  if (!signedIn) {
    setAuthStatus(state.cloudEnabled ? "Not signed in. Using local data." : "Supabase not configured. Using local data.");
    return;
  }
  const syncPart = state.cloudSyncError
    ? ` | Sync error: ${state.cloudSyncError}`
    : state.lastCloudSyncAt
      ? ` | Synced at ${new Date(state.lastCloudSyncAt).toLocaleTimeString()}`
      : " | Sync pending";
  setAuthStatus(`Signed in as ${state.user.email}${syncPart}`);
}

async function initSupabase() {
  const { url, anon } = getSupabaseConfig();
  if (!url || !anon || !window.supabase?.createClient) {
    state.cloudEnabled = false;
    updateAuthUI();
    return;
  }

  supabaseClient = window.supabase.createClient(url, anon);
  state.cloudEnabled = true;

  const {
    data: { session }
  } = await supabaseClient.auth.getSession();

  state.user = session?.user || null;
  updateAuthUI();

  if (state.user) {
    try {
      await loadCloudData();
      state.cloudSyncError = null;
    } catch (error) {
      state.cloudSyncError = error.message || "Unable to load cloud data";
    }
    render();
  }

  supabaseClient.auth.onAuthStateChange(async (_event, sessionData) => {
    state.user = sessionData?.user || null;
    state.cloudSyncError = null;
    updateAuthUI();
    if (state.user) {
      try {
        await loadCloudData();
        state.cloudSyncError = null;
      } catch (error) {
        state.cloudSyncError = error.message || "Unable to load cloud data";
      }
      render();
    }
  });
}

async function signIn(email, password) {
  if (!supabaseClient) throw new Error("Supabase not configured.");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signUp(email, password) {
  if (!supabaseClient) throw new Error("Supabase not configured.");
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) throw error;
}

async function signOut() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

function serializeItemsForCloud() {
  if (!state.user) return [];
  return state.items.map((item) => ({
    user_id: state.user.id,
    client_id: item.id,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    done: Boolean(item.done)
  }));
}

function serializePricesForCloud() {
  if (!state.user) return [];
  return state.prices.map((price) => ({
    user_id: state.user.id,
    client_id: price.id,
    item_client_id: price.itemId,
    store: price.store,
    price: price.price,
    source: price.source || "manual",
    updated_at: price.updatedAt || new Date().toISOString()
  }));
}

async function saveCloudData() {
  if (!supabaseClient || !state.user) return;

  const pricesRows = serializePricesForCloud();
  const itemRows = serializeItemsForCloud();
  const userId = state.user.id;

  const existingItemsRes = await supabaseClient.from("shopping_items").select("client_id").eq("user_id", userId);
  if (existingItemsRes.error) throw existingItemsRes.error;

  const existingPricesRes = await supabaseClient.from("item_prices").select("client_id").eq("user_id", userId);
  if (existingPricesRes.error) throw existingPricesRes.error;

  if (itemRows.length > 0) {
    const upsertItems = await supabaseClient.from("shopping_items").upsert(itemRows, {
      onConflict: "user_id,client_id"
    });
    if (upsertItems.error) throw upsertItems.error;
  } else {
    const clearItems = await supabaseClient.from("shopping_items").delete().eq("user_id", userId);
    if (clearItems.error) throw clearItems.error;
  }

  if (pricesRows.length > 0) {
    const upsertPrices = await supabaseClient.from("item_prices").upsert(pricesRows, {
      onConflict: "user_id,client_id"
    });
    if (upsertPrices.error) throw upsertPrices.error;
  } else {
    const clearPrices = await supabaseClient.from("item_prices").delete().eq("user_id", userId);
    if (clearPrices.error) throw clearPrices.error;
  }

  const itemKeep = new Set(itemRows.map((row) => row.client_id));
  const itemDeleteIds = (existingItemsRes.data || []).map((row) => row.client_id).filter((id) => !itemKeep.has(id));
  if (itemDeleteIds.length > 0) {
    const cleanupItems = await supabaseClient
      .from("shopping_items")
      .delete()
      .eq("user_id", userId)
      .in("client_id", itemDeleteIds);
    if (cleanupItems.error) throw cleanupItems.error;
  }

  const priceKeep = new Set(pricesRows.map((row) => row.client_id));
  const priceDeleteIds = (existingPricesRes.data || []).map((row) => row.client_id).filter((id) => !priceKeep.has(id));
  if (priceDeleteIds.length > 0) {
    const cleanupPrices = await supabaseClient
      .from("item_prices")
      .delete()
      .eq("user_id", userId)
      .in("client_id", priceDeleteIds);
    if (cleanupPrices.error) throw cleanupPrices.error;
  }

  state.lastCloudSyncAt = new Date().toISOString();
  state.cloudSyncError = null;
}

function scheduleCloudSave() {
  if (!state.user || !supabaseClient) return;
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);

  cloudSaveTimer = setTimeout(async () => {
    try {
      await saveCloudData();
      updateAuthUI();
    } catch (error) {
      state.cloudSyncError = error.message || "Cloud sync failed";
      updateAuthUI();
      console.error("Cloud sync failed", error);
    }
  }, 500);
}

async function loadCloudData() {
  if (!supabaseClient || !state.user) return;

  const itemsRes = await supabaseClient
    .from("shopping_items")
    .select("client_id,name,category,quantity,done")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: true });

  if (itemsRes.error) throw itemsRes.error;

  const pricesRes = await supabaseClient
    .from("item_prices")
    .select("client_id,item_client_id,store,price,source,updated_at")
    .eq("user_id", state.user.id)
    .order("updated_at", { ascending: false });

  if (pricesRes.error) throw pricesRes.error;

  state.items = (itemsRes.data || []).map((row) => ({
    id: row.client_id,
    name: row.name,
    category: row.category || "General",
    quantity: Number(row.quantity) || 1,
    done: Boolean(row.done)
  }));

  state.prices = (pricesRes.data || []).map((row) => ({
    id: row.client_id,
    itemId: row.item_client_id,
    store: row.store,
    price: Number(row.price),
    source: row.source || "manual",
    updatedAt: row.updated_at || new Date().toISOString()
  }));

  saveLocal();
  state.lastCloudSyncAt = new Date().toISOString();
  state.cloudSyncError = null;
}

function addItem(name, category, quantity) {
  const cleanName = name.trim();
  const existing = state.items.find((x) => x.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) return existing;

  const item = {
    id: uid(),
    name: cleanName,
    category: category.trim() || "General",
    quantity,
    done: false
  };
  state.items.push(item);
  save();
  render();
  return item;
}

function setPrice(itemId, store, price, source) {
  const existing = state.prices.find((p) => p.itemId === itemId && p.store === store);
  if (existing) {
    existing.price = price;
    existing.updatedAt = new Date().toISOString();
    existing.source = source || existing.source || "manual";
  } else {
    state.prices.push({
      id: uid(),
      itemId,
      store,
      price,
      source: source || "manual",
      updatedAt: new Date().toISOString()
    });
  }
  save();
  renderComparison();
}

function toggleItem(itemId) {
  const item = state.items.find((x) => x.id === itemId);
  if (!item) return;
  item.done = !item.done;
  save();
  render();
}

function removeItem(itemId) {
  state.items = state.items.filter((x) => x.id !== itemId);
  state.prices = state.prices.filter((x) => x.itemId !== itemId);
  save();
  render();
}

function renderItems() {
  els.shoppingList.innerHTML = "";
  if (state.items.length === 0) {
    els.shoppingList.innerHTML = "<li class='row'>No items yet.</li>";
    return;
  }

  for (const item of state.items) {
    const li = document.createElement("li");
    li.className = "list-item";

    const label = document.createElement("span");
    label.className = item.done ? "done" : "";
    label.textContent = `${item.name} (${item.category}) x${item.quantity}`;

    const actions = document.createElement("div");
    actions.className = "actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = item.done ? "Undo" : "Bought";
    toggleBtn.addEventListener("click", () => toggleItem(item.id));

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.textContent = "Delete";
    removeBtn.addEventListener("click", () => removeItem(item.id));

    actions.append(toggleBtn, removeBtn);
    li.append(label, actions);
    els.shoppingList.appendChild(li);
  }
}

function renderPriceItemOptions() {
  if (!els.priceItem) return;
  const prev = els.priceItem.value;
  els.priceItem.innerHTML = "";

  if (state.items.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Add an item first";
    els.priceItem.appendChild(opt);
    els.priceItem.disabled = true;
    return;
  }

  els.priceItem.disabled = false;
  for (const item of state.items) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.name;
    els.priceItem.appendChild(opt);
  }

  if (state.items.some((x) => x.id === prev)) {
    els.priceItem.value = prev;
  }
}

function calculateCheapestPlan() {
  const activeItems = state.items.filter((x) => !x.done);
  const rows = [];
  let mixedTotal = 0;
  const storeTotals = {};

  for (const item of activeItems) {
    const itemPrices = state.prices.filter((p) => p.itemId === item.id);
    if (itemPrices.length === 0) {
      rows.push({ type: "missing", item });
      continue;
    }
    const cheapest = itemPrices.reduce((a, b) => (a.price <= b.price ? a : b));
    mixedTotal += cheapest.price * item.quantity;
    rows.push({ type: "best", item, ...cheapest });
  }

  const stores = [...new Set(state.prices.map((x) => x.store))];
  for (const store of stores) {
    let total = 0;
    let complete = true;
    for (const item of activeItems) {
      const p = state.prices.find((x) => x.itemId === item.id && x.store === store);
      if (!p) {
        complete = false;
        break;
      }
      total += p.price * item.quantity;
    }
    if (complete) storeTotals[store] = total;
  }

  return { rows, mixedTotal, storeTotals, activeCount: activeItems.length };
}

function renderComparison() {
  els.comparison.innerHTML = "";
  const { rows, mixedTotal, storeTotals, activeCount } = calculateCheapestPlan();

  if (activeCount === 0) {
    els.comparison.innerHTML = "<div class='row'>All done. Your shopping list is complete.</div>";
    return;
  }

  for (const row of rows) {
    const div = document.createElement("div");
    div.className = "row";
    if (row.type === "missing") {
      div.textContent = `${row.item.name}: no prices yet.`;
    } else {
      div.textContent = `${row.item.name}: best at ${row.store} for ${formatMoney(row.price)} each (${row.source || "manual"})`;
    }
    els.comparison.appendChild(div);
  }

  const mixed = document.createElement("div");
  mixed.className = "row";
  mixed.innerHTML = `<strong>Mixed-store total:</strong> ${formatMoney(mixedTotal)}`;
  els.comparison.appendChild(mixed);

  const entries = Object.entries(storeTotals).sort((a, b) => a[1] - b[1]);
  if (entries.length === 0) {
    els.comparison.innerHTML += "<div class='row'>No single store has prices for all active items yet.</div>";
  } else {
    for (const [store, total] of entries) {
      els.comparison.innerHTML += `<div class='row'><strong>${store} total:</strong> ${formatMoney(total)}</div>`;
    }
  }
}

async function searchCombinedProductCosts(query, limit, category) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (category && category !== "all") params.set("category", category);
  const res = await fetch(`/api/compare/search?${params.toString()}`);
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Comparison failed");
  return payload;
}

async function fetchPriceNews(query, days, limit) {
  const params = new URLSearchParams({ days: String(days), limit: String(limit) });
  if (query) params.set("q", query);
  const res = await fetch(`/api/news?${params.toString()}`);
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "News fetch failed");
  return payload;
}

async function fetchNearbyOutlets(lat, lng, radiusKm, limit) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_km: String(radiusKm),
    limit: String(limit)
  });
  const res = await fetch(`/api/outlets/nearby?${params.toString()}`);
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Outlet search failed");
  return payload;
}

async function fetchLiveColesPrices(date, page, pageSize, query) {
  const params = new URLSearchParams({ date, page: String(page), page_size: String(pageSize) });
  if (query) params.set("q", query);
  const res = await fetch(`/api/coles/price-changes?${params.toString()}`);
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Live fetch failed");
  return payload;
}

function renderCompareSummary() {
  els.compareSummary.innerHTML = "";
  const summary = state.compareSummary;
  if (!summary) return;

  const stores = summary.stores || {};
  const storeText = Object.entries(stores)
    .map(([name, info]) => `${name}: ${info.ok ? "OK" : `Unavailable (${info.error || "error"})`}`)
    .join(" | ");

  const top = Array.isArray(summary.comparisons) ? summary.comparisons.slice(0, 5) : [];
  const rows = top
    .map((c) => {
      const b = c.best_offer;
      if (!b || !Number.isFinite(Number(b.current_price))) return "";
      const savings = Number.isFinite(Number(c.savings)) && Number(c.savings) > 0 ? ` (save up to ${formatMoney(Number(c.savings))})` : "";
      return `<div class='row'>${c.product_name} ${c.product_size || ""}: best <strong>${b.store}</strong> ${formatMoney(Number(b.current_price))}${savings}</div>`;
    })
    .filter(Boolean)
    .join("");

  els.compareSummary.innerHTML = `<div class='row'><strong>Store APIs:</strong> ${storeText || "N/A"}</div>${rows}`;
}

function offerKey(offer) {
  const name = String(offer.product_name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const size = String(offer.product_size || "")
    .toLowerCase()
    .trim();
  return `${name}|${size}`;
}

function getVisibleOffers() {
  const sortBy = els.compareSort?.value || "price_asc";
  const store = els.compareStore?.value || "all";
  const category = els.compareCategory?.value || "all";
  const cheapestOnly = Boolean(els.cheapestOnly?.checked);

  let list = [...state.searchOffers];
  if (store !== "all") {
    list = list.filter((o) => (o.store || "").toLowerCase() === store.toLowerCase());
  }
  if (category !== "all") {
    list = list.filter((o) => (o.category || "other") === category);
  }

  if (cheapestOnly) {
    const map = new Map();
    for (const offer of list) {
      const key = offerKey(offer);
      const price = Number(offer.current_price);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, offer);
        continue;
      }
      const exPrice = Number(existing.current_price);
      if (!Number.isFinite(exPrice) || (Number.isFinite(price) && price < exPrice)) {
        map.set(key, offer);
      }
    }
    list = [...map.values()];
  }

  list.sort((a, b) => {
    const pa = Number(a.current_price);
    const pb = Number(b.current_price);
    const av = Number.isFinite(pa) ? pa : Number.POSITIVE_INFINITY;
    const bv = Number.isFinite(pb) ? pb : Number.POSITIVE_INFINITY;

    if (sortBy === "price_desc") return bv - av;
    if (sortBy === "name_asc") return String(a.product_name || "").localeCompare(String(b.product_name || ""));
    if (sortBy === "store_asc") return String(a.store || "").localeCompare(String(b.store || ""));
    return av - bv;
  });

  return list;
}

function renderSearchOffers() {
  els.colesSearchResults.innerHTML = "";
  const visible = getVisibleOffers();
  state.visibleOffers = visible;

  if (visible.length === 0) {
    els.colesSearchResults.innerHTML = "<div class='row'>No matching offers found. Try broader keywords.</div>";
    return;
  }

  const rows = visible
    .map((item, idx) => {
      const price = Number(item.current_price);
      const priceTxt = Number.isFinite(price) ? formatMoney(price) : "N/A";
      const link = item.url ? `<a href='${item.url}' target='_blank' rel='noreferrer'>Open</a>` : "No link";
      return `<tr>
        <td>${item.product_name || "Unknown"}</td>
        <td>${item.product_brand || "Unknown"}</td>
        <td>${item.store || "Unknown"}</td>
        <td>${item.category || "other"}</td>
        <td>${item.product_size || "N/A"}</td>
        <td>${priceTxt}</td>
        <td>${link}</td>
        <td>
          <button data-action='add-item' data-index='${idx}'>Add Item</button>
          <button data-action='add-price' data-index='${idx}'>Add + Save Price</button>
        </td>
      </tr>`;
    })
    .join("");

  els.colesSearchResults.innerHTML = `<div class='table-wrap'><table class='results-table'>
    <thead>
      <tr>
        <th>Product</th>
        <th>Brand</th>
        <th>Store</th>
        <th>Category</th>
        <th>Size</th>
        <th>Price</th>
        <th>Link</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderNewsResults() {
  els.newsResults.innerHTML = "";
  if (state.newsResults.length === 0) {
    els.newsResults.innerHTML = "<div class='row'>No price-change stories found.</div>";
    return;
  }

  const rows = state.newsResults
    .map((story, idx) => {
      const up = Number(story.delta) > 0;
      const down = Number(story.delta) < 0;
      const changeLabel = Number.isFinite(Number(story.delta))
        ? `${down ? "Down" : up ? "Up" : "No change"} ${formatMoney(Math.abs(Number(story.delta)))}`
        : "N/A";
      const from = Number.isFinite(Number(story.old_price)) ? formatMoney(Number(story.old_price)) : "N/A";
      const to = Number.isFinite(Number(story.new_price)) ? formatMoney(Number(story.new_price)) : "N/A";
      const directionClass = down ? "chip chip-down" : up ? "chip chip-up" : "chip";
      const link = story.url ? `<a href='${story.url}' target='_blank' rel='noreferrer'>Open</a>` : "No link";

      return `<tr>
        <td>${story.date || "N/A"}</td>
        <td>${story.store || "Unknown"}</td>
        <td>${story.product_name || "Unknown"}</td>
        <td>${story.product_brand || "Unknown"}</td>
        <td>${from} -> ${to}</td>
        <td><span class='${directionClass}'>${changeLabel}</span></td>
        <td>${link}</td>
        <td><button data-action='news-add-price' data-index='${idx}'>Add + Save Price</button></td>
      </tr>`;
    })
    .join("");

  els.newsResults.innerHTML = `<div class='table-wrap'><table class='results-table'>
    <thead>
      <tr>
        <th>Date</th>
        <th>Store</th>
        <th>Product</th>
        <th>Brand</th>
        <th>Price Move</th>
        <th>Direction</th>
        <th>Link</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderOutletsResults() {
  els.outletsResults.innerHTML = "";
  if (state.outletsResults.length === 0) {
    els.outletsResults.innerHTML = "<div class='row'>No outlets found in this radius.</div>";
    return;
  }

  const rows = state.outletsResults
    .map((o) => {
      const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.latitude},${o.longitude}`)}`;
      return `<tr>
        <td>${o.name || "Outlet"}</td>
        <td>${o.store || "Other"}</td>
        <td>${Number.isFinite(Number(o.distance_km)) ? `${Number(o.distance_km).toFixed(2)} km` : "N/A"}</td>
        <td>${o.address || "N/A"}</td>
        <td><a href='${maps}' target='_blank' rel='noreferrer'>Open Map</a></td>
      </tr>`;
    })
    .join("");

  els.outletsResults.innerHTML = `<div class='table-wrap'><table class='results-table'>
    <thead>
      <tr>
        <th>Outlet</th>
        <th>Store</th>
        <th>Distance</th>
        <th>Address</th>
        <th>Map</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderLiveResults() {
  els.liveResults.innerHTML = "";
  if (state.liveResults.length === 0) return;

  for (const result of state.liveResults) {
    const productName = result.product_name || "Unknown product";
    const newPrice = Number(result.new_price);
    const oldPrice = Number(result.old_price);

    const row = document.createElement("div");
    row.className = "row result-row";

    const line = document.createElement("div");
    const newTxt = Number.isFinite(newPrice) ? formatMoney(newPrice) : "N/A";
    const oldTxt = Number.isFinite(oldPrice) ? formatMoney(oldPrice) : "N/A";
    line.innerHTML = `<strong>${productName}</strong><br/>Now: ${newTxt} | Before: ${oldTxt}`;

    const actions = document.createElement("div");
    actions.className = "result-actions";

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.textContent = "Import to My List";
    importBtn.disabled = !Number.isFinite(newPrice);
    importBtn.addEventListener("click", () => {
      const item = addItem(productName, "Groceries", 1);
      setPrice(item.id, "Coles", newPrice, "coles-price-changes");
      els.liveStatus.textContent = `Imported ${productName} at ${formatMoney(newPrice)}.`;
    });

    actions.appendChild(importBtn);

    if (result.url) {
      const link = document.createElement("a");
      link.href = result.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open Product";
      actions.appendChild(link);
    }

    row.append(line, actions);
    els.liveResults.appendChild(row);
  }
}

function render() {
  renderItems();
  renderPriceItemOptions();
  renderComparison();
  renderLiveResults();
  renderSearchOffers();
  renderCompareSummary();
  renderNewsResults();
  renderOutletsResults();
  updateAuthUI();
}

els.authSignIn?.addEventListener("click", async () => {
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) return;
  try {
    setAuthStatus("Signing in...");
    await signIn(email, password);
  } catch (error) {
    setAuthStatus(`Sign in failed: ${error.message}`);
  }
});

els.authSignUp?.addEventListener("click", async () => {
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) return;
  try {
    setAuthStatus("Creating account...");
    await signUp(email, password);
    setAuthStatus("Account created. Check email if confirmation is required.");
  } catch (error) {
    setAuthStatus(`Sign up failed: ${error.message}`);
  }
});

els.authSignOut?.addEventListener("click", async () => {
  try {
    await signOut();
    setAuthStatus("Signed out. Using local data.");
  } catch (error) {
    setAuthStatus(`Sign out failed: ${error.message}`);
  }
});

els.authForm?.addEventListener("submit", (e) => e.preventDefault());

els.colesSearchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = els.colesSearchQuery.value.trim();
  const limit = Number(els.colesSearchLimit.value);
  if (!query || !Number.isFinite(limit) || limit < 1) return;

  try {
    els.colesSearchStatus.textContent = "Comparing prices across stores...";
    const category = els.compareCategory?.value || "all";
    const payload = await searchCombinedProductCosts(query, limit, category);
    state.searchOffers = Array.isArray(payload.offers) ? payload.offers : [];
    state.compareSummary = payload;
    renderSearchOffers();
    renderCompareSummary();
    const catLabel = (payload.category || "all").replace("_", " ");
    els.colesSearchStatus.textContent = `Showing ${state.visibleOffers.length} of ${state.searchOffers.length} offers for "${payload.query}" in ${catLabel}.`;
  } catch (err) {
    state.searchOffers = [];
    state.visibleOffers = [];
    state.compareSummary = null;
    renderSearchOffers();
    renderCompareSummary();
    els.colesSearchStatus.textContent = `Search failed: ${err.message}`;
  }
});

function refreshOfferViewStatus() {
  if (!state.searchOffers.length) return;
  els.colesSearchStatus.textContent = `Showing ${state.visibleOffers.length} of ${state.searchOffers.length} offers.`;
}

els.compareSort?.addEventListener("change", () => {
  renderSearchOffers();
  refreshOfferViewStatus();
});

els.compareStore?.addEventListener("change", () => {
  renderSearchOffers();
  refreshOfferViewStatus();
});

els.compareCategory?.addEventListener("change", () => {
  renderSearchOffers();
  refreshOfferViewStatus();
});

els.cheapestOnly?.addEventListener("change", () => {
  renderSearchOffers();
  refreshOfferViewStatus();
});

els.colesSearchResults.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const idx = Number(btn.dataset.index);
  const offer = state.visibleOffers[idx];
  if (!offer) return;

  const name = (offer.product_name || "").trim();
  const price = Number(offer.current_price);
  const store = offer.store || "Unknown";

  if (btn.dataset.action === "add-item") {
    if (!name) return;
    addItem(name, "Groceries", 1);
    els.colesSearchStatus.textContent = `Added item: ${name}`;
    return;
  }

  if (btn.dataset.action === "add-price") {
    if (!name || !Number.isFinite(price)) return;
    const item = addItem(name, "Groceries", 1);
    setPrice(item.id, store, price, "multi-store-search");
    els.colesSearchStatus.textContent = `Saved ${name} at ${formatMoney(price)} from ${store}.`;
  }
});

els.newsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = els.newsQuery.value.trim();
  const days = Number(els.newsDays.value);
  const limit = Number(els.newsLimit.value);
  if (!Number.isFinite(days) || !Number.isFinite(limit)) return;

  try {
    els.newsStatus.textContent = "Loading price change news...";
    const payload = await fetchPriceNews(q, days, limit);
    state.newsResults = Array.isArray(payload.results) ? payload.results : [];
    renderNewsResults();

    const storeInfo = Object.entries(payload.stores || {})
      .map(([store, info]) => `${store}:${info.ok ? "OK" : "Unavailable"}`)
      .join(" | ");

    els.newsStatus.textContent = `Loaded ${payload.count} stories for last ${payload.days} day(s), ending ${payload.end_date}. ${storeInfo}`;
  } catch (err) {
    state.newsResults = [];
    renderNewsResults();
    els.newsStatus.textContent = `News fetch failed: ${err.message}`;
  }
});

els.newsResults.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='news-add-price']");
  if (!btn) return;
  const idx = Number(btn.dataset.index);
  const story = state.newsResults[idx];
  if (!story) return;

  const name = (story.product_name || "").trim();
  const newPrice = Number(story.new_price);
  const store = story.store || "Coles";
  if (!name || !Number.isFinite(newPrice)) return;

  const item = addItem(name, "Groceries", 1);
  setPrice(item.id, store, newPrice, "multi-store-news");
  els.newsStatus.textContent = `Saved ${name} at ${formatMoney(newPrice)} from ${store}.`;
});

async function getCurrentPosition() {
  if (!navigator.geolocation) throw new Error("Geolocation is not supported on this device/browser.");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    });
  });
}

els.useLocation.addEventListener("click", async () => {
  const radius = Number(els.outletsRadius.value);
  const limit = Number(els.outletsLimit.value);
  if (!Number.isFinite(radius) || !Number.isFinite(limit)) return;

  try {
    els.outletsStatus.textContent = "Getting your location...";
    const pos = await getCurrentPosition();
    els.outletsStatus.textContent = "Finding nearby outlets...";
    const payload = await fetchNearbyOutlets(pos.coords.latitude, pos.coords.longitude, radius, limit);
    state.outletsResults = Array.isArray(payload.results) ? payload.results : [];
    renderOutletsResults();
    const note = payload.strict_radius ? "" : " (showing nearest fallback)";
    els.outletsStatus.textContent = `Found ${payload.count} outlet(s) within ${payload.radius_km} km${note}.`;
  } catch (err) {
    state.outletsResults = [];
    renderOutletsResults();
    els.outletsStatus.textContent = `Outlet search failed: ${err.message}`;
  }
});

els.livePricesForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = els.liveDate.value;
  const page = Number(els.livePage.value);
  const pageSize = Number(els.livePageSize.value);
  const query = els.liveQuery.value.trim();
  if (!date || !Number.isFinite(page) || page < 1 || !Number.isFinite(pageSize) || pageSize < 1) return;

  try {
    els.liveStatus.textContent = "Fetching live prices...";
    const payload = await fetchLiveColesPrices(date, page, pageSize, query);
    state.liveResults = Array.isArray(payload.results) ? payload.results : [];
    els.liveStatus.textContent = `Fetched ${state.liveResults.length} price-change result(s).`;
    renderLiveResults();
  } catch (err) {
    state.liveResults = [];
    renderLiveResults();
    els.liveStatus.textContent = `Fetch failed: ${err.message}`;
  }
});

els.itemForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = els.itemName.value;
  const category = els.itemCategory.value;
  const quantity = Number(els.itemQuantity.value);
  if (!name.trim() || !Number.isFinite(quantity) || quantity < 1) return;

  addItem(name, category, quantity);
  els.itemForm.reset();
  els.itemQuantity.value = "1";
});

if (els.priceForm) {
  els.priceForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const itemId = els.priceItem?.value;
    const store = els.priceStore?.value;
    const price = Number(els.priceValue?.value);
    if (!itemId || !store || !Number.isFinite(price) || price < 0) return;

    setPrice(itemId, store, price, "manual");
    els.priceValue.value = "";
  });
}

els.recalculate.addEventListener("click", renderComparison);

async function bootstrap() {
  loadLocal();
  if (!els.liveDate.value) {
    els.liveDate.value = new Date().toISOString().slice(0, 10);
  }
  render();
  await initSupabase();

  setTimeout(() => {
    els.newsForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  }, 0);
}

bootstrap();
