// --- CONSTANTES ---
const PX_PER_HOUR = 60;
const START_HOUR = 6;
const END_HOUR = 24;
const DAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

let appData = JSON.parse(localStorage.getItem("studyPlannerV5")) || {
  name: "Alexandre",
  avatar: "",
  theme: "dark", // NOVO: Armazena o Tema Escuro ou Rosa
  baseSchedule: Array(7)
    .fill(null)
    .map(() => []),
  todayBlocks: [],
  history: [],
  lastDate: "",
  pauseState: { isPaused: false, startTime: null, blockId: null },
};

let currentDayIdx = new Date().getDay();
let editingBlockRef = null;
let isCreatingNew = false;

function closeApp() {
  window.close();
}

function showCustomConfirm(title, message, isDanger = true) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-confirm");
    document.getElementById("confirm-title").innerText = title;
    document.getElementById("confirm-message").innerText = message;

    const btnYes = document.getElementById("btn-confirm-yes");
    const btnNo = document.getElementById("btn-confirm-no");

    btnYes.className = isDanger ? "btn-danger" : "btn-primary";

    const cleanup = () => {
      btnYes.removeEventListener("click", onYes);
      btnNo.removeEventListener("click", onNo);
      modal.style.display = "none";
    };

    const onYes = () => {
      cleanup();
      resolve(true);
    };
    const onNo = () => {
      cleanup();
      resolve(false);
    };

    btnYes.addEventListener("click", onYes);
    btnNo.addEventListener("click", onNo);

    modal.style.display = "flex";
  });
}

function checkNewDay() {
  const todayStr = new Date().toDateString();
  const todayIdx = new Date().getDay();
  if (appData.lastDate !== todayStr) {
    appData.todayBlocks = JSON.parse(
      JSON.stringify(appData.baseSchedule[todayIdx]),
    );
    appData.todayBlocks.forEach((b) => (b.status = "pending"));
    appData.lastDate = todayStr;
    appData.pauseState = { isPaused: false, startTime: null, blockId: null };
    saveData();
  }
}

function cascadeBlocks(blocksArray) {
  blocksArray.sort((a, b) => a.start - b.start);
  for (let i = 1; i < blocksArray.length; i++) {
    const prev = blocksArray[i - 1];
    const curr = blocksArray[i];
    const prevEnd = prev.start + prev.duration;
    if (curr.status !== "completed" && curr.status !== "missed") {
      if (curr.start < prevEnd) curr.start = prevEnd;
    }
  }
}

function logHistory(block, status) {
  appData.history.push({
    date: new Date().toLocaleDateString("pt-BR"),
    name: block.name,
    duration: block.duration,
    type: block.type,
    status: status,
  });
  saveData();
}

function startActivity() {
  const nowDec =
    new Date().getHours() +
    new Date().getMinutes() / 60 +
    new Date().getSeconds() / 3600;
  let block = appData.todayBlocks.find(
    (b) => b.status === "pending" && nowDec >= b.start,
  );
  if (block) {
    const delay = nowDec - block.start;
    if (delay > 0) {
      block.start = nowDec;
      cascadeBlocks(appData.todayBlocks);
    }
    block.status = "running";
    saveData();
    updateTimer();
  }
}

async function skipActivity() {
  const nowDec =
    new Date().getHours() +
    new Date().getMinutes() / 60 +
    new Date().getSeconds() / 3600;
  let block = appData.todayBlocks.find(
    (b) => b.status === "pending" && nowDec >= b.start,
  );
  if (block) {
    const confirmed = await showCustomConfirm(
      "Pular Tarefa",
      `Tem certeza que deseja pular "${block.name}"? Ela será registrada como FALTA no seu relatório.`,
    );
    if (confirmed) {
      block.status = "missed";
      if (block.type === "study") logHistory(block, "missed");
      saveData();
      updateTimer();
    }
  }
}

