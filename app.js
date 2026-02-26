const STORAGE_KEY = "aussie-saver-v1";

const state = {
  items: [],
  prices: [],
  searchOffers: [],
  visibleOffers: [],
  compareSummary: null,
  newsResults: [],
  outletsResults: [],
  recentSearches: [],
  priceHistory: [],
  budget: { amount: null, period: "weekly" },
  routeData: null,
  user: null,
  guestMode: false,
  cloudEnabled: false,
  cloudSyncError: null,
  lastCloudSyncAt: null
};

const els = {
  authScreen: document.getElementById("auth-screen"),
  appShell: document.getElementById("app-shell"),
  authForm: document.getElementById("auth-form"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authSignIn: document.getElementById("auth-signin"),
  authSignUp: document.getElementById("auth-signup"),
  authGuest: document.getElementById("auth-guest"),
  authSignOut: document.getElementById("auth-signout"),
  authStatus: document.getElementById("auth-status"),
  topNav: document.getElementById("top-nav"),
  colesSearchForm: document.getElementById("coles-search-form"),
  colesSearchQuery: document.getElementById("coles-search-query"),
  colesSearchLimit: document.getElementById("coles-search-limit"),
  compareSort: document.getElementById("compare-sort"),
  compareStore: document.getElementById("compare-store"),
  compareCategory: document.getElementById("compare-category"),
  cheapestOnly: document.getElementById("cheapest-only"),
  colesSearchStatus: document.getElementById("coles-search-status"),
  compareLoading: document.getElementById("compare-loading"),
  recentSearches: document.getElementById("recent-searches"),
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
  itemForm: document.getElementById("item-form"),
  itemName: document.getElementById("item-name"),
  itemCategory: document.getElementById("item-category"),
  itemQuantity: document.getElementById("item-quantity"),
  itemTargetPrice: document.getElementById("item-target-price"),
  shoppingList: document.getElementById("shopping-list"),
  budgetForm: document.getElementById("budget-form"),
  budgetAmount: document.getElementById("budget-amount"),
  budgetPeriod: document.getElementById("budget-period"),
  budgetStatus: document.getElementById("budget-status"),
  routePlan: document.getElementById("route-plan"),
  routeSummary: document.getElementById("route-summary"),
  priceHistoryInsights: document.getElementById("price-history-insights"),
  priceForm: document.getElementById("price-form"),
  priceItem: document.getElementById("price-item"),
  priceStore: document.getElementById("price-store"),
  priceValue: document.getElementById("price-value"),
  comparison: document.getElementById("comparison"),
  recalculate: document.getElementById("recalculate")
};

let supabaseClient = null;
let cloudSaveTimer = null;
let cloudRetryTimer = null;

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMoney(n) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function normalizeMatchName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(coles|woolworths|aldi|brand|original|classic|value)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUnitInfo(sizeText) {
  const s = String(sizeText || "").toLowerCase();
  if (!s) return null;

  const packMatch = s.match(/(\d+)\s*x\s*([0-9]+(?:\.[0-9]+)?)\s*(kg|g|l|ml)\b/);
  let amount;
  let unit;
  if (packMatch) {
    amount = Number(packMatch[1]) * Number(packMatch[2]);
    unit = packMatch[3];
  } else {
    const match = s.match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|g|l|ml)\b/);
    if (!match) return null;
    amount = Number(match[1]);
    unit = match[2];
  }

  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (unit === "g") return { baseQty: amount / 1000, baseUnit: "kg" };
  if (unit === "kg") return { baseQty: amount, baseUnit: "kg" };
  if (unit === "ml") return { baseQty: amount / 1000, baseUnit: "l" };
  if (unit === "l") return { baseQty: amount, baseUnit: "l" };

  return null;
}

