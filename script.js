const { ipcRenderer } = require("electron");

// --- SINTETIZADOR DE ÁUDIO (INTELIGENTE) ---
function playAlertSound(type = "start") {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = "sine";

    const now = audioCtx.currentTime;

    if (type === "start") {
      oscillator.frequency.setValueAtTime(523.25, now);
      oscillator.frequency.setValueAtTime(659.25, now + 0.15);
      oscillator.frequency.setValueAtTime(783.99, now + 0.3);

      gainNode.gain.setValueAtTime(0.2, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
      oscillator.start(now);
      oscillator.stop(now + 1.0);
    } else if (type === "end") {
      oscillator.frequency.setValueAtTime(783.99, now);
      oscillator.frequency.setValueAtTime(659.25, now + 0.2);
      oscillator.frequency.setValueAtTime(523.25, now + 0.4);

      gainNode.gain.setValueAtTime(0.2, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      oscillator.start(now);
      oscillator.stop(now + 1.2);
    } else if (type === "transition") {
      oscillator.frequency.setValueAtTime(523.25, now);
      oscillator.frequency.setValueAtTime(783.99, now + 0.15);
      oscillator.frequency.setValueAtTime(1046.5, now + 0.3);

      gainNode.gain.setValueAtTime(0.25, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      oscillator.start(now);
      oscillator.stop(now + 1.5);
    }
  } catch (e) {
    console.log("Erro de áudio", e);
  }
}

// --- CONSTANTES ---
const PX_PER_HOUR = 60;
const START_HOUR = 6;
const END_HOUR = 24;
const DAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

let appData = JSON.parse(localStorage.getItem("studyPlannerV5")) || {
  name: "Alexandre",
  avatar: "",
  theme: "dark",
  baseSchedule: Array(7)
    .fill(null)
    .map(() => []),
  todayBlocks: [],
  history: [],
  lastDate: "",
  pauseState: { isPaused: false, startTime: null, blockId: null },
};

// Garante que dados antigos recebam a memória de originalStart
appData.todayBlocks.forEach((b) => {
  if (b.originalStart === undefined) b.originalStart = b.start;
});

let currentDayIdx = new Date().getDay();
let editingBlockRef = null;
let isCreatingNew = false;

// --- FUNÇÕES GERAIS ---
function closeApp() {
  ipcRenderer.send("close-app");
}

function minimizeApp() {
  ipcRenderer.send("minimize-app");
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
    currentDayIdx = todayIdx;
    appData.todayBlocks = JSON.parse(
      JSON.stringify(appData.baseSchedule[todayIdx]),
    );

    const nowDec =
      new Date().getHours() +
      new Date().getMinutes() / 60 +
      new Date().getSeconds() / 3600;

    appData.todayBlocks.forEach((b) => {
      b.originalStart = b.start; // Grava o horário original
      if (nowDec >= b.start + b.duration) {
        b.status = "missed";
      } else {
        b.status = "pending";
      }
      b.notifiedStart = false;
      b.notifiedEnd = false;
    });
    appData.lastDate = todayStr;
    appData.pauseState = { isPaused: false, startTime: null, blockId: null };
    saveData();
  }
}

function cascadeBlocks(blocksArray) {
  // 1. EFEITO ELÁSTICO: Restaura todas as tarefas pendentes pro horário original primeiro
  blocksArray.forEach((b) => {
    if (b.status === "pending" && b.originalStart !== undefined) {
      b.start = b.originalStart;
    }
  });

  // 2. Ordena cronologicamente
  blocksArray.sort((a, b) => a.start - b.start);

  // 3. EFEITO CASCATA INTELIGENTE
  let currentEndTime = 0; // Rastreador de tempo ocupado

  for (let i = 0; i < blocksArray.length; i++) {
    const curr = blocksArray[i];

    // Ignora tarefas puladas/faltas
    if (curr.status !== "missed") {
      // Se a tarefa for PENDENTE e estiver batendo no tempo já ocupado, empurra pra frente!
      if (curr.status === "pending" && curr.start < currentEndTime) {
        curr.start = currentEndTime;
      }

      // Atualiza onde o tempo da agenda está ocupado atualmente
      const actualEnd = curr.start + curr.duration;
      if (actualEnd > currentEndTime) {
        currentEndTime = actualEnd;
      }
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

// --- CONTROLE DE ATIVIDADES ---
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

    // CORREÇÃO: Avisa que começou ANTES de chamar a cascata!
    block.status = "running";

    // Se estiver atrasado, empurra a tarefa para o horário atual
    if (delay > 0) {
      block.start = nowDec;
    }

    // Agora o elástico respeita o seu atraso e empurra só as próximas matérias
    cascadeBlocks(appData.todayBlocks);

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
      cascadeBlocks(appData.todayBlocks);
      saveData();
      updateTimer();
    }
  }
}

async function endActivityEarly() {
  let active = appData.pauseState.isPaused
    ? appData.todayBlocks.find((b) => b.id === appData.pauseState.blockId)
    : appData.todayBlocks.find((b) => b.status === "running");

  if (!active) return;

  const msg =
    active.type === "study"
      ? "Deseja encerrar essa atividade agora? O tempo estudado até aqui será salvo."
      : "Deseja pular o resto desta pausa e adiantar a agenda?";

  const confirmed = await showCustomConfirm(
    active.type === "study" ? "Encerrar Mais Cedo" : "Pular Pausa",
    msg,
  );

  if (!confirmed) return;

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

  cascadeBlocks(appData.todayBlocks);
  saveData();
  updateTimer();
}

function togglePause() {
  if (appData.pauseState.isPaused) {
    const elapsedHours = (Date.now() - appData.pauseState.startTime) / 3600000;
    const block = appData.todayBlocks.find(
      (b) => b.id === appData.pauseState.blockId,
    );
    if (block) {
      block.start += elapsedHours;
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

  // --- LÓGICA DE ALARMES SONOROS AUTOMÁTICOS ---
  let soundType = null;

  appData.todayBlocks.forEach((b) => {
    const timeSinceStart = (nowDec - b.start) * 3600;
    const timeSinceEnd = (nowDec - (b.start + b.duration)) * 3600;

    if (timeSinceStart >= 0 && timeSinceStart <= 5 && !b.notifiedStart) {
      b.notifiedStart = true;
      soundType = soundType === "end" ? "transition" : "start";
    }

    if (timeSinceEnd >= 0 && timeSinceEnd <= 5 && !b.notifiedEnd) {
      b.notifiedEnd = true;
      soundType = soundType === "start" ? "transition" : "end";
    }
  });

  if (soundType) {
    playAlertSound(soundType);
    saveData();
  }

  appData.todayBlocks.forEach((b) => {
    if (b.status === "pending" && nowDec >= b.start + b.duration) {
      b.status = "missed";
      if (b.type === "study") logHistory(b, "missed");
      cascadeBlocks(appData.todayBlocks);
      saveData();
    }
  });

  appData.todayBlocks.forEach((b) => {
    if (b.status === "running" && !appData.pauseState.isPaused) {
      if (nowDec >= b.start + b.duration) {
        b.status = "completed";
        if (b.type === "study") logHistory(b, "completed");
        cascadeBlocks(appData.todayBlocks);
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
    if (active && active.type === "pause") {
      appData.pauseState = { isPaused: false, startTime: null, blockId: null };
      saveData();
      isCurrentlyPaused = false;
    } else {
      isCurrentlyPaused = true;
    }
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

  if (!active) {
    elLabel.innerText = "AGORA";
    elName.innerText = "Tempo Livre";
    elName.style.color = "var(--text-muted)";
    elBar.style.width = "0%";
    elBar.style.boxShadow = "none";
    startArea.style.display = "none";
    pauseArea.style.display = "none";

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
    // --- TEXTOS INTELIGENTES LÁ NO TOPO ---
    if (active.type === "pause") {
      elLabel.innerText = "INTERVALO / DESCANSO";
    } else {
      elLabel.innerText = isCurrentlyPaused ? "EM PAUSA" : "EM ANDAMENTO";
    }

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

    // BOTÕES E CRONÔMETRO
    pauseArea.style.display = "flex";

    if (active.type === "study") {
      document.getElementById("btn-pause").style.display = "block";
      document.getElementById("btn-end-early").innerText = "⏹ Encerrar Agora";

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
      // --- CRONÔMETRO DECRESCENTE APARECENDO NA PAUSA ---
      document.getElementById("btn-pause").style.display = "none";
      document.getElementById("btn-end-early").innerText = "⏭ Pular Pausa";
      document.getElementById("pause-counter").style.display = "none";

      const diffSecs = (active.start + active.duration - nowDec) * 3600;
      elTimer.innerText = formatHMS(diffSecs > 0 ? diffSecs : 0);
      elTimer.style.color = "var(--text-main)";

      const pct =
        ((active.duration * 3600 - diffSecs) / (active.duration * 3600)) * 100;
      elBar.style.width = `${pct}%`;
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

  document.querySelectorAll(".day-checkbox input").forEach((cb) => {
    cb.checked = parseInt(cb.value) === currentDayIdx;
  });

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

  document.querySelectorAll(".day-checkbox input").forEach((cb) => {
    cb.checked = parseInt(cb.value) === currentDayIdx;
  });

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

  const selectedDaysInputs = document.querySelectorAll(
    ".day-checkbox input:checked",
  );
  const selectedDays = Array.from(selectedDaysInputs).map((cb) =>
    parseInt(cb.value),
  );

  if (selectedDays.length === 0)
    return showError("Selecione pelo menos um dia da semana.");

  let hasCollision = false;
  for (let d of selectedDays) {
    const collision = appData.baseSchedule[d].some((b, idx) => {
      if (!isCreatingNew && d === currentDayIdx && idx === editingBlockRef.idx)
        return false;
      return startDec < b.start + b.duration && endDec > b.start;
    });
    if (collision) {
      hasCollision = true;
      break;
    }
  }

  if (hasCollision)
    return showError(
      "⚠️ Este horário já está ocupado em um dos dias selecionados!",
    );

  if (!isCreatingNew && !selectedDays.includes(currentDayIdx)) {
    const deletedId = editingBlockRef.block.id;
    appData.baseSchedule[currentDayIdx].splice(editingBlockRef.idx, 1);
    if (currentDayIdx === new Date().getDay()) {
      const todayIdx = appData.todayBlocks.findIndex((b) => b.id === deletedId);
      if (todayIdx !== -1) appData.todayBlocks.splice(todayIdx, 1);
    }
  }

  selectedDays.forEach((d) => {
    const isToday = d === new Date().getDay();

    if (!isCreatingNew && d === currentDayIdx) {
      Object.assign(editingBlockRef.block, {
        name,
        type,
        color,
        start: startDec,
        originalStart: startDec,
        duration,
      });
      if (isToday) {
        const todayBlock = appData.todayBlocks.find(
          (b) => b.id === editingBlockRef.block.id,
        );
        if (todayBlock)
          Object.assign(todayBlock, {
            name,
            type,
            color,
            start: startDec,
            originalStart: startDec,
            duration,
          });
      }
    } else {
      const newId = Math.random().toString(36).substr(2, 9);
      const newBlock = {
        id: newId,
        name,
        type,
        color,
        start: startDec,
        originalStart: startDec,
        duration,
      };
      appData.baseSchedule[d].push(newBlock);

      if (isToday) {
        const todayClone = JSON.parse(JSON.stringify(newBlock));
        const nowDec =
          new Date().getHours() +
          new Date().getMinutes() / 60 +
          new Date().getSeconds() / 3600;

        todayClone.originalStart = todayClone.start;

        if (nowDec >= todayClone.start + todayClone.duration) {
          todayClone.status = "missed";
        } else {
          todayClone.status = "pending";
        }
        todayClone.notifiedStart = false;
        todayClone.notifiedEnd = false;
        appData.todayBlocks.push(todayClone);
      }
    }
    cascadeBlocks(appData.baseSchedule[d]);
  });

  if (
    selectedDays.includes(new Date().getDay()) ||
    (!isCreatingNew &&
      !selectedDays.includes(currentDayIdx) &&
      currentDayIdx === new Date().getDay())
  ) {
    cascadeBlocks(appData.todayBlocks);
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

  const deletedId = editingBlockRef.block.id;
  appData.baseSchedule[currentDayIdx].splice(editingBlockRef.idx, 1);

  if (currentDayIdx === new Date().getDay()) {
    const todayIdx = appData.todayBlocks.findIndex((b) => b.id === deletedId);
    if (todayIdx !== -1) {
      appData.todayBlocks.splice(todayIdx, 1);
    }
    cascadeBlocks(appData.todayBlocks);

    if (appData.pauseState.blockId === deletedId) {
      appData.pauseState = { isPaused: false, startTime: null, blockId: null };
    }
  }

  saveData();
  closeModal("modal-edit-block");
  renderGrid();
}

async function clearSchedule() {
  const confirmed = await showCustomConfirm(
    "Zerar Agenda",
    "Tem certeza que deseja apagar TODAS as atividades de TODOS os dias da semana? Essa ação não pode ser desfeita.",
  );

  if (confirmed) {
    appData.baseSchedule = Array(7)
      .fill(null)
      .map(() => []);
    appData.todayBlocks = [];
    appData.pauseState = { isPaused: false, startTime: null, blockId: null };

    saveData();
    renderGrid();
    updateTimer();
  }
}

async function resetToday() {
  const confirmed = await showCustomConfirm(
    "Restaurar Hoje",
    "Deseja cancelar o andamento atual e restaurar os horários originais da agenda para o dia de hoje?",
  );

  if (confirmed) {
    const todayIdx = new Date().getDay();
    appData.todayBlocks = JSON.parse(
      JSON.stringify(appData.baseSchedule[todayIdx]),
    );

    const nowDec =
      new Date().getHours() +
      new Date().getMinutes() / 60 +
      new Date().getSeconds() / 3600;

    appData.todayBlocks.forEach((b) => {
      b.originalStart = b.start;
      if (nowDec >= b.start + b.duration) {
        b.status = "missed";
      } else {
        b.status = "pending";
      }
      b.notifiedStart = false;
      b.notifiedEnd = false;
    });

    appData.pauseState = { isPaused: false, startTime: null, blockId: null };

    saveData();
    updateTimer();
    closeModal("modal-schedule");
  }
}

// --- PERFIL E TEMA ---
function renderProfile() {
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

// --- AUTO-PAUSE AO FECHAR O APP ---
window.addEventListener("beforeunload", () => {
  const active = appData.todayBlocks.find((b) => b.status === "running");

  if (active && active.type === "study" && !appData.pauseState.isPaused) {
    appData.pauseState.isPaused = true;
    appData.pauseState.startTime = Date.now();
    appData.pauseState.blockId = active.id;
    saveData();
  }
});

renderProfile();
updateTimer();
