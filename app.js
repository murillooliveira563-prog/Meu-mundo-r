"use strict";

(() => {
  const DB_NAME = "meu-mundo-r";
  const DB_VERSION = 1;
  const STORES = ["tasks", "cycles", "notes", "preferences"];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const dialog = $("#appDialog");
  const dialogForm = $("#dialogForm");
  const fields = $("#dialogFields");
  const actions = $("#dialogActions");
  const formMessage = $("#dialogMessage");
  const supabaseConfig = window.MEU_MUNDO_R_SUPABASE_CONFIG || {};
  const pushUi = { busy: false, active: false };
  let supabaseClient = null;
  const state = {
    db: null,
    tasks: [],
    cycles: [],
    notes: [],
    preferences: { theme: "light", favoriteColor: "lilas" },
    activeView: "hoje",
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: dateKey(new Date()),
    returnFocus: null,
    toastTimer: 0
  };

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function fromDateKey(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function formatDate(value, options = { day: "numeric", month: "long" }) {
    return fromDateKey(value).toLocaleDateString("pt-BR", options);
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Este navegador não oferece suporte ao armazenamento local necessário."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("tasks")) {
          const store = db.createObjectStore("tasks", { keyPath: "id" });
          store.createIndex("date", "date");
        }
        if (!db.objectStoreNames.contains("cycles")) db.createObjectStore("cycles", { keyPath: "id" });
        if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("preferences")) db.createObjectStore("preferences", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento local."));
      request.onblocked = () => reject(new Error("Feche outras abas deste aplicativo e tente novamente."));
    });
  }

  function transact(storeName, mode, operation) {
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = state.db.transaction(storeName, mode);
        const result = operation(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve(result && "result" in result ? result.result : result);
        transaction.onerror = () => reject(transaction.error || new Error("Não foi possível salvar os dados."));
        transaction.onabort = () => reject(transaction.error || new Error("A operação foi cancelada."));
      } catch (error) {
        reject(error);
      }
    });
  }

  function readAll(storeName) {
    return transact(storeName, "readonly", store => store.getAll());
  }

  async function loadData() {
    const [tasks, cycles, notes, preferences] = await Promise.all(STORES.map(readAll));
    state.tasks = tasks;
    state.cycles = cycles;
    state.notes = notes;
    state.preferences = { theme: "light", favoriteColor: "lilas" };
    preferences.forEach(item => { state.preferences[item.key] = item.value; });
  }

  async function saveRecord(storeName, record) {
    await transact(storeName, "readwrite", store => store.put(record));
  }

  async function removeRecord(storeName, id) {
    await transact(storeName, "readwrite", store => store.delete(id));
  }

  function reportStorageError(error) {
    console.error("Erro no armazenamento local:", error);
    const main = $("#mainContent");
    main.innerHTML = "";
    const panel = document.createElement("section");
    panel.className = "storage-error";
    const heading = document.createElement("h2");
    heading.textContent = "Não foi possível abrir seu espaço";
    const message = document.createElement("p");
    message.textContent = `${error.message || "O armazenamento local não está disponível."} Seus registros não foram enviados a nenhum servidor. Tente abrir o app em um navegador atualizado usando um servidor local, como o Live Server.`;
    const retry = document.createElement("button");
    retry.className = "button primary";
    retry.type = "button";
    retry.textContent = "Tentar novamente";
    retry.addEventListener("click", () => window.location.reload());
    panel.append(heading, message, retry);
    main.append(panel);
  }

  function applyTheme() {
    const dark = state.preferences.theme === "dark";
    const accents = ["lilas", "rosa", "azul", "verde"];
    const favoriteColor = accents.includes(state.preferences.favoriteColor) ? state.preferences.favoriteColor : "lilas";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.accent = favoriteColor;
    $("#themeToggle").checked = dark;
    $("#themeLabel").textContent = dark ? "Tema escuro" : "Tema claro";
    $$('input[name="accentColor"]').forEach(input => { input.checked = input.value === favoriteColor; });
    document.querySelector('meta[name="theme-color"]').content = dark ? "#211e27" : "#f8f6fb";
  }

  async function changeTheme(dark) {
    state.preferences.theme = dark ? "dark" : "light";
    applyTheme();
    try {
      await saveRecord("preferences", { key: "theme", value: state.preferences.theme });
      showToast("Preferência de tema salva neste navegador.");
    } catch (error) {
      showToast(`Não foi possível salvar a preferência: ${error.message}`);
    }
  }

  async function changeFavoriteColor(color) {
    if (!["lilas", "rosa", "azul", "verde"].includes(color)) return;
    state.preferences.favoriteColor = color;
    applyTheme();
    try {
      await saveRecord("preferences", { key: "favoriteColor", value: color });
    } catch (error) {
      showToast(`Não foi possível salvar a cor favorita: ${error.message}`);
    }
  }

  function decodeBase64Url(value) {
    const standard = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = window.atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  function isPushConfigReady() {
    if (!supabaseConfig.url || !supabaseConfig.publishableKey || !supabaseConfig.pushFunction || !supabaseConfig.vapidPublicKey) return false;
    try {
      const url = new URL(supabaseConfig.url);
      const publicKey = decodeBase64Url(supabaseConfig.vapidPublicKey);
      return url.protocol === "https:" && supabaseConfig.publishableKey.startsWith("sb_publishable_") && publicKey.length === 65 && publicKey[0] === 4;
    } catch {
      return false;
    }
  }

  function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("A biblioteca local do Supabase não foi carregada.");
    }
    supabaseClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
    });
    return supabaseClient;
  }

  function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isInstalledIOSApp() {
    return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  }

  function iosInstallGuidance() {
    return isIOSDevice() && !isInstalledIOSApp()
      ? "No iPhone, adicione este app à Tela de Início pelo Safari e abra pelo ícone instalado para ativar Web Push."
      : "";
  }

  function setNotificationState(status, message) {
    const statusLabels = {
      unconfigured: "Notificações não configuradas",
      disabled: "Notificações desativadas",
      enabled: "✓ Notificações ativadas neste dispositivo",
      blocked: "Notificações bloqueadas"
    };
    const statusElement = $("#notificationStatus");
    const enableButton = $("#enableNotifications");
    const testButton = $("#sendTestNotification");
    statusElement.dataset.state = status;
    statusElement.textContent = statusLabels[status];
    const iosGuidance = iosInstallGuidance();
    $("#notificationHelp").textContent = [message, iosGuidance].filter(Boolean).join(" ");
    enableButton.hidden = status === "enabled";
    enableButton.textContent = pushUi.busy ? "Ativando…" : "Ativar notificações";
    enableButton.disabled = pushUi.busy || !isPushConfigReady() || status === "enabled" || status === "blocked";
    testButton.hidden = status !== "enabled";
    testButton.disabled = pushUi.busy || status !== "enabled";
  }

  function assertPushSupport() {
    if (!window.isSecureContext) throw new Error("Notificações exigem uma conexão HTTPS segura.");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("Este navegador não oferece suporte a notificações Web Push.");
    }
    if (!isPushConfigReady()) {
      throw new Error("Notificações não configuradas: faltam a URL/chave pública do Supabase ou a chave pública VAPID.");
    }
  }

  async function getOrCreateAnonymousSession(client) {
    const { data: current, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (current.session) return current.session;
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    if (!data.session || !data.user?.is_anonymous) {
      throw new Error("O Supabase não retornou uma sessão anônima válida.");
    }
    return data.session;
  }

  async function getPushBackendStatus(client) {
    const { data, error } = await client.functions.invoke(supabaseConfig.pushFunction, { body: { action: "status" } });
    if (error) throw error;
    if (!data || data.configured !== true) throw new Error("O backend ainda não tem as chaves VAPID e a tabela configuradas.");
    return data;
  }

  async function getPushFunctionErrorDiagnostic(error) {
    const response = error && error.context;
    if (!response || typeof response.clone !== "function" || !Number.isInteger(response.status)) return null;
    const diagnostic = { httpStatus: response.status };
    try {
      const body = await response.clone().json();
      if (typeof body?.error === "string" && /^[a-z0-9_]{1,64}$/.test(body.error)) {
        diagnostic.responseError = body.error;
      }
    } catch {
      diagnostic.responseError = "non_json_response";
    }
    return diagnostic;
  }

  async function refreshNotificationStatus() {
    pushUi.active = false;
    if (!isPushConfigReady()) {
      setNotificationState("unconfigured", "Configure a chave pública VAPID e publique a migração e a Edge Function.");
      return;
    }
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setNotificationState("unconfigured", "Este navegador ou endereço não oferece suporte a Web Push.");
      return;
    }
    if (Notification.permission === "denied") {
      setNotificationState("blocked", "A permissão foi negada. Altere-a nas configurações de notificações do navegador ou do iPhone.");
      return;
    }
    if (Notification.permission !== "granted") {
      setNotificationState("disabled", "Ative para criar uma sessão anônima e salvar a inscrição neste dispositivo.");
      return;
    }
    if (!navigator.onLine) {
      setNotificationState("unconfigured", "Sem internet: não foi possível confirmar se a inscrição está salva no Supabase.");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (!subscription) {
        setNotificationState("disabled", "Este dispositivo ainda não tem uma inscrição Web Push.");
        return;
      }
      const client = getSupabaseClient();
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        setNotificationState("disabled", "A inscrição local não está associada a uma sessão. Ative novamente para configurá-la.");
        return;
      }
      const { data: saved, error: savedError } = await client
        .from("push_subscriptions")
        .select("endpoint,vapid_public_key")
        .eq("endpoint", subscription.endpoint)
        .maybeSingle();
      if (savedError) throw savedError;
      const backendStatus = await getPushBackendStatus(client);
      if (!backendStatus.subscriptionSaved || !saved || saved.vapid_public_key !== supabaseConfig.vapidPublicKey) {
        setNotificationState("disabled", "A inscrição não está salva com a configuração VAPID atual. Ative novamente para concluir.");
        return;
      }
      pushUi.active = true;
      setNotificationState("enabled", "A inscrição deste dispositivo foi confirmada no Supabase.");
    } catch (error) {
      const diagnostic = await getPushFunctionErrorDiagnostic(error);
      console.error("Não foi possível verificar as notificações:", diagnostic || { errorName: error?.name || "Error" });
      setNotificationState("unconfigured", diagnostic
        ? "Não foi possível confirmar a configuração do serviço de notificações. Tente novamente em alguns instantes."
        : "Não foi possível confirmar a configuração das notificações. Verifique sua conexão e tente novamente.");
    }
  }

  async function enableNotifications() {
    if (pushUi.busy) return;
    if (!isPushConfigReady()) {
      setNotificationState("unconfigured", "Configure a chave pública VAPID no arquivo supabase-config.js antes de ativar.");
      return;
    }
    if (!navigator.onLine) {
      setNotificationState("disabled", "Conecte-se à internet para ativar notificações. As funções locais continuam disponíveis.");
      return;
    }
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setNotificationState("unconfigured", "Este navegador ou endereço não oferece suporte a Web Push.");
      return;
    }
    if (isIOSDevice() && !isInstalledIOSApp()) {
      setNotificationState("disabled", "No iPhone, adicione este app à Tela de Início pelo Safari e abra pelo ícone instalado.");
      return;
    }
    if (Notification.permission === "denied") {
      setNotificationState("blocked", "A permissão foi negada. Altere-a nas configurações de notificações do navegador ou do iPhone.");
      return;
    }

    const permissionRequest = Notification.permission === "granted"
      ? Promise.resolve("granted")
      : Notification.requestPermission();
    pushUi.busy = true;
    setNotificationState("disabled", "Aguardando a permissão e configurando este dispositivo…");
    try {
      const permission = await permissionRequest;
      if (permission !== "granted") {
        if (permission === "denied") {
          setNotificationState("blocked", "A permissão foi negada. Altere-a nas configurações de notificações do navegador ou do iPhone.");
        } else {
          setNotificationState("disabled", "A permissão não foi concedida. Você pode tentar novamente quando quiser.");
        }
        return;
      }
      if (!navigator.onLine) throw new Error("Sem internet. Conecte-se e tente ativar novamente.");

      const client = getSupabaseClient();
      const session = await getOrCreateAnonymousSession(client);
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = decodeBase64Url(supabaseConfig.vapidPublicKey);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const existingKey = subscription.options.applicationServerKey;
        const matches = existingKey && existingKey.byteLength === applicationServerKey.byteLength
          && applicationServerKey.every((byte, index) => byte === new Uint8Array(existingKey)[index]);
        if (!matches) {
          const { error: deleteError } = await client.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
          if (deleteError) throw deleteError;
          await subscription.unsubscribe();
          subscription = null;
        }
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
      }
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
        throw new Error("O navegador não retornou uma inscrição Web Push completa.");
      }
      const { error: saveError } = await client.from("push_subscriptions").upsert({
        user_id: session.user.id,
        endpoint: serialized.endpoint,
        p256dh: serialized.keys.p256dh,
        auth_key: serialized.keys.auth,
        vapid_public_key: supabaseConfig.vapidPublicKey
      }, { onConflict: "user_id,endpoint" });
      if (saveError) throw saveError;

      const { data: saved, error: verifyError } = await client
        .from("push_subscriptions")
        .select("endpoint,vapid_public_key")
        .eq("endpoint", serialized.endpoint)
        .maybeSingle();
      if (verifyError) throw verifyError;
      const backendStatus = await getPushBackendStatus(client);
      if (!saved || saved.vapid_public_key !== supabaseConfig.vapidPublicKey || backendStatus.subscriptionSaved !== true) {
        throw new Error("O servidor não confirmou a configuração completa da inscrição.");
      }
      pushUi.active = true;
      setNotificationState("enabled", "Inscrição salva e confirmada. Você já pode enviar uma notificação de teste.");
    } catch (error) {
      const diagnostic = await getPushFunctionErrorDiagnostic(error);
      console.error("Não foi possível ativar as notificações:", diagnostic || { errorName: error?.name || "Error" });
      const message = !navigator.onLine
        ? "Sem internet. Conecte-se e tente ativar novamente."
        : /anonymous/i.test(error.message || "")
          ? "Ative os logins anônimos em Authentication > Sign In / Providers no Supabase."
          : diagnostic
            ? "Não foi possível concluir a configuração das notificações agora. Tente novamente em alguns instantes."
            : "Não foi possível concluir a configuração das notificações. Verifique sua conexão e tente novamente.";
      setNotificationState("unconfigured", message);
    } finally {
      pushUi.busy = false;
      if (pushUi.active) setNotificationState("enabled", "Inscrição salva e confirmada. Você já pode enviar uma notificação de teste.");
      else {
        const status = $("#notificationStatus").dataset.state;
        const enableButton = $("#enableNotifications");
        enableButton.hidden = status === "enabled";
        enableButton.textContent = "Ativar notificações";
        enableButton.disabled = !isPushConfigReady() || status === "blocked";
      }
    }
  }

  async function sendTestNotification() {
    if (!pushUi.active) return;
    if (!navigator.onLine) {
      $("#notificationHelp").textContent = "Sem internet. Conecte-se para enviar a notificação de teste.";
      return;
    }
    pushUi.busy = true;
    $("#sendTestNotification").disabled = true;
    $("#notificationHelp").textContent = "Enviando o aviso de teste ao serviço Web Push…";
    try {
      const client = getSupabaseClient();
      const { data, error } = await client.functions.invoke(supabaseConfig.pushFunction, { body: { action: "test" } });
      if (error) throw error;
      if (!data || data.accepted < 1) throw new Error("O serviço não aceitou a notificação de teste.");
      $("#notificationHelp").textContent = "O serviço Web Push aceitou o aviso. A entrega ao dispositivo pode levar alguns instantes.";
    } catch (error) {
      const diagnostic = await getPushFunctionErrorDiagnostic(error);
      console.error("Não foi possível enviar a notificação de teste:", diagnostic || { errorName: error?.name || "Error" });
      $("#notificationHelp").textContent = diagnostic
        ? "Não foi possível enviar o teste agora. Tente novamente em alguns instantes."
        : "Não foi possível enviar o teste. Verifique sua conexão e tente novamente.";
    } finally {
      pushUi.busy = false;
      $("#sendTestNotification").disabled = !pushUi.active;
    }
  }

  function updateGreeting() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    $("#pageTitle").textContent = `${greeting}, Raíssa`;
    $("#todayDate").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  }

  function sortedTasks(tasks) {
    return [...tasks].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, "pt-BR"));
  }

  function emptyState(title, message, buttonText, onClick) {
    const container = document.createElement("div");
    container.className = "empty-state";
    const flower = document.createElement("span");
    flower.className = "empty-flower";
    flower.setAttribute("aria-hidden", "true");
    flower.textContent = "✿";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = message;
    container.append(flower, heading, copy);
    if (buttonText) {
      const button = document.createElement("button");
      button.className = "text-button";
      button.type = "button";
      button.textContent = buttonText;
      button.addEventListener("click", onClick);
      container.append(button);
    }
    return container;
  }

  function taskCard(task) {
    const card = document.createElement("article");
    card.className = `item-card${task.completed ? " is-complete" : ""}`;
    const toggle = document.createElement("button");
    toggle.className = "complete-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", String(Boolean(task.completed)));
    toggle.setAttribute("aria-label", task.completed ? `Marcar ${task.title} como não concluída` : `Marcar ${task.title} como concluída`);
    toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6"/></svg>';
    toggle.addEventListener("click", () => toggleTask(task));
    const main = document.createElement("div");
    main.className = "item-main";
    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent = task.title;
    if (task.priority === "importante") {
      const priority = document.createElement("span");
      priority.className = "priority-mark";
      priority.textContent = "  ✦ importante";
      title.append(priority);
    }
    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = `${formatDate(task.date)} · ${task.time} · ${task.category}`;
    main.append(title, meta);
    if (task.note) {
      const note = document.createElement("p");
      note.className = "item-note";
      note.textContent = task.note;
      main.append(note);
    }
    const controls = document.createElement("div");
    controls.className = "item-actions";
    controls.append(
      makeAction("↗", `Adiar ${task.title} para amanhã`, () => postponeTask(task)),
      makeAction("✎", `Editar ${task.title}`, () => openTaskForm(task)),
      makeAction("×", `Excluir ${task.title}`, () => confirmDelete("tasks", task.id, "Excluir este item?", renderAll))
    );
    card.append(toggle, main, controls);
    return card;
  }

  function makeAction(text, label, handler) {
    const button = document.createElement("button");
    button.className = "small-action";
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.textContent = text;
    button.addEventListener("click", handler);
    return button;
  }

  function appendTasks(target, tasks, emptyTitle, emptyMessage, emptyAction = null) {
    target.replaceChildren();
    if (!tasks.length) {
      target.append(emptyState(emptyTitle, emptyMessage, emptyAction ? emptyAction.label : "", emptyAction ? emptyAction.handler : undefined));
      return;
    }
    sortedTasks(tasks).forEach(task => target.append(taskCard(task)));
  }

  function renderToday() {
    const today = dateKey(new Date());
    const todaysTasks = state.tasks.filter(task => task.date === today);
    const upcoming = sortedTasks(state.tasks.filter(task => task.date > today && !task.completed).slice(0, 50)).slice(0, 5);
    appendTasks($("#todayItems"), todaysTasks, "Seu dia começa leve", "Ainda não há tarefas ou lembretes para hoje. Quando quiser, você pode adicionar algo.", { label: "Adicionar tarefa ou lembrete", handler: () => openTaskForm({ date: today }) });
    const upcomingTarget = $("#upcomingItems");
    if (upcoming.length) {
      upcomingTarget.replaceChildren();
      upcoming.forEach(task => upcomingTarget.append(taskCard(task)));
    } else {
      upcomingTarget.replaceChildren(emptyState("Nada marcado por enquanto", "Quando houver algo chegando, você vai encontrar aqui.", "", null));
    }
  }

  function renderCalendar() {
    const month = state.calendarMonth;
    $("#monthLabel").textContent = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
    const grid = $("#calendarGrid");
    grid.replaceChildren();
    const today = dateKey(new Date());
    const taskDays = new Set(state.tasks.map(task => task.date));
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const key = dateKey(date);
      const button = document.createElement("button");
      button.className = "calendar-day";
      button.type = "button";
      button.textContent = String(date.getDate());
      button.setAttribute("aria-label", `${date.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${taskDays.has(key) ? ", há itens" : ""}`);
      if (date.getMonth() !== month.getMonth()) button.classList.add("is-outside");
      if (key === today) button.classList.add("is-today");
      if (key === state.selectedDate) button.classList.add("is-selected");
      if (taskDays.has(key)) button.classList.add("has-items");
      button.setAttribute("aria-pressed", String(key === state.selectedDate));
      button.addEventListener("click", () => {
        state.selectedDate = key;
        if (date.getMonth() !== state.calendarMonth.getMonth()) state.calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        renderCalendar();
        renderSelectedDay();
      });
      grid.append(button);
    }
    renderSelectedDay();
  }

  function renderSelectedDay() {
    const selected = fromDateKey(state.selectedDate);
    $("#selectedDayTitle").textContent = selected.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    appendTasks($("#calendarItems"), state.tasks.filter(task => task.date === state.selectedDate), "Dia livre", "Nenhuma tarefa ou compromisso nesta data.", {
      label: "Adicionar para este dia",
      handler: () => openTaskForm({ date: state.selectedDate })
    });
  }

  function renderCycles() {
    const target = $("#cycleItems");
    target.replaceChildren();
    const cycles = [...state.cycles].sort((a, b) => b.startDate.localeCompare(a.startDate));
    if (!cycles.length) {
      target.append(emptyState("Seu primeiro registro fica aqui", "Anote as datas e, se quiser, como se sentiu. O registro é manual e não gera previsões.", "Criar registro", openCycleForm));
      return;
    }
    cycles.forEach(cycle => {
      const card = document.createElement("article");
      card.className = "record-card";
      const header = document.createElement("div");
      header.className = "record-heading";
      const text = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = `Início: ${formatDate(cycle.startDate, { day: "numeric", month: "long", year: "numeric" })}`;
      const dates = document.createElement("p");
      dates.className = "record-date";
      dates.textContent = `Fim: ${formatDate(cycle.endDate, { day: "numeric", month: "long", year: "numeric" })}`;
      text.append(heading, dates);
      const controls = document.createElement("div");
      controls.className = "item-actions";
      controls.append(
        makeAction("✎", "Editar registro do ciclo", () => openCycleForm(cycle)),
        makeAction("×", "Excluir registro do ciclo", () => confirmDelete("cycles", cycle.id, "Excluir este registro do ciclo?", renderAll))
      );
      header.append(text, controls);
      card.append(header);
      if (cycle.symptoms || cycle.notes) {
        const details = document.createElement("div");
        details.className = "record-details";
        if (cycle.symptoms) details.append(detailLine("Sintomas", cycle.symptoms));
        if (cycle.notes) details.append(detailLine("Observações", cycle.notes));
        card.append(details);
      }
      target.append(card);
    });
  }

  function detailLine(label, value) {
    const line = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    line.append(strong, document.createTextNode(value));
    return line;
  }

  function renderNotes() {
    const target = $("#noteItems");
    target.replaceChildren();
    const notes = [...state.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!notes.length) {
      target.append(emptyState("Uma página em branco, só sua", "Guarde aqui uma ideia, um plano ou uma frase para lembrar depois.", "Criar anotação", openNoteForm));
      return;
    }
    notes.forEach(note => {
      const card = document.createElement("article");
      card.className = "note-card";
      card.dataset.color = note.color;
      const title = document.createElement("h3");
      title.textContent = note.title;
      const body = document.createElement("p");
      body.textContent = note.body;
      const date = document.createElement("p");
      date.className = "note-date";
      date.textContent = `Atualizada em ${new Date(note.updatedAt).toLocaleDateString("pt-BR")}`;
      const controls = document.createElement("div");
      controls.className = "item-actions";
      controls.append(
        makeAction("✎", `Editar anotação ${note.title}`, () => openNoteForm(note)),
        makeAction("×", `Excluir anotação ${note.title}`, () => confirmDelete("notes", note.id, "Excluir esta anotação?", renderAll))
      );
      card.append(title, body, date, controls);
      target.append(card);
    });
  }

  function renderAll() {
    updateGreeting();
    renderToday();
    renderCalendar();
    renderCycles();
    renderNotes();
    applyTheme();
  }

  async function toggleTask(task) {
    const updated = { ...task, completed: !task.completed };
    try {
      await saveRecord("tasks", updated);
      state.tasks = state.tasks.map(item => item.id === task.id ? updated : item);
      renderAll();
      showToast(updated.completed ? "Tarefa marcada como concluída." : "Tarefa reaberta.");
    } catch (error) {
      showToast(`Não foi possível atualizar: ${error.message}`);
    }
  }

  async function postponeTask(task) {
    const next = fromDateKey(task.date);
    next.setDate(next.getDate() + 1);
    const updated = { ...task, date: dateKey(next) };
    try {
      await saveRecord("tasks", updated);
      state.tasks = state.tasks.map(item => item.id === task.id ? updated : item);
      renderAll();
      showToast("Item adiado para amanhã.");
    } catch (error) {
      showToast(`Não foi possível adiar: ${error.message}`);
    }
  }

  function setView(view) {
    state.activeView = view;
    $$(".view").forEach(section => {
      const active = section.id === `view-${view}`;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });
    $$(".nav-item").forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("#mainContent").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function field(id, label, type, value = "", options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const labelElement = document.createElement("label");
    labelElement.htmlFor = id;
    labelElement.textContent = label;
    let input;
    if (type === "textarea") {
      input = document.createElement("textarea");
      input.value = value;
      if (options.rows) input.rows = options.rows;
    } else if (type === "select") {
      input = document.createElement("select");
      options.choices.forEach(([optionValue, optionLabel]) => {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionLabel;
        input.append(option);
      });
      input.value = value;
    } else {
      input = document.createElement("input");
      input.type = type;
      input.value = value;
      if (options.min) input.min = options.min;
      if (options.max) input.max = options.max;
      if (options.required) input.required = true;
      if (options.maxlength) input.maxLength = options.maxlength;
    }
    input.id = id;
    input.name = id;
    if (options.required) input.setAttribute("aria-required", "true");
    wrap.append(labelElement, input);
    if (options.hint) {
      const hint = document.createElement("p");
      hint.className = "field-hint";
      hint.textContent = options.hint;
      wrap.append(hint);
    }
    return wrap;
  }

  function fieldRow(first, second) {
    const row = document.createElement("div");
    row.className = "field-row";
    row.append(first, second);
    return row;
  }

  function addDialogButton(label, kind, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button${kind ? ` ${kind}` : ""}`;
    button.textContent = label;
    button.addEventListener("click", handler);
    actions.append(button);
    return button;
  }

  function showFormDialog(title, eyebrow, focusId) {
    $("#dialogTitle").textContent = title;
    $("#dialogEyebrow").textContent = eyebrow;
    formMessage.hidden = true;
    formMessage.textContent = "";
    fields.replaceChildren();
    actions.replaceChildren();
    dialogForm.onsubmit = null;
    if (!dialog.open) {
      state.returnFocus = document.activeElement;
      dialog.showModal();
    }
    requestAnimationFrame(() => {
      const input = focusId ? $(`#${focusId}`) : null;
      (input || $(".dialog-close")).focus();
    });
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    if (state.returnFocus && state.returnFocus.isConnected) state.returnFocus.focus({ preventScroll: true });
    else $("#mainContent").focus({ preventScroll: true });
  }

  function showFormError(message, focusId) {
    formMessage.textContent = message;
    formMessage.hidden = false;
    if (focusId) $(`#${focusId}`)?.focus();
  }

  function openTaskForm(existing = {}) {
    const isEditing = Boolean(existing.id);
    const defaultDate = existing.date || state.selectedDate || dateKey(new Date());
    showFormDialog(isEditing ? "Editar tarefa ou lembrete" : "Novo item", "ORGANIZE SEU DIA", "taskTitle");
    fields.append(
      field("taskTitle", "Título *", "text", existing.title || "", { required: true, maxlength: 120 }),
      field("taskNote", "Observação", "textarea", existing.note || "", { maxlength: 1000 }),
      fieldRow(
        field("taskDate", "Data *", "date", defaultDate, { required: true }),
        field("taskTime", "Horário *", "time", existing.time || "09:00", { required: true })
      ),
      fieldRow(
        field("taskCategory", "Categoria", "select", existing.category || "Pessoal", { choices: [["Pessoal", "Pessoal"], ["Trabalho", "Trabalho"], ["Estudos", "Estudos"], ["Outros", "Outros"]] }),
        field("taskPriority", "Prioridade", "select", existing.priority || "normal", { choices: [["normal", "Normal"], ["importante", "Importante"]] })
      ),
      field("taskReminder", "Preferência de aviso", "select", existing.reminder || "na-hora", { choices: [["na-hora", "Na hora"], ["uma-hora", "Uma hora antes"], ["um-dia", "Um dia antes"]] })
    );
    const notice = document.createElement("div");
    notice.className = "notice-box";
    notice.textContent = "A preferência fica salva junto ao item, mas notificações automáticas ainda não estão ativadas.";
    fields.append(notice);
    addDialogButton("Cancelar", "", closeDialog);
    addDialogButton(isEditing ? "Salvar alterações" : "Salvar item", "primary", () => dialogForm.requestSubmit());
    dialogForm.onsubmit = async event => {
      event.preventDefault();
      const title = $("#taskTitle").value.trim();
      const date = $("#taskDate").value;
      const time = $("#taskTime").value;
      if (!title) return showFormError("Escreva um título para continuar.", "taskTitle");
      if (!date || !time) return showFormError("Escolha uma data e um horário.", !date ? "taskDate" : "taskTime");
      const record = {
        id: existing.id || makeId(),
        title,
        note: $("#taskNote").value.trim(),
        date,
        time,
        category: $("#taskCategory").value,
        priority: $("#taskPriority").value,
        reminder: $("#taskReminder").value,
        completed: Boolean(existing.completed),
        createdAt: existing.createdAt || new Date().toISOString()
      };
      try {
        await saveRecord("tasks", record);
        state.tasks = state.tasks.filter(task => task.id !== record.id).concat(record);
        closeDialog();
        renderAll();
        showToast(isEditing ? "Item atualizado." : "Item salvo neste navegador.");
      } catch (error) {
        showFormError(`Não foi possível salvar o item: ${error.message}`);
      }
    };
  }

  function openCycleForm(existing = {}) {
    const isEditing = Boolean(existing.id);
    showFormDialog(isEditing ? "Editar registro" : "Novo registro do ciclo", "MEU CICLO", "cycleStart");
    fields.append(
      fieldRow(
        field("cycleStart", "Data de início *", "date", existing.startDate || dateKey(new Date()), { required: true }),
        field("cycleEnd", "Data de fim *", "date", existing.endDate || dateKey(new Date()), { required: true })
      ),
      field("cycleSymptoms", "Sintomas (opcional)", "textarea", existing.symptoms || "", { maxlength: 1000 }),
      field("cycleNotes", "Observações (opcional)", "textarea", existing.notes || "", { maxlength: 1500 }),
      makeNotice("Registro manual, sem previsões de ciclo ou fertilidade.")
    );
    addDialogButton("Cancelar", "", closeDialog);
    addDialogButton(isEditing ? "Salvar alterações" : "Salvar registro", "primary", () => dialogForm.requestSubmit());
    dialogForm.onsubmit = async event => {
      event.preventDefault();
      const startDate = $("#cycleStart").value;
      const endDate = $("#cycleEnd").value;
      if (!startDate || !endDate) return showFormError("Informe as datas de início e fim.", !startDate ? "cycleStart" : "cycleEnd");
      if (endDate < startDate) return showFormError("A data de fim deve ser igual ou posterior à data de início.", "cycleEnd");
      const record = { id: existing.id || makeId(), startDate, endDate, symptoms: $("#cycleSymptoms").value.trim(), notes: $("#cycleNotes").value.trim(), createdAt: existing.createdAt || new Date().toISOString() };
      try {
        await saveRecord("cycles", record);
        state.cycles = state.cycles.filter(cycle => cycle.id !== record.id).concat(record);
        closeDialog();
        renderCycles();
        showToast(isEditing ? "Registro atualizado." : "Registro salvo neste navegador.");
      } catch (error) {
        showFormError(`Não foi possível salvar o registro: ${error.message}`);
      }
    };
  }

  function makeNotice(text) {
    const notice = document.createElement("div");
    notice.className = "notice-box";
    notice.textContent = text;
    return notice;
  }

  function openNoteForm(existing = {}) {
    const isEditing = Boolean(existing.id);
    showFormDialog(isEditing ? "Editar anotação" : "Nova anotação", "MEU ESPAÇO", "noteTitle");
    fields.append(
      field("noteTitle", "Título *", "text", existing.title || "", { required: true, maxlength: 100 }),
      field("noteBody", "Sua anotação", "textarea", existing.body || "", { maxlength: 3000 }),
      colorField(existing.color || "lilás")
    );
    addDialogButton("Cancelar", "", closeDialog);
    addDialogButton(isEditing ? "Salvar alterações" : "Salvar anotação", "primary", () => dialogForm.requestSubmit());
    dialogForm.onsubmit = async event => {
      event.preventDefault();
      const title = $("#noteTitle").value.trim();
      if (!title) return showFormError("Escreva um título para sua anotação.", "noteTitle");
      const record = { id: existing.id || makeId(), title, body: $("#noteBody").value.trim(), color: $("input[name='noteColor']:checked").value, createdAt: existing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      try {
        await saveRecord("notes", record);
        state.notes = state.notes.filter(note => note.id !== record.id).concat(record);
        closeDialog();
        renderNotes();
        showToast(isEditing ? "Anotação atualizada." : "Anotação salva neste navegador.");
      } catch (error) {
        showFormError(`Não foi possível salvar a anotação: ${error.message}`);
      }
    };
  }

  function colorField(selected) {
    const wrap = document.createElement("fieldset");
    wrap.className = "field";
    wrap.style.border = "0";
    wrap.style.padding = "0";
    wrap.style.margin = "0";
    const legend = document.createElement("legend");
    legend.className = "field-label";
    legend.textContent = "Cor de destaque";
    const choices = document.createElement("div");
    choices.className = "color-options";
    ["lilás", "rosa", "azul", "verde"].forEach(color => {
      const label = document.createElement("label");
      label.className = "color-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "noteColor";
      input.value = color;
      input.checked = color === selected;
      const dot = document.createElement("span");
      dot.className = `color-dot ${color}`;
      dot.setAttribute("aria-hidden", "true");
      label.append(input, dot, document.createTextNode(color[0].toUpperCase() + color.slice(1)));
      choices.append(label);
    });
    wrap.append(legend, choices);
    return wrap;
  }

  function confirmDelete(storeName, id, message, onDeleted) {
    showFormDialog("Tem certeza?", "CONFIRMAÇÃO", null);
    const copy = document.createElement("p");
    copy.className = "confirm-copy";
    copy.textContent = `${message} Essa ação não pode ser desfeita.`;
    fields.append(copy);
    addDialogButton("Manter", "", closeDialog);
    addDialogButton("Excluir", "danger", async () => {
      try {
        await removeRecord(storeName, id);
        if (storeName === "tasks") state.tasks = state.tasks.filter(item => item.id !== id);
        if (storeName === "cycles") state.cycles = state.cycles.filter(item => item.id !== id);
        if (storeName === "notes") state.notes = state.notes.filter(item => item.id !== id);
        closeDialog();
        onDeleted();
        showToast("Registro excluído.");
      } catch (error) {
        showFormError(`Não foi possível excluir: ${error.message}`);
      }
    });
  }

  function showToast(message) {
    $(".toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.append(toast);
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.remove(), 3200);
  }

  function bindEvents() {
    $$(".nav-item").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
    $("#todayShortcut").addEventListener("click", () => setView("hoje"));
    $$("[data-go]").forEach(button => button.addEventListener("click", () => setView(button.dataset.go)));
    $$("[data-add-today]").forEach(button => button.addEventListener("click", () => openTaskForm({ date: dateKey(new Date()) })));
    $("#quickAdd").addEventListener("click", () => {
      openTaskForm({ date: state.activeView === "agenda" ? state.selectedDate : dateKey(new Date()) });
    });
    $("#previousMonth").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
      state.selectedDate = dateKey(state.calendarMonth);
      renderCalendar();
    });
    $("#nextMonth").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
      state.selectedDate = dateKey(state.calendarMonth);
      renderCalendar();
    });
    $("#addCalendarItem").addEventListener("click", () => openTaskForm({ date: state.selectedDate }));
    $("#addCycle").addEventListener("click", () => openCycleForm());
    $("#addNote").addEventListener("click", () => openNoteForm());
    $("#themeToggle").addEventListener("change", event => changeTheme(event.target.checked));
    $$('input[name="accentColor"]').forEach(input => input.addEventListener("change", () => changeFavoriteColor(input.value)));
    $("#enableNotifications").addEventListener("click", enableNotifications);
    $("#sendTestNotification").addEventListener("click", sendTestNotification);
    window.addEventListener("online", refreshNotificationStatus);
    $$("[data-close-dialog]").forEach(button => button.addEventListener("click", closeDialog));
    dialog.addEventListener("click", event => {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
    });
    dialog.addEventListener("close", () => {
      if (state.returnFocus && state.returnFocus.isConnected) state.returnFocus.focus({ preventScroll: true });
    });
  }

  async function init() {
    bindEvents();
    try {
      state.db = await openDatabase();
      await loadData();
      renderAll();
      if ("serviceWorker" in navigator && window.isSecureContext) {
        navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then(() => refreshNotificationStatus()).catch(error => {
          console.error("Não foi possível preparar o uso offline:", error);
          setNotificationState("unconfigured", "Não foi possível preparar o service worker necessário para notificações.");
        });
      } else {
        setNotificationState("unconfigured", "Notificações exigem HTTPS e suporte a service workers.");
      }
    } catch (error) {
      reportStorageError(error);
    }
  }

  init();
})();
