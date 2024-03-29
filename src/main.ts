import { app, BrowserView, BrowserWindow, dialog, ipcMain } from "electron";
import { Subscription } from "sub-events";
import lolapi from "./lol-api";
import { ChampLoadout } from "./lol-api/LeagueApiInterfaces";
import { productName, version } from "../package.json";
import icon from "./images/icon.ico";
import log from "electron-log";

console.log = log.log; //use electron log instead.

import Store from "electron-store";

// This is imported as a raw string.
import styles from "./injects/uggstyles.inject.css";
// @ts-ignore
import loadoutjs from "./injects/loadout.inject";

const leagueApi = new lolapi();
let MainBrowserWindow: BrowserWindow = null;
let uggView: BrowserView = null;
let importView: BrowserView = null;
let champSelectSubscription: Subscription = null;

const store = new Store();

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_HEADER_WEBPACK_ENTRY: string;

if (require("electron-squirrel-startup")) app.quit();

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance, we should focus our window.
    if (MainBrowserWindow) {
      if (MainBrowserWindow.isMinimized()) MainBrowserWindow.restore();
      MainBrowserWindow.focus();
    }
  });
  app.on("ready", () => {
    if (process.platform !== "win32") {
      dialog.showErrorBox(
        "None Windows Platform Detected.",
        "This program isn't meant for you.. Sorry!"
      );
      app.quit();
    }
    createWindow();
    leagueApi.start();
    champSelectSubscription = leagueApi.onChampSelected.subscribe(
      (champData) => {
        importView.webContents.send("button-state", "disabled");
        const url =
          champData.role === "aram"
            ? `https://u.gg/lol/champions/aram/${champData.champion}-aram`
            : `https://u.gg/lol/champions/${champData.champion}/build?role=${champData.role}`;
        loadUggUrl(url)
          .then(() => importView.webContents.send("button-state", "enabled"))
          .catch(() => importView.webContents.send("button-state", "enabled"));
      }
    );
  });
}

const createWindow = () => {
  MainBrowserWindow = new BrowserWindow({
    height: 720,
    width: 1500,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
    },
    title: productName,
    frame: false,
    icon,
  });
  MainBrowserWindow.setBackgroundColor("#0b0b23");
  MainBrowserWindow.setResizable(false);
  MainBrowserWindow.webContents.loadURL(MAIN_HEADER_WEBPACK_ENTRY);
  addUggToBrowserWindow();
  addImportToBrowserWindow().then(() => {
    loadFlashPosition();
    importView.webContents.send("set-version", version);
  });
  loadUggUrl("https://u.gg/lol/tier-list");
};

const loadFlashPosition = (): void => {
  if (!store.has("flash-pos")) {
    store.set("flash-pos", "D");
  }
  ipcMain.on("flash-position-set", (_event, args) => {
    store.set("flash-pos", args);
  });
  importView.webContents.send("flash-position-get", store.get("flash-pos"));
};

const addUggToBrowserWindow = (): void => {
  if (uggView !== null) return;
  const bounds = MainBrowserWindow.getBounds();
  uggView = new BrowserView();
  uggView.setBackgroundColor("#0b0b23");
  MainBrowserWindow.addBrowserView(uggView);
  uggView.setBounds({
    x: 0,
    y: 30,
    height: bounds.height - 30,
    width: Math.floor(bounds.width / 1.2),
  });
};

const addImportToBrowserWindow = (): Promise<void> => {
  if (importView !== null) return;
  importView = new BrowserView({ webPreferences: { nodeIntegration: true } });
  importView.setBackgroundColor("#0b0b23");
  MainBrowserWindow.addBrowserView(importView);
  const bounds = MainBrowserWindow.getBounds();
  const uggBounds = uggView.getBounds();
  importView.setBounds({
    x: uggBounds.width,
    y: 30,
    height: bounds.height - 30,
    width: bounds.width - uggBounds.width,
  });
  return importView.webContents.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
};

const loadUggUrl = async (url: string): Promise<void> => {
  await uggView.webContents.loadURL(url, {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.74 Safari/537.36",
  });
  await uggView.webContents.insertCSS(styles);
  await uggView.webContents.executeJavaScript(`
    sessionStorage.setItem('ad-free-banner-v2','hide');
    document.getElementsByClassName('ad-free-banner')[0].remove();
  `);
};

const getChampLoadoutData = async (): Promise<ChampLoadout> => {
  try {
    const resp = await uggView.webContents.executeJavaScript(loadoutjs);
    return JSON.parse(resp);
  } catch (e) {
    log.error(e);
    return null;
  }
};

app.on("before-quit", () => {
  leagueApi?.stop();
  champSelectSubscription?.cancel();
});

app.on("window-all-closed", () => {
  app.quit();
});

log.catchErrors({
  showDialog: false,
  onError: log.error,
});

// LCU API uses a self signed cert, we need to tell electron to allow it.
app.on(
  "certificate-error",
  (event, _webContents, _url, _error, _certificate, callback) => {
    event.preventDefault();
    callback(true);
  }
);

ipcMain.on("import-click", async () => {
  importView.webContents.send("button-state", "disabled");
  try {
    const json = await getChampLoadoutData();
    await leagueApi.importChampLoadout(json);
  } catch (e) {
    log.error(e);
  }
  importView.webContents.send("button-state", "enabled");
});
