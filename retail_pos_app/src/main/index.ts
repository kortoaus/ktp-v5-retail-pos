import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import {
  registerAllHandlers,
  autoConnectEscposPrinter,
  autoConnectScale,
  cleanupAll,
} from "./ipc";
import { checkForBootUpdate } from "./updater";

let mainWindow: BrowserWindow | null = null;
let customerWindow: BrowserWindow | null = null;
let cleanupStarted = false;

function closeCustomerWindow(): void {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.close();
  }
  customerWindow = null;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    // minWidth: 1366,
    // minHeight: 768,
    // maxWidth: 1366,
    // maxHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    closeCustomerWindow();
  });
}

function createCustomerWindow(): void {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const externalDisplay = displays.find((d) => d.id !== primaryDisplay.id);

  if (!externalDisplay) return;

  customerWindow = new BrowserWindow({
    x: externalDisplay.bounds.x,
    y: externalDisplay.bounds.y,
    width: externalDisplay.bounds.width,
    height: externalDisplay.bounds.height,
    fullscreen: true,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    customerWindow.loadURL(
      process.env["ELECTRON_RENDERER_URL"] + "/#/customer-display",
    );
  } else {
    customerWindow.loadFile(path.join(__dirname, "../renderer/index.html"), {
      hash: "customer-display",
    });
  }

  customerWindow.on("closed", () => {
    customerWindow = null;
  });
}

function toggleCustomerDisplay(): void {
  if (customerWindow && !customerWindow.isDestroyed()) {
    closeCustomerWindow();
  } else {
    createCustomerWindow();
  }
}

app.whenReady().then(() => {
  registerAllHandlers(() => mainWindow, toggleCustomerDisplay);
  createWindow();
  createCustomerWindow();
  autoConnectScale();
  autoConnectEscposPrinter();
  checkForBootUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  event.preventDefault();
  closeCustomerWindow();
  cleanupAll()
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Unknown cleanup error";
      console.log(`[App] Cleanup failed: ${message}`);
    })
    .finally(() => {
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
