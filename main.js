const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  let win;

  app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  const windowStateFile = path.join(
    app.getPath("userData"),
    "window-state.json",
  );

  function createWindow() {
    let windowState = {};

    try {
      if (fs.existsSync(windowStateFile)) {
        windowState = JSON.parse(fs.readFileSync(windowStateFile, "utf8"));
      }
    } catch (error) {
      console.log("Nenhum estado anterior encontrado.");
    }

    win = new BrowserWindow({
      width: 450,
      height: 481,
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
        backgroundThrottling: false,
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

    ipcMain.on("minimize-app", () => win.minimize());
    ipcMain.on("close-app", () => win.close());
  }

  app.whenReady().then(createWindow);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
