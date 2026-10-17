use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::{oneshot, Mutex};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    is_directory: bool,
}

#[derive(Default)]
pub struct WorkspaceState {
    selected: Mutex<Option<PathBuf>>,
    registry_lock: Mutex<()>,
}

fn registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("workspaces.json"))
}
fn load_registry(app: &tauri::AppHandle) -> Result<Vec<Workspace>, String> {
    let path = registry_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn save_registry(app: &tauri::AppHandle, roots: &[Workspace]) -> Result<(), String> {
    let path = registry_path(app)?;
    fs::create_dir_all(path.parent().ok_or("저장 경로 오류")?).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(roots).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}
fn trusted_root(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    let workspace = load_registry(app)?
        .into_iter()
        .find(|w| w.id == id)
        .ok_or("신뢰하지 않은 폴더입니다.")?;
    fs::canonicalize(workspace.path)
        .map_err(|_| "폴더를 찾을 수 없습니다. 다시 열어 주세요.".into())
}

fn resolve_inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path
        .components()
        .any(|p| !matches!(p, Component::Normal(_) | Component::CurDir))
    {
        return Err("폴더 밖의 경로에 접근할 수 없습니다.".into());
    }
    let resolved = fs::canonicalize(root.join(path)).map_err(|e| e.to_string())?;
    if !resolved.starts_with(root) {
        return Err("폴더 밖의 경로에 접근할 수 없습니다.".into());
    }
    Ok(resolved)
}