async function endActivityEarly() {
  const confirmed = await showCustomConfirm(
    "Encerrar Mais Cedo",
    "Deseja encerrar essa atividade agora? O tempo estudado até aqui será salvo.",
  );
  if (!confirmed) return;

  let active = appData.pauseState.isPaused
    ? appData.todayBlocks.find((b) => b.id === appData.pauseState.blockId)
    : appData.todayBlocks.find((b) => b.status === "running");

  if (active) {
    let endTimeDec;
    if (appData.pauseState.isPaused) {
      const pauseStart = new Date(appData.pauseState.startTime);
      endTimeDec =
        pauseStart.getHours() +
        pauseStart.getMinutes() / 60 +
        pauseStart.getSeconds() / 3600;
      appData.pauseState = { isPaused: false, startTime: null, blockId: null };
    } else {
      const now = new Date();
      endTimeDec =
        now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    }

    const actualDuration = endTimeDec - active.start;
    active.duration = actualDuration > 0 ? actualDuration : 0.01;
    active.status = "completed";
    if (active.type === "study") logHistory(active, "completed");
    saveData();
    updateTimer();
  }
}

function togglePause() {
  if (appData.pauseState.isPaused) {
    const elapsedHours = (Date.now() - appData.pauseState.startTime) / 3600000;
    const block = appData.todayBlocks.find(
      (b) => b.id === appData.pauseState.blockId,
    );
    if (block) {
      block.duration += elapsedHours;
      cascadeBlocks(appData.todayBlocks);
    }
    appData.pauseState = { isPaused: false, startTime: null, blockId: null };
    saveData();
  } else {
    const active = appData.todayBlocks.find((b) => b.status === "running");
    if (active && active.type === "study") {
      appData.pauseState.isPaused = true;
      appData.pauseState.startTime = Date.now();
      appData.pauseState.blockId = active.id;
      saveData();
    }
  }
  updateTimer();
}