function getOfferUnitPrice(offer) {
  const price = Number(offer.current_price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const parsed = parseUnitInfo(offer.product_size);
  if (!parsed || !Number.isFinite(parsed.baseQty) || parsed.baseQty <= 0) return null;
  return {
    unitPrice: Number((price / parsed.baseQty).toFixed(2)),
    unitLabel: parsed.baseUnit
  };
}

function addRecentSearch(query) {
  const q = String(query || "").trim();
  if (!q) return;
  state.recentSearches = [q, ...state.recentSearches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  saveLocal();
}

function findMatchingItemByName(name) {
  const target = normalizeMatchName(name);
  if (!target) return null;

  return state.items.find((item) => {
    const n = normalizeMatchName(item.name);
    return n === target || n.includes(target) || target.includes(n);
  }) || null;
}

function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.items = Array.isArray(parsed.items) ? parsed.items : [];
    state.prices = Array.isArray(parsed.prices) ? parsed.prices : [];
    state.recentSearches = Array.isArray(parsed.recentSearches) ? parsed.recentSearches : [];
    state.priceHistory = Array.isArray(parsed.priceHistory) ? parsed.priceHistory : [];
    state.budget = parsed.budget && typeof parsed.budget === "object"
      ? { amount: Number.isFinite(Number(parsed.budget.amount)) ? Number(parsed.budget.amount) : null, period: parsed.budget.period || "weekly" }
      : { amount: null, period: "weekly" };
  } catch {
    state.items = [];
    state.prices = [];
    state.recentSearches = [];
    state.priceHistory = [];
    state.budget = { amount: null, period: "weekly" };
  }
}

function saveLocal() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      items: state.items,
      prices: state.prices,
      recentSearches: state.recentSearches,
      priceHistory: state.priceHistory,
      budget: state.budget
    })
  );
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

function setShellVisibility(showApp) {
  if (els.authScreen) {
    els.authScreen.hidden = showApp;
    els.authScreen.classList.toggle("is-hidden", showApp);
  }
  if (els.appShell) {
    els.appShell.hidden = !showApp;
    els.appShell.classList.toggle("is-hidden", !showApp);
  }
}

function switchPanel(panelId) {
  document.querySelectorAll(".app-panel").forEach((panel) => {
    panel.hidden = panel.id !== panelId;
  });

  if (els.topNav) {
    els.topNav.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.panel === panelId);
    });
  }
}

function getRouteMode() {
  return window.location.hash === "#/app" ? "app" : "login";
}

function setRouteMode(mode) {
  const nextHash = mode === "app" ? "#/app" : "#/login";
  if (window.location.hash !== nextHash) {
    history.replaceState(null, "", nextHash);
  }
}

function updateAuthUI() {
  const signedIn = Boolean(state.user);
  const inApp = signedIn || state.guestMode;

  if (els.authSignOut) els.authSignOut.style.display = signedIn ? "inline-block" : "none";

  if (!inApp) {
    setRouteMode("login");
    setShellVisibility(false);
    setAuthStatus(state.cloudEnabled ? "Sign in to sync your data." : "Supabase not configured. Use guest mode.");
    return;
  }

  setRouteMode("app");
  setShellVisibility(true);

  if (state.guestMode && !signedIn) {
    setAuthStatus("Guest mode: data will stay only on this device.");
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
  state.guestMode = false;
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
    state.guestMode = false;
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
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
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
      if (cloudRetryTimer) {
        clearTimeout(cloudRetryTimer);
        cloudRetryTimer = null;
      }
    } catch (error) {
      state.cloudSyncError = error.message || "Cloud sync failed";
      updateAuthUI();
      console.error("Cloud sync failed", error);
      scheduleCloudRetry();
    }
  }, 500);
}

