(() => {
  "use strict";

  const sessionKey = "yubin-hiki-session-v1";
  const savedKey = "yubin-hiki-saved-v1";
  const seenKey = "yubin-hiki-seen-v1";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const isQa =
    new URLSearchParams(location.search).get("qa") === "1" || location.hostname === "localhost";

  const readJson = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  const existingSession = localStorage.getItem(sessionKey) ?? "";
  const session = uuidPattern.test(existingSession) ? existingSession : crypto.randomUUID();
  localStorage.setItem(sessionKey, session);

  const apiHeaders = () => ({
    "Content-Type": "application/json",
    "X-Yubin-QA": isQa ? "1" : "0",
    "X-Yubin-Session": session,
  });

  const emit = (name) => {
    fetch("/api/telemetry", {
      body: JSON.stringify({ name }),
      headers: apiHeaders(),
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  };

  const previousVisit = Number(localStorage.getItem(seenKey) ?? 0);
  emit("visited");
  if (previousVisit && Date.now() - previousVisit > 8 * 60 * 60 * 1000) emit("returned");
  localStorage.setItem(seenKey, String(Date.now()));

  const formatPostal = (value) => {
    const digits = String(value).replace(/\D/gu, "").slice(0, 7);
    return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
  };

  const clipboardWrite = async (value, button, eventName) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    const original = button.textContent;
    button.textContent = "コピーしました";
    button.classList.add("is-done");
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove("is-done");
    }, 1400);
    emit(eventName);
  };

  const normalizedSaved = () => {
    const stored = readJson(savedKey, []);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          /^\d{7}$/u.test(String(item.postal)) &&
          typeof item.address === "string" &&
          typeof item.kana === "string",
      )
      .slice(0, 60);
  };

  let saved = normalizedSaved();
  const saveItems = () => localStorage.setItem(savedKey, JSON.stringify(saved.slice(0, 60)));

  const buildButton = (label, className, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (className) button.className = className;
    button.addEventListener("click", action);
    return button;
  };

  const savedStack = document.querySelector("#saved-stack");
  const savedCount = document.querySelector("#saved-count");
  const clearSaved = document.querySelector("#clear-saved");

  const renderSaved = () => {
    if (!savedStack || !savedCount || !clearSaved) return;
    savedStack.replaceChildren();
    savedCount.textContent = String(saved.length);
    clearSaved.hidden = saved.length === 0;
    if (!saved.length) {
      const empty = document.createElement("p");
      empty.className = "empty-tray";
      empty.textContent = "必要な宛先を、この端末だけに留めておけます。";
      savedStack.append(empty);
      return;
    }
    saved.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "saved-card";
      const code = document.createElement("a");
      code.href = `/zip/${item.postal}`;
      code.textContent = `〒${formatPostal(item.postal)}`;
      const address = document.createElement("p");
      address.textContent = item.address;
      const remove = buildButton("外す", "remove-saved", () => {
        saved.splice(index, 1);
        saveItems();
        renderSaved();
        updateSaveButtons();
      });
      card.append(code, address, remove);
      savedStack.append(card);
    });
  };

  const saveAddress = (item) => {
    const existing = saved.findIndex(
      (savedItem) => savedItem.postal === item.postal && savedItem.address === item.address,
    );
    if (existing >= 0) {
      saved.splice(existing, 1);
    } else {
      saved.unshift(item);
      saved = saved.slice(0, 60);
      emit("saved");
    }
    saveItems();
    renderSaved();
    updateSaveButtons();
  };

  const updateSaveButtons = () => {
    document.querySelectorAll("[data-save-address]").forEach((button) => {
      const postal = button.dataset.postal ?? "";
      const address = button.dataset.address ?? "";
      const active = saved.some((item) => item.postal === postal && item.address === address);
      button.textContent = active ? "控え済み" : "宛先控えへ";
      button.classList.toggle("is-saved", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };

  clearSaved?.addEventListener("click", () => {
    saved = [];
    saveItems();
    renderSaved();
    updateSaveButtons();
  });
  renderSaved();

  const wireAddressButtons = (root = document) => {
    root.querySelectorAll("[data-copy-postal]").forEach((button) => {
      if (button.dataset.ready) return;
      button.dataset.ready = "1";
      button.addEventListener("click", () =>
        clipboardWrite(button.dataset.copyPostal ?? "", button, "postal_copied"),
      );
    });
    root.querySelectorAll("[data-copy-address]").forEach((button) => {
      if (button.dataset.ready) return;
      button.dataset.ready = "1";
      button.addEventListener("click", () =>
        clipboardWrite(button.dataset.copyAddress ?? "", button, "address_copied"),
      );
    });
    root.querySelectorAll("[data-save-address]").forEach((button) => {
      if (button.dataset.ready) return;
      button.dataset.ready = "1";
      button.addEventListener("click", () =>
        saveAddress({
          address: button.dataset.address ?? "",
          kana: button.dataset.kana ?? "",
          postal: button.dataset.postal ?? "",
        }),
      );
    });
    updateSaveButtons();
  };

  wireAddressButtons();
  if (document.querySelector("[data-open-postal]")) emit("postal_opened");

  const form = document.querySelector("#search-form");
  const query = document.querySelector("#query");
  const prefecture = document.querySelector("#prefecture");
  const results = document.querySelector("#results");
  const status = document.querySelector("#search-status");
  const count = document.querySelector("#result-count");

  const updatePostalBoxes = () => {
    if (!query) return;
    const digits = query.value.normalize("NFKC").replace(/\D/gu, "").slice(0, 7);
    document.querySelectorAll(".envelope [data-slot]").forEach((slot) => {
      slot.textContent = digits[Number(slot.dataset.slot)] ?? "";
    });
  };
  query?.addEventListener("input", updatePostalBoxes);

  const addResultActions = (card, item) => {
    const actions = document.createElement("div");
    actions.className = "result-actions";
    const detail = document.createElement("a");
    detail.href = `/zip/${item.postal_code}`;
    detail.textContent = "宛名票を開く";
    const copyCode = buildButton("番号をコピー", "", (event) =>
      clipboardWrite(`〒${formatPostal(item.postal_code)}`, event.currentTarget, "postal_copied"),
    );
    const copyAddress = buildButton("住所をコピー", "", (event) =>
      clipboardWrite(item.address, event.currentTarget, "address_copied"),
    );
    const save = buildButton("宛先控えへ", "", () =>
      saveAddress({ address: item.address, kana: item.kana_address, postal: item.postal_code }),
    );
    save.dataset.saveAddress = "";
    save.dataset.postal = item.postal_code;
    save.dataset.address = item.address;
    save.dataset.kana = item.kana_address;
    save.dataset.ready = "1";
    actions.append(detail, copyCode, copyAddress, save);
    card.append(actions);
  };

  const resultCard = (item) => {
    const card = document.createElement("article");
    card.className = "address-card";
    const heading = document.createElement("div");
    heading.className = "card-postal";
    const mark = document.createElement("span");
    mark.textContent = "〒";
    const code = document.createElement("strong");
    code.textContent = formatPostal(item.postal_code);
    heading.append(mark, code);
    const kana = document.createElement("p");
    kana.className = "card-kana";
    kana.textContent = item.kana_address;
    const address = document.createElement("h3");
    address.textContent = item.address;
    const fold = document.createElement("span");
    fold.className = "card-fold";
    fold.setAttribute("aria-hidden", "true");
    card.append(heading, kana, address, fold);
    addResultActions(card, item);
    return card;
  };

  const renderResults = (payload) => {
    results.replaceChildren();
    if (!payload.results.length) {
      const empty = document.createElement("div");
      empty.className = "no-result";
      const symbol = document.createElement("span");
      symbol.textContent = "〒";
      const title = document.createElement("h3");
      title.textContent = "一致する宛名票がありません";
      const note = document.createElement("p");
      note.textContent = "番地や建物名を外す、都道府県を変える、カナで探す方法も試せます。";
      empty.append(symbol, title, note);
      results.append(empty);
      count.textContent = "0件";
      return;
    }
    payload.results.forEach((item) => results.append(resultCard(item)));
    count.textContent = `${payload.results.length.toLocaleString("ja-JP")}件${payload.hasMore ? "（先頭30件）" : ""}`;
    updateSaveButtons();
  };

  const search = async () => {
    const value = query.value.trim();
    if (!value) {
      status.textContent = "郵便番号か住所を入力してください";
      query.focus();
      return;
    }
    status.textContent = "宛名票を探しています…";
    form.classList.add("is-loading");
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const response = await fetch("/api/search", {
        body: JSON.stringify({ prefecture: prefecture.value, q: value }),
        headers: apiHeaders(),
        method: "POST",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.error === "query_too_short") {
          status.textContent = "住所は2文字以上、郵便番号は2桁以上で入力してください";
          return;
        }
        throw new Error("search_failed");
      }
      const payload = await response.json();
      renderResults(payload);
      status.textContent = payload.results.length
        ? `${payload.results.length}件の宛名票を表示しました`
        : "一致する宛名票はありませんでした";
      results.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      status.textContent = "検索できませんでした。少し待って、もう一度お試しください";
    } finally {
      form.classList.remove("is-loading");
      form.querySelector('button[type="submit"]').disabled = false;
    }
  };

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void search();
  });

  document.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      query.value = button.dataset.example ?? "";
      updatePostalBoxes();
      void search();
    });
  });
})();