function updateTimer() {
  checkNewDay();
  const now = new Date();
  const nowDec =
    now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;

  appData.todayBlocks.forEach((b) => {
    if (b.status === "pending" && nowDec >= b.start + b.duration) {
      b.status = "missed";
      if (b.type === "study") logHistory(b, "missed");
      saveData();
    }
  });

  appData.todayBlocks.forEach((b) => {
    if (b.status === "running" && !appData.pauseState.isPaused) {
      if (nowDec >= b.start + b.duration) {
        b.status = "completed";
        if (b.type === "study") logHistory(b, "completed");
        saveData();
      }
    }
  });

  let active = null;
  let isWaitingStart = false;
  let isCurrentlyPaused = false;

  if (appData.pauseState.isPaused) {
    active = appData.todayBlocks.find(
      (b) => b.id === appData.pauseState.blockId,
    );
    isCurrentlyPaused = true;
  }

  if (!active) active = appData.todayBlocks.find((b) => b.status === "running");

  if (!active) {
    active = appData.todayBlocks.find(
      (b) => b.status === "pending" && nowDec >= b.start,
    );
    if (active) isWaitingStart = true;
  }

  const elLabel = document.getElementById("status-label");
  const elName = document.getElementById("current-activity");
  const elTimer = document.getElementById("timer");
  const elEndTime = document.getElementById("end-time-display");
  const elBar = document.getElementById("progress-bar");
  const startArea = document.getElementById("start-action-area");
  const pauseArea = document.getElementById("pause-action-area");
  const delayWarn = document.getElementById("delay-warning");

  // LÓGICA DO TEMPO LIVRE ATUALIZADA (CONTAGEM REGRESSIVA)
  if (!active) {
    elLabel.innerText = "AGORA";
    elName.innerText = "Tempo Livre";
    elName.style.color = "var(--text-muted)";
    elBar.style.width = "0%";
    elBar.style.boxShadow = "none";
    startArea.style.display = "none";
    pauseArea.style.display = "none";

    // Procura a PRÓXIMA atividade do dia que ainda vai acontecer
    const nextBlock = appData.todayBlocks.find(
      (b) => b.status === "pending" && b.start > nowDec,
    );

    if (nextBlock) {
      const diffSecs = (nextBlock.start - nowDec) * 3600;
      elTimer.innerText = formatHMS(diffSecs);
      elTimer.style.color = "var(--text-main)";
      elEndTime.innerText = `Próxima: ${nextBlock.name} às ${decToTimeStr(nextBlock.start)}`;
    } else {
      elTimer.innerText = "--:--:--";
      elTimer.style.color = "var(--text-muted)";
      elEndTime.innerText = "Nenhuma atividade agendada.";
    }
  } else if (isWaitingStart) {
    elLabel.innerText = "AGUARDANDO VOCÊ";
    elLabel.style.color = "var(--primary)";
    elName.innerText = active.name;
    elName.style.color = active.color || "var(--primary)";
    elTimer.innerText = "00:00:00";
    elTimer.style.color = "var(--text-main)";

    const delayMins = Math.floor((nowDec - active.start) * 60);
    delayWarn.innerText =
      delayMins > 0
        ? `Atrasado ${delayMins} min. O término será empurrado.`
        : "";

    elEndTime.innerText = `Duração da tarefa: ${formatHMS(active.duration * 3600)}`;
    elBar.style.width = "0%";
    elBar.style.boxShadow = "none";
    startArea.style.display = "flex";
    pauseArea.style.display = "none";

    if (active.type === "pause") {
      active.status = "running";
      saveData();
    }
  } else {
    elLabel.innerText = isCurrentlyPaused ? "EM PAUSA" : "EM ANDAMENTO";
    elLabel.style.color = "var(--text-muted)";
    elName.innerText = active.name;
    let activeColor =
      active.color ||
      (active.type === "pause"
        ? "var(--block-pause-border)"
        : "var(--primary)");
    elName.style.color = activeColor;
    startArea.style.display = "none";

    const endH = Math.floor(active.start + active.duration);
    const endM = Math.floor((active.start + active.duration - endH) * 60);
    elEndTime.innerText = `Término previsto: ${pad(endH)}:${pad(endM)}`;

    if (active.type === "study") {
      pauseArea.style.display = "flex";
      if (isCurrentlyPaused) {
        const btnPause = document.getElementById("btn-pause");
        const pauseCounter = document.getElementById("pause-counter");
        btnPause.innerText = "▶ Retomar Atividade";
        btnPause.style.background = "#ffcc80";
        btnPause.style.color = "#000";
        btnPause.style.borderColor = "#ffcc80";

        pauseCounter.style.display = "block";
        const elapsedSecs = Math.floor(
          (Date.now() - appData.pauseState.startTime) / 1000,
        );
        pauseCounter.innerText = `Pausado há ${formatHMS(elapsedSecs)}`;

        const pauseStartDec = new Date(appData.pauseState.startTime);
        const pStartDecHours =
          pauseStartDec.getHours() +
          pauseStartDec.getMinutes() / 60 +
          pauseStartDec.getSeconds() / 3600;
        let frozenDiffDec = active.start + active.duration - pStartDecHours;

        elTimer.innerText = formatHMS(frozenDiffDec * 3600);
        elTimer.style.color = "#888";

        const pct = ((active.duration - frozenDiffDec) / active.duration) * 100;
        elBar.style.width = `${pct}%`;
        elBar.style.background = "#555";
        elBar.style.boxShadow = "none";
      } else {
        const btnPause = document.getElementById("btn-pause");
        btnPause.innerText = "⏸ Pausar Atividade";
        btnPause.style.background = "var(--bg-card)";
        btnPause.style.color = "var(--text-main)";
        btnPause.style.borderColor = "var(--text-muted)";
        document.getElementById("pause-counter").style.display = "none";

        const diffSecs = (active.start + active.duration - nowDec) * 3600;
        elTimer.innerText = formatHMS(diffSecs > 0 ? diffSecs : 0);
        elTimer.style.color = "var(--text-main)";

        const pct =
          ((active.duration * 3600 - diffSecs) / (active.duration * 3600)) *
          100;
        elBar.style.width = `${pct}%`;
        elBar.style.background = activeColor;
        elBar.style.boxShadow = `0 0 10px ${activeColor}`;
      }
    } else {
      pauseArea.style.display = "none";
      elTimer.innerText = "Em Pausa";
      elTimer.style.color = "var(--text-main)";
      elBar.style.width = "100%";
      elBar.style.background = activeColor;
      elBar.style.boxShadow = `0 0 10px ${activeColor}`;
    }
  }
}

