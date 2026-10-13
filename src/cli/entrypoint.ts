import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

function pathFromModuleUrl(moduleUrl: string) {
  const url = new URL(moduleUrl);
  url.search = "";
  url.hash = "";
  return fileURLToPath(url);
}

/**
 * True when `moduleUrl` is the process entrypoint.
 * Pass the caller's own `import.meta.url`. A default here would capture this helper's URL.
 */
export function isCliEntrypoint(moduleUrl: string, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(pathFromModuleUrl(moduleUrl));
  } catch {
    try {
      return pathToFileURL(entry).href === new URL(moduleUrl).href;
    } catch {
      return false;
    }
  }
}
