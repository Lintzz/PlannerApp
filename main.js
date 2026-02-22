const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const windowStateFile = path.join(app.getPath("userData"), "window-state.json");

function createWindow() {
  let windowState = { width: 550, height: 700 };

  try {
    if (fs.existsSync(windowStateFile)) {
      windowState = JSON.parse(fs.readFileSync(windowStateFile, "utf8"));
    }
  } catch (error) {
    console.log("Nenhum estado anterior encontrado ou erro ao ler.");
  }

  const win = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    icon: path.join(__dirname, "icon.png"),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (process.platform === "win32") {
    app.setAppUserModelId("Meu Planner");
  }

  win.loadFile("index.html");

  const saveState = () => {
    const bounds = win.getBounds();
    fs.writeFileSync(windowStateFile, JSON.stringify(bounds));
  };

  win.on("moved", saveState);
  win.on("close", saveState);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