function formatHMS(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function pad(n) {
  return n < 10 ? "0" + n : n;
}
setInterval(updateTimer, 1000);

// --- RELATÓRIOS ---
function openDashboard() {
  let totalStudyHours = 0;
  let completedCount = 0;
  let missedCount = 0;
  const listEl = document.getElementById("history-list");
  listEl.innerHTML = "";
  [...appData.history].reverse().forEach((item) => {
    if (item.type !== "study") return;
    if (item.status === "completed") {
      totalStudyHours += item.duration;
      completedCount++;
    } else if (item.status === "missed") {
      missedCount++;
    }
    const div = document.createElement("div");
    div.className = `history-item status-${item.status === "completed" ? "done" : "missed"}`;
    div.innerHTML = `<div><div class="hist-name">${item.name}</div><div class="hist-time">${item.date} • ${Math.round(item.duration * 60)} min</div></div><div class="hist-status">${item.status === "completed" ? "CONCLUÍDO" : "FALTOU"}</div>`;
    listEl.appendChild(div);
  });
  document.getElementById("stat-hours").innerText =
    Math.round(totalStudyHours) + "h";
  document.getElementById("stat-completed").innerText = completedCount;
  document.getElementById("stat-missed").innerText = missedCount;
  document.getElementById("modal-dashboard").style.display = "flex";
}
async function clearHistory() {
  const confirmed = await showCustomConfirm(
    "Apagar Histórico",
    "Apagar todo o seu histórico de desempenho?",
  );
  if (confirmed) {
    appData.history = [];
    saveData();
    openDashboard();
  }
}

// --- AGENDA & MODAIS ---
function openSchedule() {
  currentDayIdx = new Date().getDay();
  document.getElementById("modal-schedule").style.display = "flex";
  renderTabs();
  renderGrid();
}
function closeModal(id) {
  document.getElementById(id).style.display = "none";
  // Remove o fundo apagado de onde foi aberto
  if (id === "modal-edit-block") {
    document.getElementById("schedule-card").classList.remove("dimmed");
    isCreatingNew = false;
  }
  if (id === "modal-profile") {
    document.getElementById("main-app-card").classList.remove("dimmed");
  }
  updateTimer();
}

function renderTabs() {
  const container = document.getElementById("week-tabs");
  container.innerHTML = "";
  DAYS.forEach((d, i) => {
    const btn = document.createElement("div");
    btn.className = `day-tab ${i === currentDayIdx ? "active" : ""}`;
    btn.innerText = d;
    btn.onclick = () => {
      currentDayIdx = i;
      renderTabs();
      renderGrid();
    };
    container.appendChild(btn);
  });
}

function renderGrid() {
  const container = document.getElementById("schedule-grid");
  container.innerHTML = "";
  for (let i = START_HOUR; i < END_HOUR; i++) {
    const mk = document.createElement("div");
    mk.className = "time-label";
    mk.style.top = `${(i - START_HOUR) * PX_PER_HOUR + 20}px`;
    mk.innerText = `${i}:00`;
    container.appendChild(mk);
  }
  appData.baseSchedule[currentDayIdx].forEach((block, idx) => {
    const el = document.createElement("div");
    el.className = `block ${block.type}`;
    el.style.top = `${(block.start - START_HOUR) * PX_PER_HOUR + 20}px`;
    el.style.height = `${block.duration * PX_PER_HOUR}px`;
    el.innerHTML = `<span>${block.name}</span>`;
    if (block.color) {
      el.style.borderLeftColor = block.color;
      el.style.color = block.color;
      el.style.backgroundColor = block.color + "20";
    }
    el.onclick = () => openBlockEditor(block, idx);
    container.appendChild(el);
  });
}

function decToTimeStr(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${pad(h)}:${pad(m)}`;
}
function timeStrToDec(str) {
  const [h, m] = str.split(":").map(Number);
  return h + m / 60;
}
function showError(msg) {
  const e = document.getElementById("edit-error");
  if (e) {
    e.innerText = msg;
    e.style.display = "block";
  }
}
function hideError() {
  const e = document.getElementById("edit-error");
  if (e) e.style.display = "none";
}

function openBlockEditor(block, idx) {
  isCreatingNew = false;
  editingBlockRef = { block, idx };
  hideError();
  document.getElementById("edit-name").value = block.name;
  document.getElementById("edit-type").value = block.type;
  document.getElementById("edit-color").value = block.color || "#bb86fc";
  document.getElementById("edit-start").value = decToTimeStr(block.start);
  document.getElementById("edit-end").value = decToTimeStr(
    block.start + block.duration,
  );
  document.getElementById("schedule-card").classList.add("dimmed");
  document.getElementById("modal-edit-block").style.display = "flex";
}

function addNewBlock() {
  isCreatingNew = true;
  editingBlockRef = null;
  hideError();
  document.getElementById("edit-name").value = "Nova Tarefa";
  document.getElementById("edit-type").value = "study";
  document.getElementById("edit-color").value = "#bb86fc";
  document.getElementById("edit-start").value = "09:00";
  document.getElementById("edit-end").value = "10:00";
  document.getElementById("schedule-card").classList.add("dimmed");
  document.getElementById("modal-edit-block").style.display = "flex";
}

function saveBlockEdit() {
  hideError();
  const name = document.getElementById("edit-name").value,
    type = document.getElementById("edit-type").value,
    color = document.getElementById("edit-color").value;
  const startDec = timeStrToDec(document.getElementById("edit-start").value),
    endDec = timeStrToDec(document.getElementById("edit-end").value);
  const duration = endDec - startDec;
  if (
    !document.getElementById("edit-start").value ||
    !document.getElementById("edit-end").value
  )
    return showError("Preencha os horários.");
  if (duration <= 0) return showError("O horário final deve ser maior!");
  if (startDec < START_HOUR)
    return showError(`O início não pode ser antes das ${START_HOUR}:00.`);
  const hasCollision = appData.baseSchedule[currentDayIdx].some((b, idx) => {
    if (!isCreatingNew && idx === editingBlockRef.idx) return false;
    return startDec < b.start + b.duration && endDec > b.start;
  });
  if (hasCollision)
    return showError("⚠️ Este horário já está ocupado na agenda!");
  if (isCreatingNew) {
    appData.baseSchedule[currentDayIdx].push({
      id: Math.random().toString(36).substr(2, 9),
      name,
      type,
      color,
      start: startDec,
      duration,
    });
    isCreatingNew = false;
  } else {
    Object.assign(editingBlockRef.block, {
      name,
      type,
      color,
      start: startDec,
      duration,
    });
  }
  cascadeBlocks(appData.baseSchedule[currentDayIdx]);
  if (currentDayIdx === new Date().getDay()) {
    appData.todayBlocks = JSON.parse(
      JSON.stringify(appData.baseSchedule[currentDayIdx]),
    );
    appData.todayBlocks.forEach((b) => (b.status = "pending"));
    appData.pauseState = { isPaused: false, startTime: null, blockId: null };
  }
  saveData();
  closeModal("modal-edit-block");
  renderGrid();
}

function deleteBlock() {
  if (isCreatingNew) {
    closeModal("modal-edit-block");
    return;
  }
  if (!editingBlockRef) return;
  appData.baseSchedule[currentDayIdx].splice(editingBlockRef.idx, 1);
  if (currentDayIdx === new Date().getDay()) {
    appData.todayBlocks = JSON.parse(
      JSON.stringify(appData.baseSchedule[currentDayIdx]),
    );
    appData.todayBlocks.forEach((b) => (b.status = "pending"));
    appData.pauseState = { isPaused: false, startTime: null, blockId: null };
  }
  saveData();
  closeModal("modal-edit-block");
  renderGrid();
}

// --- PERFIL E TEMA ---
function renderProfile() {
  // Aplica o tema na raiz da página
  document.documentElement.setAttribute("data-theme", appData.theme || "dark");

  let safeName = appData.name || "Alexandre";
  document.getElementById("display-name").innerText = safeName.substring(0, 10);
  const avatarEl = document.getElementById("avatar-img");
  if (appData.avatar && appData.avatar.trim() !== "") {
    avatarEl.style.backgroundImage = `url('${appData.avatar}')`;
    avatarEl.innerText = "";
  } else {
    avatarEl.style.backgroundImage = "none";
    avatarEl.innerText = "👤";
    avatarEl.style.display = "flex";
    avatarEl.style.alignItems = "center";
    avatarEl.style.justifyContent = "center";
    avatarEl.style.fontSize = "2rem";
  }
}

function openProfileModal() {
  // EFEITO DIM NO CARD PRINCIPAL
  document.getElementById("main-app-card").classList.add("dimmed");

  document.getElementById("profile-name-input").value = appData.name;
  document.getElementById("profile-img-input").value = appData.avatar;
  document.getElementById("profile-theme-input").value =
    appData.theme || "dark";
  document.getElementById("modal-profile").style.display = "flex";
}

function saveProfile() {
  appData.name = document.getElementById("profile-name-input").value;
  appData.avatar = document.getElementById("profile-img-input").value;
  appData.theme = document.getElementById("profile-theme-input").value;
  saveData();
  renderProfile();
  closeModal("modal-profile");
}

function saveData() {
  localStorage.setItem("studyPlannerV5", JSON.stringify(appData));
}

renderProfile();
updateTimer();
