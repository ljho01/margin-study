import { invoke, isTauri } from "@tauri-apps/api/core";

const EVERY = 6 * 60 * 60 * 1000;

/**
 * Checks GitHub Releases for a newer signed build at launch and every six
 * hours, installs it in the background, then offers a restart. Development
 * runs never update themselves.
 */
export function startAutoUpdate(onInstalled: (version: string) => void) {
  if (!isTauri() || import.meta.env.DEV) return () => {};
  let installing = false;
  let done = false;
  const run = async () => {
    if (installing || done) return;
    installing = true;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) return;
      await update.downloadAndInstall();
      done = true;
      onInstalled(update.version);
    } catch (error) {
      // Offline or no release yet: try again on the next round.
      console.warn("update check failed", error);
    } finally {
      installing = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), EVERY);
  return () => clearInterval(timer);
}

export async function restartApp() {
  await invoke("restart_installed_app");
}