function scheduleCloudRetry() {
  if (!state.user || !supabaseClient || cloudRetryTimer) return;
  cloudRetryTimer = setTimeout(async () => {
    cloudRetryTimer = null;
    try {
      await saveCloudData();
      updateAuthUI();
    } catch (error) {
      state.cloudSyncError = error.message || "Cloud sync retry failed";
      updateAuthUI();
      scheduleCloudRetry();
    }
  }, 5000);
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

function addItem(name, category, quantity, targetPrice = null) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;

  const existing = state.items.find((x) => x.name.toLowerCase() === cleanName.toLowerCase()) || findMatchingItemByName(cleanName);
  if (existing) {
    if (Number.isFinite(Number(targetPrice))) {
      existing.targetPrice = Number(targetPrice);
      save();
      render();
    }
    return existing;
  }

  const item = {
    id: uid(),
    name: cleanName,
    category: String(category || "").trim() || "General",
    quantity,
    done: false,
    targetPrice: Number.isFinite(Number(targetPrice)) ? Number(targetPrice) : null
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

  const item = state.items.find((x) => x.id === itemId);
  if (item) {
    state.priceHistory.push({
      id: uid(),
      itemId,
      itemName: item.name,
      store,
      price,
      at: new Date().toISOString()
    });
    state.priceHistory = state.priceHistory.slice(-1200);
  }

  save();
  render();
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
    const targetTag = Number.isFinite(Number(item.targetPrice)) ? ` | target ${formatMoney(Number(item.targetPrice))}` : "";
    label.textContent = `${item.name} (${item.category}) x${item.quantity}${targetTag}`;

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
    const itemPrices = state.prices
      .filter((p) => p.itemId === item.id && Number.isFinite(Number(p.price)))
      .sort((a, b) => Number(a.price) - Number(b.price));

    if (itemPrices.length === 0) {
      rows.push({ type: "missing", item, options: [] });
      continue;
    }

    const cheapest = itemPrices[0];
    mixedTotal += Number(cheapest.price) * item.quantity;
    rows.push({ type: "best", item, ...cheapest, options: itemPrices });
  }

  const stores = [...new Set(state.prices.map((x) => x.store))];
  for (const store of stores) {
    let total = 0;
    let complete = true;
    for (const item of activeItems) {
      const p = state.prices.find((x) => x.itemId === item.id && x.store === store);
      if (!p || !Number.isFinite(Number(p.price))) {
        complete = false;
        break;
      }
      total += Number(p.price) * item.quantity;
    }
    if (complete) storeTotals[store] = Number(total.toFixed(2));
  }

  return { rows, mixedTotal: Number(mixedTotal.toFixed(2)), storeTotals, activeCount: activeItems.length };
}

