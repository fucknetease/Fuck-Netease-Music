"use strict";

function createWindowHandlers(options) {
  const {
    Menu,
    dialog,
    globalShortcut,
    app,
    settings,
    saveSettings,
    emitNativeEvent,
    currentWindow,
    normalizeDataValue,
    normalizeMenuCoordinates,
    normalizeMenuInput,
    buildPopupMenuTemplate,
    showPopupMenu,
    createWindow
  } = options;

  return {
    "app.opensavefiledialog": async (payload = {}) => {
      const win = currentWindow();
      return dialog.showSaveDialog(win, {
        title: payload.title || "Save file",
        defaultPath: payload.defaultPath
      });
    },
    "app.selectsystemfilelimitcount": async (payload = {}) => {
      const win = currentWindow();
      return dialog.showOpenDialog(win, {
        title: payload.title || "Select file",
        properties: ["openFile", "multiSelections"]
      });
    },
    "app.selectsystemfileanddir": async (payload = {}) => {
      const win = currentWindow();
      return dialog.showOpenDialog(win, {
        title: payload.title || "Select file or directory",
        properties: ["openFile", "openDirectory", "multiSelections"]
      });
    },
    "winhelper.initmainwindow": async () => true,
    "winhelper.finishloadmainwindow": async () => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        win.show();
      }
      return true;
    },
    "winhelper.setnativewindowshow": async (visible = true) => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        if (visible === false) {
          win.hide();
        } else {
          win.show();
        }
      }
      return true;
    },
    "winhelper.show": async () => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
      return true;
    },
    "winhelper.showwindow": async (state) => {
      const win = currentWindow();
      if (!win || win.isDestroyed()) {
        return true;
      }
      if (state === "hide" || state === false) {
        win.hide();
        return true;
      }
      win.show();
      win.focus();
      return true;
    },
    "winhelper.hide": async () => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        win.hide();
      }
      return true;
    },
    "winhelper.getwindowposition": async () => {
      const win = currentWindow();
      if (!win || win.isDestroyed()) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      const bounds = win.getBounds();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      };
    },
    "winhelper.launchwindow": async (targetUrl = "", bounds = {}, windowOptions = {}) => {
      if (typeof createWindow !== "function" || !targetUrl) {
        return null;
      }
      return createWindow({
        url: String(targetUrl),
        bounds: bounds && typeof bounds === "object" ? bounds : {},
        options: windowOptions && typeof windowOptions === "object" ? windowOptions : {},
        parentWindow: currentWindow()
      });
    },
    "winhelper.close": async () => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        win.close();
      }
      return true;
    },
    "winhelper.setwindowposition": async (payload = {}) => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        const width = Math.max(320, Math.round(payload.width || win.getBounds().width));
        const height = Math.max(240, Math.round(payload.height || win.getBounds().height));
        const x = Number.isFinite(Number(payload.x)) ? Math.round(Number(payload.x)) : win.getBounds().x;
        const y = Number.isFinite(Number(payload.y)) ? Math.round(Number(payload.y)) : win.getBounds().y;
        win.setBounds({ x, y, width, height });
        if (payload.topmost !== undefined) {
          win.setAlwaysOnTop(Boolean(payload.topmost));
        }
      }
      return true;
    },
    "winhelper.bringwindowtotop": async () => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
      return true;
    },
    "winhelper.setwindowsizelimit": async (payload = {}) => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        win.setMinimumSize(payload.x || 480, payload.y || 320);
      }
      return true;
    },
    "winhelper.iswindowfullscreen": async () => {
      const win = currentWindow();
      return Boolean(win && !win.isDestroyed() && win.isFullScreen());
    },
    "winhelper.setwindowfullscreen": async (payload = {}) => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        win.setFullScreen(Boolean(payload.value ?? payload));
      }
      return true;
    },
    "winhelper.setwindowtitle": async (payload = {}) => {
      const win = currentWindow();
      if (win && !win.isDestroyed()) {
        win.setTitle(payload.title || payload || "NetEase Cloud Music");
      }
      return true;
    },
    "winhelper.setwindowiconfromlocalfile": async () => true,
    "winhelper.popupmenu": async (...args) => {
      const payload = args.length === 1 ? args[0] : args;
      return showPopupMenu(payload);
    },
    "winhelper.updatemenu": async () => true,
    "winhelper.setusemediakey": async () => true,
    "winhelper.registerhotkey": async (nameOrPayload = {}, keyCodes, isGlobal, meta = {}) => {
      if (typeof nameOrPayload === "string") {
        settings.hotkeys[nameOrPayload] = {
          keyCodes: Array.isArray(keyCodes) ? keyCodes : [],
          isGlobal: Boolean(isGlobal)
        };
        saveSettings();
        emitNativeEvent(
          "winhelper.onRegisterHotkeyResult",
          nameOrPayload,
          Boolean(isGlobal),
          0,
          meta
        );
        return true;
      }

      const accelerator =
        nameOrPayload.hotkey || nameOrPayload.key || nameOrPayload.accelerator || "";
      if (!accelerator) {
        return false;
      }
      settings.hotkeys[accelerator] = true;
      saveSettings();
      return globalShortcut.register(accelerator, () => {
        emitNativeEvent("winhelper.onHotkey", accelerator, false);
      });
    },
    "winhelper.unregisterhotkey": async (nameOrPayload = {}, isGlobal, meta = {}) => {
      if (typeof nameOrPayload === "string") {
        delete settings.hotkeys[nameOrPayload];
        saveSettings();
        emitNativeEvent(
          "winhelper.onUnregisterHotkeyResult",
          nameOrPayload,
          Boolean(isGlobal),
          0,
          meta
        );
        return true;
      }

      const accelerator =
        nameOrPayload.hotkey || nameOrPayload.key || nameOrPayload.accelerator || "";
      if (accelerator) {
        globalShortcut.unregister(accelerator);
        delete settings.hotkeys[accelerator];
        saveSettings();
      }
      return true;
    }
  };
}

module.exports = {
  createWindowHandlers
};
