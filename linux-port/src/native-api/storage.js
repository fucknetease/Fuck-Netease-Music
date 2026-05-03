"use strict";

function createStorageHandlers(options) {
  const {
    app,
    cacheRoot,
    tempRoot,
    storageRoot,
    userDataRoot,
    logger,
    emitNativeEvent,
    path,
    fsp,
    session,
    normalizeJsonText,
    maybeRepairUtf8Mojibake,
    normalizeAssetUrl,
    ensureDir,
    pathExists,
    hashString,
    guessFileExtensionFromUrl,
    runStorageSql,
    executeSqlite,
    normalizeStorageTarget,
    storageTargetFromPathMode,
    readTextFile,
    writeTextFile,
    deleteTarget,
    listTarget,
    maybeSanitizeHomePageEcpmStorageText,
    normalizeStorageCheckFilesExistArgs,
    resolveDownloadFilePath,
    normalizeRelativeDownloadPath,
    moveFileIfNeeded,
    downloadManager
  } = options;

  return {
    "storage.init": async (downloadPath, _capacity, cachePath) => {
      const resolvedDownloadPath =
        normalizeStorageTarget(downloadPath) || app.getPath("downloads");
      const resolvedCachePath = normalizeStorageTarget(cachePath) || cacheRoot;
      await ensureDir(resolvedDownloadPath);
      await ensureDir(resolvedCachePath);
      return {
        __nativeCallbackArgs: [resolvedDownloadPath, resolvedCachePath]
      };
    },
    "storage.readfromfile": async (requestIdOrPayload, targetPath, _alone, pathMode) => {
      if (
        typeof requestIdOrPayload === "string" &&
        typeof targetPath === "string" &&
        typeof pathMode === "string"
      ) {
        const resolvedTarget = storageTargetFromPathMode(pathMode, targetPath);
        const content = resolvedTarget ? await readTextFile(resolvedTarget) : "";
        const sanitizedContent = maybeSanitizeHomePageEcpmStorageText(targetPath, content);
        emitNativeEvent("storage.onreadfromfiledone", requestIdOrPayload, 0, sanitizedContent);
        return sanitizedContent;
      }
      const payload = requestIdOrPayload || {};
      const resolvedTarget = normalizeStorageTarget(payload.path);
      if (!resolvedTarget) {
        return "";
      }
      return maybeSanitizeHomePageEcpmStorageText(payload.path, await readTextFile(resolvedTarget));
    },
    "storage.savetofile": async (requestIdOrPayload, content, _mode, targetPath, _alone, pathMode) => {
      if (
        typeof requestIdOrPayload === "string" &&
        typeof targetPath === "string" &&
        typeof pathMode === "string"
      ) {
        const resolvedTarget = storageTargetFromPathMode(pathMode, targetPath);
        if (!resolvedTarget) {
          emitNativeEvent("storage.onsavetofiledone", requestIdOrPayload, 1);
          return false;
        }
        await writeTextFile(
          resolvedTarget,
          maybeSanitizeHomePageEcpmStorageText(targetPath, content || "")
        );
        emitNativeEvent("storage.onsavetofiledone", requestIdOrPayload, 0);
        return true;
      }
      const payload = requestIdOrPayload || {};
      const resolvedTarget = normalizeStorageTarget(payload.path);
      if (!resolvedTarget) {
        return "";
      }
      return writeTextFile(
        resolvedTarget,
        maybeSanitizeHomePageEcpmStorageText(payload.path, payload.content || "")
      );
    },
    "storage.writefile": async (payload = {}) => {
      const targetPath = normalizeStorageTarget(payload.path);
      if (!targetPath) {
        return "";
      }
      return writeTextFile(
        targetPath,
        maybeSanitizeHomePageEcpmStorageText(payload.path, payload.content || "")
      );
    },
    "storage.readfile": async (payload = {}) => {
      const targetPath = normalizeStorageTarget(payload.path);
      if (!targetPath) {
        return "";
      }
      return maybeSanitizeHomePageEcpmStorageText(payload.path, await readTextFile(targetPath));
    },
    "storage.deletefile": async (requestIdOrPayload, pathMode, _unused, targetPath) => {
      if (
        typeof requestIdOrPayload === "string" &&
        typeof pathMode === "string" &&
        typeof targetPath === "string"
      ) {
        const resolvedTarget = storageTargetFromPathMode(pathMode, targetPath);
        const result = resolvedTarget ? await deleteTarget(resolvedTarget) : false;
        emitNativeEvent(
          "storage.ondeletefilesdone",
          requestIdOrPayload,
          result ? 0 : 1,
          resolvedTarget || targetPath
        );
        return result;
      }
      const payload = requestIdOrPayload || {};
      const resolvedTarget = normalizeStorageTarget(payload.path);
      return resolvedTarget ? deleteTarget(resolvedTarget) : false;
    },
    "storage.listfile": async (requestIdOrPayload, pathMode, _unused, targetPath) => {
      if (typeof requestIdOrPayload === "string" && typeof pathMode === "string") {
        const resolvedTarget = storageTargetFromPathMode(pathMode, targetPath || "storage");
        const entries = resolvedTarget ? await listTarget(resolvedTarget) : [];
        emitNativeEvent(
          "storage.onlistfile",
          requestIdOrPayload,
          0,
          entries.map((entry) => ({
            type: entry.isDir ? "dir" : "file",
            path: entry.path
          }))
        );
        return entries;
      }
      const payload = requestIdOrPayload || {};
      const resolvedTarget = normalizeStorageTarget(payload.path || "storage");
      return resolvedTarget ? listTarget(resolvedTarget) : [];
    },
    "storage.getsystemdir": async (payload = {}) => {
      const typeValue =
        payload && typeof payload === "object" ? payload.type || payload.key : payload;
      const numericMap = {
        108: app.getPath("downloads"),
        5: app.getPath("music"),
        2: userDataRoot
      };
      if (typeof typeValue === "number" && numericMap[typeValue]) {
        return { path: numericMap[typeValue] };
      }
      const key = String(typeValue || "").toLowerCase();
      const dirMap = {
        download: app.getPath("downloads"),
        music: app.getPath("music"),
        cache: cacheRoot,
        temp: tempRoot,
        user_data: userDataRoot,
        userdata: userDataRoot,
        storage: storageRoot
      };
      return { path: dirMap[key] || storageRoot };
    },
    "storage.playcacheinfo": async () => ({
      cachePath: cacheRoot,
      cacheSize: 0
    }),
    "storage.clearcache": async (targetPath = "") => {
      const resolvedTarget = normalizeStorageTarget(targetPath || cacheRoot);
      if (resolvedTarget) {
        await deleteTarget(resolvedTarget);
        await ensureDir(resolvedTarget);
      }
      emitNativeEvent("storage.onclearcache", Boolean(resolvedTarget));
      return true;
    },
    "storage.updatetemp": async (cacheKey, content = "") => {
      const filePath = path.join(tempRoot, `${hashString(String(cacheKey))}.json`);
      await writeTextFile(filePath, content);
      return true;
    },
    "storage.gettempfile": async (cacheKey) => {
      const filePath = path.join(tempRoot, `${hashString(String(cacheKey))}.json`);
      if (!(await pathExists(filePath))) {
        emitNativeEvent("storage.ongettempfile", cacheKey, 1, "");
        return "";
      }
      const content = await readTextFile(filePath);
      emitNativeEvent("storage.ongettempfile", cacheKey, 0, content);
      return content;
    },
    "storage.setplaycacheconfig": async () => true,
    "storage.querycachetracks": async () => [],
    "storage.querynewcachetracks": async () => [],
    "storage.querynewcachetrack": async () => null,
    "storage.fetch": async (payload = {}) => {
      const response = await fetch(payload.url, payload.options || {});
      const text = normalizeJsonText(maybeRepairUtf8Mojibake(await response.text()));
      return {
        ok: response.ok,
        status: response.status,
        text
      };
    },
    "linuxport.prepareaudio": async (payload = {}) => {
      const rawUrl =
        payload && typeof payload === "object" ? payload.url || payload.musicurl || "" : "";
      const normalizedUrl = normalizeAssetUrl(String(rawUrl || ""));
      if (!/^https:\/\/[^/]+\.music\.126\.net(\/|$)/i.test(normalizedUrl)) {
        return "";
      }

      const cacheDir = path.join(tempRoot, "prepared-audio");
      await ensureDir(cacheDir);
      const extension = guessFileExtensionFromUrl(normalizedUrl, ".bin");
      const filePath = path.join(cacheDir, `${hashString(normalizedUrl)}${extension}`);

      try {
        const stat = await fsp.stat(filePath);
        if (stat.isFile() && stat.size > 0) {
          return filePath;
        }
      } catch {}

      const headers = {
        Origin: "https://music.163.com",
        origin: "https://music.163.com",
        Referer: "https://music.163.com/",
        referer: "https://music.163.com/",
        Accept: "audio/*,*/*;q=0.9"
      };
      const cookies = await session.defaultSession.cookies.get({ url: normalizedUrl });
      if (cookies.length > 0) {
        headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
      }

      const response = await fetch(normalizedUrl, { method: "GET", headers });
      if (!response.ok) {
        throw new Error(`prepareaudio failed: ${response.status}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      await fsp.writeFile(filePath, bytes);
      return filePath;
    },
    "storage.imagesinfo": async () => [],
    "storage.execsql": async (requestIdOrSql = "", sqlText = "") => {
      if (typeof requestIdOrSql === "string" && typeof sqlText === "string") {
        return runStorageSql(requestIdOrSql, sqlText);
      }
      const rawSql =
        typeof requestIdOrSql === "string"
          ? requestIdOrSql
          : requestIdOrSql && typeof requestIdOrSql === "object"
            ? requestIdOrSql.sql || requestIdOrSql.query || ""
            : "";
      return executeSqlite(rawSql);
    },
    "storage.exectransaction": async (requestId = "", sqlText = "") => runStorageSql(requestId, sqlText),
    "storage.testwriteable": async (payload = {}) => {
      const targetPath = normalizeStorageTarget(payload.path || storageRoot);
      if (!targetPath) {
        return false;
      }
      await ensureDir(targetPath);
      return true;
    },
    "storage.checkfilesexist": async (...args) => {
      const { files, baseDir } = normalizeStorageCheckFilesExistArgs(args);
      const resolvedBaseDir = normalizeStorageTarget(baseDir) || baseDir;
      const results = [];
      for (const file of files) {
        const fileId = String(file?.id || "");
        const rawPath = String(file?.path || "");
        let candidatePath = resolveDownloadFilePath(resolvedBaseDir, rawPath);
        if (!candidatePath && path.isAbsolute(rawPath)) {
          candidatePath = rawPath;
        }
        if (!candidatePath && rawPath) {
          candidatePath = resolveDownloadFilePath(resolvedBaseDir, rawPath.replace(/^\/+/, ""));
        }
        const exist = candidatePath ? await pathExists(candidatePath) : false;
        results.push({ id: fileId, path: rawPath, exist });
      }
      return results;
    },
    "storage.addid3": async (payload = {}) => {
      const downloadDir =
        normalizeStorageTarget(payload.downloadDir) ||
        normalizeStorageTarget(payload.basePath) ||
        app.getPath("downloads");
      const sourceRelativePath = normalizeRelativeDownloadPath(payload.path || "");
      const targetRelativePath = normalizeRelativeDownloadPath(
        payload.finalPath || payload.newRelativePath || payload.relativePath || payload.path || ""
      );
      const sourcePath = resolveDownloadFilePath(downloadDir, sourceRelativePath);
      const targetPath = resolveDownloadFilePath(downloadDir, targetRelativePath);

      if (!sourcePath) {
        return { status: false, path: payload.path || "" };
      }
      if (!(await pathExists(sourcePath))) {
        return { status: false, path: sourceRelativePath };
      }

      const finalPath = await moveFileIfNeeded(sourcePath, targetPath || sourcePath);
      return {
        status: true,
        path: normalizeRelativeDownloadPath(path.relative(downloadDir, finalPath))
      };
    },
    "storage.querydownloadingprocess": async (...args) => downloadManager.queryDownloadProgress(args),
    "storage.startscandownload": async (...args) => downloadManager.scanDownloads(args),
    "storage.subscribecopyncmprocess": async (payload = {}) =>
      downloadManager.subscribeCopyNcmProcess(payload),
    "storage.copyncm": async (payload = {}) => downloadManager.copyNcmFiles(payload),
    "storage.copyfiles": async (payload = {}) => {
      const srcFiles = Array.isArray(payload?.srcFiles || payload?.sources)
        ? payload.srcFiles || payload.sources
        : [];
      const destFiles = Array.isArray(payload?.destFiles || payload?.targets)
        ? payload.destFiles || payload.targets
        : [];
      const copied = [];
      for (let index = 0; index < Math.min(srcFiles.length, destFiles.length); index += 1) {
        const src = String(srcFiles[index] || "");
        const dst = String(destFiles[index] || "");
        if (!src || !dst) {
          continue;
        }
        await ensureDir(path.dirname(dst));
        await fsp.copyFile(src, dst);
        copied.push({ src, dst });
      }
      return copied;
    },
    "storage.offlinetrack": async (payload = {}) => {
      try {
        return await downloadManager.startNativeDownload(payload);
      } catch (error) {
        logger.warn("[native:storage.offlinetrack]", error?.message || error);
        return { ok: false, error: error?.message || String(error) };
      }
    }
  };
}

module.exports = {
  createStorageHandlers
};
