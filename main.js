const { app, BrowserWindow, screen } = require("electron");
const path = require("path");

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 550,
    height: 700,
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

  // No Windows, às vezes o ID do modelo de usuário é necessário para fixar o ícone
  if (process.platform === "win32") {
    app.setAppUserModelId("Meu Planner");
  }

  win.loadFile("index.html");
  //   win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