fn directory_entries(root: &Path, relative: &str) -> Result<Vec<Entry>, String> {
    let directory = resolve_inside(root, relative)?;
    if !directory.is_dir() {
        return Err("폴더가 아닙니다.".into());
    }
    let mut entries = Vec::new();
    for item in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(target) = fs::canonicalize(item.path()) else {
            continue;
        };
        if !target.starts_with(root) {
            continue;
        }
        let is_directory = target.is_dir();
        if !is_directory
            && !(target.is_file()
                && item
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")))
        {
            continue;
        }
        let path = Path::new(relative)
            .join(&name)
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(Entry {
            name,
            path,
            is_directory,
        });
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn choose_workspace(
    app: tauri::AppHandle,
    state: tauri::State<'_, WorkspaceState>,
) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .set_title("폴더 열기")
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !path.is_dir() {
        return Err("폴더가 아닙니다.".into());
    }
    *state.selected.lock().await = Some(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn trust_workspace(
    app: tauri::AppHandle,
    state: tauri::State<'_, WorkspaceState>,
    path: String,
) -> Result<Workspace, String> {
    let selected = state
        .selected
        .lock()
        .await
        .take()
        .ok_or("먼저 폴더를 선택해 주세요.")?;
    if selected != PathBuf::from(&path) {
        return Err("선택한 폴더와 다릅니다.".into());
    }
    let _lock = state.registry_lock.lock().await;
    let mut roots = load_registry(&app)?;
    let workspace = roots
        .iter()
        .find(|w| w.path == path)
        .cloned()
        .unwrap_or_else(|| Workspace {
            id: uuid::Uuid::new_v4().to_string(),
            name: selected
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path,
        });
    roots.retain(|w| w.id != workspace.id);
    roots.insert(0, workspace.clone());
    save_registry(&app, &roots)?;
    Ok(workspace)
}

#[tauri::command]
pub async fn list_workspaces(
    app: tauri::AppHandle,
    state: tauri::State<'_, WorkspaceState>,
) -> Result<Vec<Workspace>, String> {
    let _lock = state.registry_lock.lock().await;
    load_registry(&app)
}

#[tauri::command]
pub async fn list_workspace_directory(
    app: tauri::AppHandle,
    workspace_id: String,
    path: String,
) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = trusted_root(&app, &workspace_id)?;
        directory_entries(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Resolves an existing PDF inside a trusted workspace.
pub fn resolve_trusted_file(
    app: &tauri::AppHandle,
    workspace_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let root = trusted_root(app, workspace_id)?;
    let file = resolve_inside(&root, path)?;
    if !file.is_file() {
        return Err("PDF 파일이 아닙니다.".into());
    }
    Ok(file)
}

#[tauri::command]
pub async fn read_workspace_pdf(
    app: tauri::AppHandle,
    workspace_id: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let data = tauri::async_runtime::spawn_blocking(move || {
        let root = trusted_root(&app, &workspace_id)?;
        let file = resolve_inside(&root, &path)?;
        if !file.is_file()
            || !file
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
        {
            return Err("PDF 파일이 아닙니다.".to_string());
        }
        if fs::metadata(&file).map_err(|e| e.to_string())?.len() > 180 * 1024 * 1024 {
            return Err("180 MB 이하의 PDF를 열어 주세요.".into());
        }
        fs::read(file).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(data))
}

/// An existing file or folder inside the root, excluding the root itself. The
/// last component is not resolved, so a link is renamed or moved as a link.
fn entry_inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    let Some(name) = path.file_name() else {
        return Err("폴더 자체는 바꿀 수 없습니다.".into());
    };
    if path
        .components()
        .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("폴더 밖의 경로에 접근할 수 없습니다.".into());
    }
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let entry = resolve_inside(root, &parent)?.join(name);
    fs::symlink_metadata(&entry).map_err(|_| "항목을 찾을 수 없습니다. 새로고침해 주세요.".to_string())?;
    Ok(entry)
}

fn relative_to(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|_| "폴더 밖의 경로에 접근할 수 없습니다.".to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// Renames like Finder within the same folder. A PDF keeps its extension so
/// it does not vanish from the list.
fn rename_entry(root: &Path, relative: &str, name: &str) -> Result<String, String> {
    let source = entry_inside(root, relative)?;
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || name.contains('/')
        || name.contains(':')
        || name.len() > 255
    {
        return Err("사용할 수 없는 이름입니다.".into());
    }
    let mut name = name.to_string();
    if source.is_file()
        && source
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
        && !name.to_lowercase().ends_with(".pdf")
    {
        name.push_str(".pdf");
    }
    let target = source.with_file_name(&name);
    if target == source {
        return relative_to(root, &source);
    }
    // A case-only rename finds the same file on a case-insensitive volume.
    if fs::symlink_metadata(&target).is_ok() && !same_file(&source, &target) {
        return Err(format!("“{name}” 이름이 이미 있습니다."));
    }
    fs::rename(&source, &target).map_err(|e| e.to_string())?;
    relative_to(root, &target)
}

fn move_entry(root: &Path, relative: &str, directory: &str) -> Result<String, String> {
    let source = entry_inside(root, relative)?;
    let destination = resolve_inside(root, directory)?;
    if !destination.is_dir() {
        return Err("폴더가 아닙니다.".into());
    }
    if source.is_dir() {
        if let Ok(inner) = fs::canonicalize(&source) {
            if destination.starts_with(&inner) {
                return Err("폴더를 그 안으로 옮길 수 없습니다.".into());
            }
        }
    }
    let name = source.file_name().ok_or("항목을 찾을 수 없습니다.")?;
    let target = destination.join(name);
    if target == source {
        return relative_to(root, &source);
    }
    if fs::symlink_metadata(&target).is_ok() {
        return Err(format!(
            "“{}” 이름이 이미 그 폴더에 있습니다.",
            name.to_string_lossy()
        ));
    }
    fs::rename(&source, &target).map_err(|e| e.to_string())?;
    relative_to(root, &target)
}

/// Moves to the Trash the way Finder does, so it can be put back.
#[cfg(target_os = "macos")]
fn trash(path: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| e.localizedDescription().to_string())
}
#[cfg(not(target_os = "macos"))]
fn trash(_path: &Path) -> Result<(), String> {
    Err("이 운영체제에서는 휴지통으로 옮길 수 없습니다.".into())
}

#[tauri::command]
pub async fn rename_workspace_entry(
    app: tauri::AppHandle,
    workspace_id: String,
    path: String,
    name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_entry(&trusted_root(&app, &workspace_id)?, &path, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn move_workspace_entry(
    app: tauri::AppHandle,
    workspace_id: String,
    path: String,
    directory: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        move_entry(&trusted_root(&app, &workspace_id)?, &path, &directory)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn trash_workspace_entry(
    app: tauri::AppHandle,
    workspace_id: String,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = trusted_root(&app, &workspace_id)?;
        trash(&entry_inside(&root, &path)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the enclosing folder in Finder with the item selected.
#[tauri::command]
pub async fn reveal_workspace_entry(
    app: tauri::AppHandle,
    workspace_id: String,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = trusted_root(&app, &workspace_id)?;
        let entry = if path.is_empty() {
            root
        } else {
            entry_inside(&root, &path)?
        };
        let status = std::process::Command::new("open")
            .arg("-R")
            .arg(&entry)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Finder를 열지 못했습니다.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let p = std::env::temp_dir().join(format!("margin-workspace-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        fs::canonicalize(p).unwrap()
    }
    #[test]
    fn rejects_parent_and_absolute_paths() {
        let root = fixture();
        assert!(resolve_inside(&root, "../outside").is_err());
        assert!(resolve_inside(&root, "/tmp").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn allows_nested_unicode_paths() {
        let root = fixture();
        fs::create_dir(root.join("강의자료")).unwrap();
        fs::write(root.join("강의자료/강의.pdf"), b"%PDF-test").unwrap();
        assert_eq!(
            resolve_inside(&root, "강의자료/강의.pdf").unwrap(),
            root.join("강의자료/강의.pdf")
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn lists_only_directories_and_pdfs() {
        let root = fixture();
        fs::create_dir(root.join("강의")).unwrap();
        fs::write(root.join("a.PDF"), b"test").unwrap();
        fs::write(root.join("ignored.txt"), b"test").unwrap();
        fs::create_dir(root.join(".hidden")).unwrap();
        let items = directory_entries(&root, "").unwrap();
        assert_eq!(items.len(), 2);
        assert!(items[0].is_directory);
        assert_eq!(items[1].name, "a.PDF");
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_external_symlinks() {
        let root = fixture();
        let outside = fixture();
        fs::write(outside.join("outside.pdf"), b"test").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        assert!(resolve_inside(&root, "escape/outside.pdf").is_err());
        assert!(directory_entries(&root, "").unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
    #[test]
    fn renames_inside_and_keeps_pdf_extension() {
        let root = fixture();
        fs::create_dir(root.join("강의")).unwrap();
        fs::write(root.join("강의/a.pdf"), b"x").unwrap();
        fs::write(root.join("강의/taken.pdf"), b"x").unwrap();
        assert_eq!(rename_entry(&root, "강의/a.pdf", "1주차").unwrap(), "강의/1주차.pdf");
        assert!(root.join("강의/1주차.pdf").is_file());
        assert!(rename_entry(&root, "강의/1주차.pdf", "taken").is_err());
        assert!(rename_entry(&root, "강의/1주차.pdf", "../out").is_err());
        assert!(rename_entry(&root, "강의/1주차.pdf", ".hidden").is_err());
        assert!(rename_entry(&root, "", "x").is_err());
        assert!(rename_entry(&root, "../강의", "x").is_err());
        assert_eq!(rename_entry(&root, "강의", "자료").unwrap(), "자료");
        assert!(root.join("자료/1주차.pdf").is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn moves_inside_without_overwriting_or_nesting() {
        let root = fixture();
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::create_dir(root.join("c")).unwrap();
        fs::write(root.join("a/x.pdf"), b"x").unwrap();
        fs::write(root.join("c/x.pdf"), b"x").unwrap();
        assert!(move_entry(&root, "a/x.pdf", "c").is_err());
        assert_eq!(move_entry(&root, "a/x.pdf", "a/b").unwrap(), "a/b/x.pdf");
        assert_eq!(move_entry(&root, "a/b/x.pdf", "").unwrap(), "x.pdf");
        assert!(move_entry(&root, "a", "a/b").is_err());
        assert!(move_entry(&root, "x.pdf", "..").is_err());
        assert_eq!(move_entry(&root, "a", "c").unwrap(), "c/a");
        assert!(root.join("c/a/b").is_dir());
        fs::remove_dir_all(root).unwrap();
    }
    /// Puts a real file in the user's Trash; run with `cargo test -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn trashes_entries() {
        let root = fixture();
        fs::write(root.join("trash-me.pdf"), b"x").unwrap();
        trash(&entry_inside(&root, "trash-me.pdf").unwrap()).unwrap();
        assert!(!root.join("trash-me.pdf").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
