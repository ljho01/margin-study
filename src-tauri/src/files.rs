use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{ipc::InvokeBody, Manager};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Target {
    #[serde(rename_all = "camelCase")]
    Workspace {
        workspace_id: String,
        path: String,
    },
    Path {
        path: String,
    },
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map(|v| v.into_owned())
        .map_err(|e| e.to_string())
}

fn body(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(data) => Ok(data.clone()),
        _ => Err("잘못된 요청입니다.".into()),
    }
}

pub fn sha256(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn is_pdf(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

/// Replaces the file through a sibling temporary file so a failed write never
/// leaves a partial PDF. With an expected hash, the current file must still
/// match the version that was opened.
pub fn atomic_write(path: &Path, data: &[u8], expected: Option<&str>) -> Result<(), String> {
    if !is_pdf(path) {
        return Err("PDF 파일로만 저장할 수 있습니다.".into());
    }
    if !data.starts_with(b"%PDF-") {
        return Err("올바른 PDF가 아닙니다.".into());
    }
    let existing = path.exists();
    if let Some(expected) = expected {
        let current = fs::read(path).map_err(|_| "원본 파일을 찾을 수 없습니다.".to_string())?;
        if sha256(&current) != expected {
            return Err("다른 곳에서 파일이 변경되었습니다. 다시 연 뒤 저장해 주세요.".into());
        }
    }
    let parent = path.parent().ok_or("저장 경로 오류")?;
    let name = path.file_name().ok_or("저장 경로 오류")?.to_string_lossy();
    let temporary = parent.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(data).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        if existing {
            if let Ok(meta) = fs::metadata(path) {
                let _ = fs::set_permissions(&temporary, meta.permissions());
            }
        }
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn save_pdf(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let data = body(&request)?;
    let target: Target = serde_json::from_str(&header(&request, "x-target")?)
        .map_err(|_| "저장 위치가 올바르지 않습니다.".to_string())?;
    let expected = header(&request, "x-expected")?;
    let expected = (!expected.is_empty()).then_some(expected);
    tauri::async_runtime::spawn_blocking(move || {
        let path = match target {
            Target::Workspace { workspace_id, path } => {
                crate::workspace::resolve_trusted_file(&app, &workspace_id, &path)?
            }
            Target::Path { path } => {
                let path = PathBuf::from(path);
                if !path.is_absolute() {
                    return Err("저장 경로가 올바르지 않습니다.".to_string());
                }
                path
            }
        };
        atomic_write(&path, &data, expected.as_deref())?;
        Ok(sha256(&data))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn ocr_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("MARGIN_OCR_BINARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("bin/margin-ocr"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/margin-ocr"));
    candidates.into_iter().find(|p| p.is_file())
}

/// Recognizes text lines in a page image with the macOS Vision framework.
#[tauri::command]
pub async fn ocr_page(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Value, String> {
    let image = body(&request)?;
    if !image.starts_with(b"\x89PNG") {
        return Err("올바른 이미지가 아닙니다.".into());
    }
    let binary = ocr_binary(&app).ok_or("텍스트 인식 도구를 찾을 수 없습니다.")?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("ocr");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let input = directory.join(format!("{}.png", uuid::Uuid::new_v4()));
    fs::write(&input, image).map_err(|e| e.to_string())?;
    let run = tokio::process::Command::new(binary)
        .arg(&input)
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(Duration::from_secs(90), run).await;
    let _ = fs::remove_file(&input);
    let output = output
        .map_err(|_| "텍스트 인식 시간이 초과되었습니다.".to_string())?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("텍스트를 인식하지 못했습니다.".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!("margin-files-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn replaces_file_when_version_matches() {
        let d = dir();
        let f = d.join("강의.pdf");
        fs::write(&f, b"%PDF-old").unwrap();
        atomic_write(&f, b"%PDF-new", Some(&sha256(b"%PDF-old"))).unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"%PDF-new");
        assert_eq!(fs::read_dir(&d).unwrap().count(), 1);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn rejects_external_changes_and_non_pdf() {
        let d = dir();
        let f = d.join("a.pdf");
        fs::write(&f, b"%PDF-changed").unwrap();
        assert!(atomic_write(&f, b"%PDF-new", Some(&sha256(b"%PDF-old"))).is_err());
        assert_eq!(fs::read(&f).unwrap(), b"%PDF-changed");
        assert!(atomic_write(&d.join("a.txt"), b"%PDF-new", None).is_err());
        assert!(atomic_write(&f, b"not pdf", None).is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
