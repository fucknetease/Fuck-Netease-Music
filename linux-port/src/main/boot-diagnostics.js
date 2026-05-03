"use strict";

const fs = require("node:fs");
const path = require("node:path");

async function runBootDiagnostics(mainWindow, debugRoot) {
  if (!process.env.NETEASE_DEBUG_BOOT || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  await fs.promises.mkdir(debugRoot, { recursive: true });

  try {
    const page = await mainWindow.webContents.capturePage();
    await fs.promises.writeFile(path.join(debugRoot, "boot.png"), page.toPNG());
  } catch (error) {
    console.error("[debug:boot:capture-failed]", error);
  }

  try {
    const payload = await mainWindow.webContents.executeJavaScript(
      `(async () => {
        const root = document.querySelector("#root");
        const body = document.body;
        const trim = (value) => typeof value === "string" ? value.trim() : "";
        const text = trim(root?.innerText || body?.innerText || "");
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          pathname: location.pathname,
          rootTag: root?.tagName || null,
          rootExists: Boolean(root),
          rootChildCount: root?.childElementCount || 0,
          rootHtmlLength: root?.innerHTML?.length || 0,
          rootReactKeys: root
            ? Object.getOwnPropertyNames(root).filter((key) => key.startsWith("__react")).slice(0, 20)
            : [],
          gAppExists: Boolean(window.g_app),
          gAppKeys: window.g_app ? Object.keys(window.g_app).slice(0, 20) : [],
          storeKeys: window.g_app?.store?.getState ? Object.keys(window.g_app.store.getState()) : [],
          historyLocation:
            window.g_app?.history?.location
              ? {
                  pathname: window.g_app.history.location.pathname,
                  search: window.g_app.history.location.search,
                  hash: window.g_app.history.location.hash
                }
              : null,
          performanceResources:
            typeof performance?.getEntriesByType === "function"
              ? performance
                  .getEntriesByType("resource")
                  .slice(-30)
                  .map((entry) => ({
                    name: entry.name,
                    initiatorType: entry.initiatorType,
                    duration: Math.round(entry.duration),
                    transferSize: entry.transferSize || 0
                  }))
              : [],
          localStorageKeys:
            window.localStorage
              ? Object.keys(window.localStorage).sort().slice(0, 40)
              : [],
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1
          },
          bodyStyle: body
            ? (() => {
                const style = window.getComputedStyle(body);
                return {
                  backgroundColor: style.backgroundColor,
                  color: style.color,
                  opacity: style.opacity,
                  visibility: style.visibility
                };
              })()
            : null,
          rootStyle: root
            ? (() => {
                const style = window.getComputedStyle(root);
                const rect = root.getBoundingClientRect();
                return {
                  display: style.display,
                  opacity: style.opacity,
                  visibility: style.visibility,
                  color: style.color,
                  backgroundColor: style.backgroundColor,
                  rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                  }
                };
              })()
            : null,
          topElementAtCenter: (() => {
            const target = document.elementFromPoint(
              Math.max(0, Math.floor(window.innerWidth / 2)),
              Math.max(0, Math.floor(window.innerHeight / 2))
            );
            return target
              ? {
                  tag: target.tagName,
                  id: target.id || "",
                  className: target.className || "",
                  text: trim(target.innerText || "").slice(0, 120)
                }
              : null;
          })(),
          visibleTextSamples: Array.from(document.querySelectorAll("body *"))
            .map((element) => {
              const textContent = trim(element.innerText || "");
              if (!textContent) {
                return null;
              }
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName,
                id: element.id || "",
                className: String(element.className || "").slice(0, 120),
                text: textContent.slice(0, 80),
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                color: style.color,
                rect: {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                }
              };
            })
            .filter(Boolean)
            .slice(0, 20),
          bodyChildren: body
            ? Array.from(body.children).map((node) => ({
                tag: node.tagName,
                id: node.id || "",
                className: typeof node.className === "string" ? node.className : "",
                textLength: trim(node.textContent || "").length
              }))
            : [],
          bodyHtmlLength: body?.innerHTML?.length || 0,
          bodyPreview: trim(body?.innerHTML || "").slice(0, 400),
          textLength: text.length,
          textPreview: text.slice(0, 400)
        };
      })();`,
      true
    );
    await fs.promises.writeFile(
      path.join(debugRoot, "boot.json"),
      `${JSON.stringify(payload, null, 2)}\n`
    );
    console.log("[debug:boot]", JSON.stringify(payload));
  } catch (error) {
    console.error("[debug:boot:dom-failed]", error);
  }
}

module.exports = {
  runBootDiagnostics
};
