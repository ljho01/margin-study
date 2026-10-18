//! Relaunch the installed bundle only after the previous process has exited.
//! Tauri's macOS restart uses `open -n` while the old app is still registered as
//! running, which can leave a separate running tile beside the pinned Dock tile.

use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::Manager;

pub struct RelaunchState {
    // Capture before an updater swaps the bundle; do not resolve the old inode
    // or canonicalize the path after installation.
    bundle: Option<PathBuf>,
    pending: AtomicBool,
}

impl RelaunchState {
    pub fn capture() -> Self {
        #[cfg(target_os = "macos")]
        let bundle = {
            let main = objc2_foundation::NSBundle::mainBundle();
            let path = PathBuf::from(main.bundlePath().to_string());
            (path.extension().is_some_and(|ext| ext == "app")
                && path.join("Contents/Info.plist").is_file())
            .then_some(path)
        };
        #[cfg(not(target_os = "macos"))]
        let bundle = None;
        Self {
            bundle,
            pending: AtomicBool::new(false),
        }
    }
}

#[cfg(target_os = "macos")]
const HELPER: &str = include_str!("relaunch-macos.sh");

#[tauri::command]
pub fn restart_installed_app(
    app: tauri::AppHandle,
    state: tauri::State<'_, RelaunchState>,
) -> Result<(), String> {
    if state.pending.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let result = (|| -> Result<(), String> {
            use std::{
                fs::OpenOptions,
                os::unix::process::CommandExt,
                process::{Command, Stdio},
            };
            let bundle = state
                .bundle
                .as_ref()
                .ok_or("설치된 앱에서 다시 시작해 주세요.")?;
            if !bundle.join("Contents/Info.plist").is_file() {
                return Err("설치된 앱을 찾을 수 없어 다시 시작하지 못했어요.".into());
            }
            let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
            let log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(logs.join("relaunch.log"))
                .map_err(|e| e.to_string())?;
            Command::new("/bin/sh")
                .args(["-c", HELPER, "margin-relaunch"])
                .arg(std::process::id().to_string())
                .arg(bundle)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(log)
                .process_group(0)
                .spawn()
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            state.pending.store(false, Ordering::SeqCst);
            return Err(error);
        }
        // Runs Tauri's exit/cleanup path. The detached helper waits for the PID
        // to disappear, not an arbitrary delay or just the window closing.
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    app.restart()
}