function renderComparison() {
  els.comparison.innerHTML = "";
  const { rows, mixedTotal, storeTotals, activeCount } = calculateCheapestPlan();

  if (activeCount === 0) {
    els.comparison.innerHTML = "<div class='row'>All done. Your shopping list is complete.</div>";
    return;
  }

  const entries = Object.entries(storeTotals).sort((a, b) => a[1] - b[1]);
  const bestSingleStore = entries[0] || null;
  const pricedCount = rows.filter((row) => row.type === "best").length;
  const missingRows = rows.filter((row) => row.type === "missing");
  const savingsVsSingle =
    bestSingleStore && Number.isFinite(bestSingleStore[1]) ? Number((bestSingleStore[1] - mixedTotal).toFixed(2)) : null;

  const analyticsHtml = [
    `<div class='analytics-card'><span>Total Items</span><strong>${activeCount}</strong></div>`,
    `<div class='analytics-card'><span>Priced Items</span><strong>${pricedCount}</strong></div>`,
    `<div class='analytics-card'><span>Missing Prices</span><strong>${missingRows.length}</strong></div>`,
    `<div class='analytics-card'><span>Mixed Total</span><strong>${formatMoney(mixedTotal)}</strong></div>`,
    `<div class='analytics-card'><span>Best Single Store</span><strong>${bestSingleStore ? `${bestSingleStore[0]} ${formatMoney(bestSingleStore[1])}` : "N/A"}</strong></div>`,
    `<div class='analytics-card'><span>Save vs Single Store</span><strong>${Number.isFinite(savingsVsSingle) ? formatMoney(Math.max(savingsVsSingle, 0)) : "N/A"}</strong></div>`
  ].join("");

  els.comparison.innerHTML += `<div class='analytics-grid'>${analyticsHtml}</div>`;

  const storeGroups = new Map();
  for (const row of rows) {
    if (row.type !== "best") continue;
    if (!storeGroups.has(row.store)) {
      storeGroups.set(row.store, { items: [], total: 0 });
    }

    const lineTotal = row.price * row.item.quantity;
    const group = storeGroups.get(row.store);
    group.items.push({
      name: row.item.name,
      quantity: row.item.quantity,
      lineTotal,
      price: row.price
    });
    group.total += lineTotal;
  }

  const storeOrder = ["Aldi", "Coles", "Woolworths", "Big W", "Kmart"];
  const sortedStores = [...storeGroups.keys()].sort((a, b) => {
    const ai = storeOrder.indexOf(a);
    const bi = storeOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  if (sortedStores.length === 0) {
    els.comparison.innerHTML += "<div class='row'>No priced items yet. Add prices from search to build store trips.</div>";
  } else {
    for (const store of sortedStores) {
      const group = storeGroups.get(store);
      const itemRows = group.items
        .map(
          (item) =>
            `<li>${escapeHtml(item.name)} x${item.quantity} <span>${formatMoney(item.price)} each</span> <strong>${formatMoney(item.lineTotal)}</strong></li>`
        )
        .join("");

      els.comparison.innerHTML += `<div class='store-trip'>
        <div class='store-trip-head'>
          <h4>${escapeHtml(store)} Trip</h4>
          <span>${group.items.length} item(s)</span>
          <strong>${formatMoney(group.total)}</strong>
        </div>
        <ul>${itemRows}</ul>
      </div>`;
    }
  }

  if (missingRows.length > 0) {
    const missingList = missingRows.map((row) => `<li>${escapeHtml(row.item.name)} x${row.item.quantity}</li>`).join("");
    els.comparison.innerHTML += `<div class='row'><strong>Need prices:</strong><ul class='missing-list'>${missingList}</ul></div>`;
  }

  const swapRows = rows
    .filter((row) => row.type === "best" && Array.isArray(row.options) && row.options.length > 1)
    .map((row) => {
      const second = row.options[1];
      const save = Number(second.price) - Number(row.price);
      if (!Number.isFinite(save) || save <= 0) return "";
      return `<li>${escapeHtml(row.item.name)}: choose <strong>${escapeHtml(row.store)}</strong> over ${escapeHtml(second.store)} and save ${formatMoney(save * row.item.quantity)}</li>`;
    })
    .filter(Boolean)
    .slice(0, 6)
    .join("");

  if (swapRows) {
    els.comparison.innerHTML += `<div class='row'><strong>Swap to cheaper alternatives:</strong><ul class='missing-list'>${swapRows}</ul></div>`;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch('/api/outlets/nearby?' + params.toString(), { signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') throw new Error('Outlet search timed out. Please try again.');
    throw error;
  }
  clearTimeout(timer);
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || 'Outlet search failed');
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

function renderRecentSearches() {
  if (!els.recentSearches) return;
  if (!state.recentSearches.length) {
    els.recentSearches.innerHTML = "";
    return;
  }

  const chips = state.recentSearches
    .map((q) => `<button type='button' class='chip-btn' data-search='${escapeHtml(q)}'>${escapeHtml(q)}</button>`)
    .join("");
  els.recentSearches.innerHTML = `<div class='chip-row'>${chips}</div>`;
}

function renderBudgetStatus() {
  if (!els.budgetStatus) return;
  const amount = Number(state.budget?.amount);
  const period = state.budget?.period || "weekly";
  const { mixedTotal } = calculateCheapestPlan();

  if (!Number.isFinite(amount) || amount <= 0) {
    els.budgetStatus.textContent = "Set a budget to track overspend alerts.";
    return;
  }

  const diff = Number((amount - mixedTotal).toFixed(2));
  if (diff >= 0) {
    els.budgetStatus.textContent = `Within ${period} budget. Remaining: ${formatMoney(diff)}.`;
  } else {
    els.budgetStatus.textContent = `Over ${period} budget by ${formatMoney(Math.abs(diff))}. Use swap hints below.`;
  }
}

function renderPriceHistoryInsights() {
  if (!els.priceHistoryInsights) return;
  const activeItems = state.items.filter((x) => !x.done);
  if (activeItems.length === 0) {
    els.priceHistoryInsights.innerHTML = "<div class='row'>No active items for history insights.</div>";
    return;
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const rows = activeItems
    .map((item) => {
      const history = state.priceHistory.filter((h) => h.itemId === item.id);
      if (!history.length) return `<div class='row'>${escapeHtml(item.name)}: no history yet.</div>`;

      const latest = history[history.length - 1];
      const prices = history.map((h) => Number(h.price)).filter((p) => Number.isFinite(p));
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const d7 = history.filter((h) => now - new Date(h.at).getTime() <= 7 * dayMs).length;
      const d30 = history.filter((h) => now - new Date(h.at).getTime() <= 30 * dayMs).length;
      const d90 = history.filter((h) => now - new Date(h.at).getTime() <= 90 * dayMs).length;

      const sorted = [...history].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const graphPoints = sorted.slice(-12).map((h) => Number(h.price)).filter((p) => Number.isFinite(p));
      const maxPoint = graphPoints.length ? Math.max(...graphPoints) : 0;
      const minPoint = graphPoints.length ? Math.min(...graphPoints) : 0;
      const range = Math.max(maxPoint - minPoint, 0.01);
      const bars = graphPoints
        .map((p) => {
          const h = 24 + ((p - minPoint) / range) * 56;
          return `<span style="height:${h.toFixed(0)}%"></span>`;
        })
        .join("");

      const target = Number(item.targetPrice);
      const targetHit = Number.isFinite(target) && Number(latest.price) <= target;
      const targetText = Number.isFinite(target)
        ? targetHit
          ? ` | target reached (${formatMoney(target)})`
          : ` | target ${formatMoney(target)}`
        : "";

      const avgByStore = history.reduce((acc, row) => {
        const key = String(row.store || "Unknown");
        if (!acc[key]) acc[key] = [];
        acc[key].push(Number(row.price));
        return acc;
      }, {});

      const bestStore = Object.entries(avgByStore)
        .map(([store, values]) => ({
          store,
          avg: values.reduce((sum, v) => sum + v, 0) / values.length
        }))
        .sort((a, b) => a.avg - b.avg)[0];

      const avgByDay = history.reduce((acc, row) => {
        const day = new Date(row.at).toLocaleDateString("en-AU", { weekday: "short" });
        if (!acc[day]) acc[day] = [];
        acc[day].push(Number(row.price));
        return acc;
      }, {});

      const bestDay = Object.entries(avgByDay)
        .map(([day, values]) => ({
          day,
          avg: values.reduce((sum, v) => sum + v, 0) / values.length
        }))
        .sort((a, b) => a.avg - b.avg)[0];

      const hint = [bestStore ? `Best store: ${bestStore.store}` : null, bestDay ? `Best day: ${bestDay.day}` : null]
        .filter(Boolean)
        .join(" | ");

      return `<div class='row'>
        <strong>${escapeHtml(item.name)}</strong><br/>
        Latest: ${formatMoney(Number(latest.price))} at ${escapeHtml(latest.store)} | Min: ${formatMoney(min)} | Max: ${formatMoney(max)}${targetText}<br/>
        Samples: 7d ${d7} | 30d ${d30} | 90d ${d90}<br/>
        ${hint ? `<span class='history-hint'>${escapeHtml(hint)}</span>` : ""}
        ${bars ? `<div class='sparkline' aria-label='Recent trend'>${bars}</div>` : ""}
      </div>`;
    })
    .join("");

  els.priceHistoryInsights.innerHTML = rows;
}

function buildStoreTripGroups() {
  const { rows } = calculateCheapestPlan();
  const byStore = new Map();
  for (const row of rows) {
    if (row.type !== "best") continue;
    if (!byStore.has(row.store)) byStore.set(row.store, []);
    byStore.get(row.store).push(row);
  }
  return byStore;
}

function markStoreTripBought(store) {
  const groups = buildStoreTripGroups();
  const rows = groups.get(store) || [];
  const itemIds = new Set(rows.map((r) => r.item.id));
  state.items.forEach((item) => {
    if (itemIds.has(item.id)) item.done = true;
  });
  save();
  render();
}

async function planRouteForTrips() {
  if (!navigator.geolocation) throw new Error('Geolocation not supported.');
  const byStore = buildStoreTripGroups();
  if (byStore.size === 0) {
    state.routeData = [];
    renderRouteSummary();
    return;
  }

  const pos = await new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  );

  const payload = await fetchNearbyOutlets(pos.coords.latitude, pos.coords.longitude, Number(els.outletsRadius?.value || 8), 30);

  const routeRows = [];
  for (const [store, items] of byStore.entries()) {
    const nearest = (payload.results || []).find((x) => String(x.store).toLowerCase() === store.toLowerCase());
    const maps = nearest
      ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(nearest.latitude + ',' + nearest.longitude)
      : null;

    routeRows.push({
      store,
      count: items.length,
      nearest,
      maps
    });
  }

  state.routeData = routeRows;
  renderRouteSummary();
}

function renderRouteSummary() {
  if (!els.routeSummary) return;
  if (!Array.isArray(state.routeData) || state.routeData.length === 0) {
    els.routeSummary.innerHTML = "<div class='row'>No store route yet. Add prices to items, then tap Auto Route by Store.</div>";
    return;
  }

  const rows = state.routeData
    .map((r) => {
      const where = r.nearest ? `${escapeHtml(r.nearest.name)} (${Number(r.nearest.distance_km).toFixed(1)} km)` : "No outlet found";
      const mapLink = r.maps ? `<a href='${r.maps}' target='_blank' rel='noreferrer'>Open Map</a>` : "";
      return `<div class='row'><strong>${escapeHtml(r.store)}:</strong> ${r.count} item(s) | ${where} ${mapLink} <button data-action='mark-store-bought' data-store='${escapeHtml(r.store)}'>Mark All Bought</button></div>`;
    })
    .join("");

  els.routeSummary.innerHTML = `<h4>Trip Route Summary</h4>${rows}`;
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

  let list = [...state.searchOffers].map((o) => {
    const unitInfo = getOfferUnitPrice(o);
    return {
      ...o,
      unit_price: unitInfo ? unitInfo.unitPrice : null,
      unit_label: unitInfo ? unitInfo.unitLabel : null
    };
  });
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
    if (sortBy === "unit_price_asc") {
      const ua = Number.isFinite(Number(a.unit_price)) ? Number(a.unit_price) : Number.POSITIVE_INFINITY;
      const ub = Number.isFinite(Number(b.unit_price)) ? Number(b.unit_price) : Number.POSITIVE_INFINITY;
      return ua - ub;
    }
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
      const unitTxt = Number.isFinite(Number(item.unit_price)) ? `${formatMoney(Number(item.unit_price))} / ${item.unit_label}` : "N/A";
      const link = item.url ? `<a href='${item.url}' target='_blank' rel='noreferrer'>Open</a>` : "No link";
      return `<tr>
        <td>${item.product_name || "Unknown"}</td>
        <td>${item.product_brand || "Unknown"}</td>
        <td>${item.store || "Unknown"}</td>
        <td>${item.category || "other"}</td>
        <td>${item.product_size || "N/A"}</td>
        <td>${priceTxt}</td>
        <td>${unitTxt}</td>
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
        <th>Unit Price</th>
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

function render() {
  renderItems();
  renderPriceItemOptions();
  renderComparison();
  renderBudgetStatus();
  renderPriceHistoryInsights();
  renderRouteSummary();
  renderSearchOffers();
  renderRecentSearches();
  renderCompareSummary();
  renderNewsResults();
  renderOutletsResults();
  if (els.budgetAmount) els.budgetAmount.value = Number.isFinite(Number(state.budget?.amount)) ? String(state.budget.amount) : "";
  if (els.budgetPeriod) els.budgetPeriod.value = state.budget?.period || "weekly";
  updateAuthUI();
}

els.authSignIn?.addEventListener("click", async () => {
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) return;
  try {
    setAuthStatus("Signing in...");
    const data = await signIn(email, password);
    if (data?.user) {
      state.user = data.user;
      state.guestMode = false;
      setRouteMode("app");
      updateAuthUI();
      render();
      window.scrollTo({ top: 0, behavior: "instant" });
    }
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
    if (supabaseClient && state.user) {
      await signOut();
    }
    state.user = null;
    state.guestMode = false;
    setRouteMode("login");
    updateAuthUI();
  } catch (error) {
    setAuthStatus(`Sign out failed: ${error.message}`);
  }
});

els.authGuest?.addEventListener("click", () => {
  state.guestMode = true;
  updateAuthUI();
});

els.topNav?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-panel]");
  if (!btn) return;
  switchPanel(btn.dataset.panel);
});

window.addEventListener("hashchange", () => {
  const mode = getRouteMode();
  if (mode === "app" && (state.user || state.guestMode)) {
    setShellVisibility(true);
    render();
  } else if (mode === "login") {
    setShellVisibility(false);
  }
});

els.authForm?.addEventListener("submit", (e) => e.preventDefault());

els.colesSearchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = els.colesSearchQuery.value.trim();
  const limit = Number(els.colesSearchLimit.value);
  if (!query || !Number.isFinite(limit) || limit < 1) return;

  try {
    if (els.compareLoading) els.compareLoading.hidden = false;
    els.colesSearchStatus.textContent = "Comparing prices across stores...";
    const category = els.compareCategory?.value || "all";
    const payload = await searchCombinedProductCosts(query, limit, category);
    state.searchOffers = Array.isArray(payload.offers) ? payload.offers : [];
    state.compareSummary = payload;
    addRecentSearch(payload.query || query);
    renderSearchOffers();
    renderRecentSearches();
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
  } finally {
    if (els.compareLoading) els.compareLoading.hidden = true;
  }
});

function refreshOfferViewStatus() {
  if (!state.searchOffers.length) return;
  els.colesSearchStatus.textContent = `Showing ${state.visibleOffers.length} of ${state.searchOffers.length} offers.`;
}

els.recentSearches?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-search]");
  if (!btn) return;
  const q = String(btn.dataset.search || "").trim();
  if (!q) return;
  els.colesSearchQuery.value = q;
  els.colesSearchForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
});

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


els.itemForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = els.itemName.value;
  const category = els.itemCategory.value;
  const quantity = Number(els.itemQuantity.value);
  const targetPrice = Number(els.itemTargetPrice?.value);
  if (!name.trim() || !Number.isFinite(quantity) || quantity < 1) return;

  addItem(name, category, quantity, Number.isFinite(targetPrice) ? targetPrice : null);
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

els.budgetForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = Number(els.budgetAmount?.value);
  const period = String(els.budgetPeriod?.value || "weekly");
  state.budget = {
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    period: period === "monthly" ? "monthly" : "weekly"
  };
  save();
  renderBudgetStatus();
});

els.routePlan?.addEventListener("click", async () => {
  try {
    if (els.routeSummary) els.routeSummary.innerHTML = "<div class='row'>Building route using your location...</div>";
    await planRouteForTrips();
  } catch (error) {
    if (els.routeSummary) els.routeSummary.innerHTML = `<div class='row'>Route planning failed: ${escapeHtml(error.message)}</div>`;
  }
});

els.routeSummary?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='mark-store-bought']");
  if (!btn) return;
  const store = String(btn.dataset.store || "");
  if (!store) return;
  markStoreTripBought(store);
});

window.addEventListener("online", () => {
  if (state.user && supabaseClient) scheduleCloudSave();
});

async function bootstrap() {
  loadLocal();
  if (!window.location.hash) {
    setRouteMode("login");
  }

  const routeMode = getRouteMode();
  setShellVisibility(routeMode === "app");

  render();
  switchPanel("panel-compare");
  await initSupabase();

  setTimeout(() => {
    els.newsForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  }, 0);
}

bootstrap();
