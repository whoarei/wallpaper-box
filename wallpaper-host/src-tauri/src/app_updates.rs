//! Program updates: bounded HTTPS downloads, signed-version validation and
//! explicit installation. Wallpaper-content updates remain independent.
use crate::catalog;
use crate::network::{self, ProxySettings};
use chrono::Local;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const ENDPOINT: &str =
    "https://github.com/whoarei/wallpaper-box/releases/latest/download/latest.json";
const MAX_MANIFEST: u64 = 1024 * 1024;
const MAX_INSTALLER: u64 = 128 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct View {
    pub phase: String,
    pub current_version: &'static str,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub received: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    pub last_checked_at: u64,
}
impl Default for View {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            current_version: catalog::APP_VERSION,
            version: None,
            notes: None,
            received: 0,
            total: None,
            error: None,
            last_checked_at: 0,
        }
    }
}
#[derive(Default, Serialize, Deserialize)]
struct Schedule {
    last_checked_at: u64,
    day: String,
}
struct Data {
    view: View,
    schedule: Schedule,
    candidate: Option<Update>,
    installer: Option<PathBuf>,
}
pub struct Updates {
    data: Mutex<Data>,
    busy: AtomicBool,
    root: PathBuf,
}
impl Updates {
    pub fn new(root: PathBuf) -> Self {
        let schedule: Schedule = fs::read(root.join("schedule.json"))
            .ok()
            .filter(|b| b.len() <= 4096)
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let view = View {
            last_checked_at: schedule.last_checked_at,
            ..View::default()
        };
        Self {
            data: Mutex::new(Data {
                view,
                schedule,
                candidate: None,
                installer: None,
            }),
            busy: AtomicBool::new(false),
            root,
        }
    }
    pub fn view(&self) -> View {
        self.data.lock().unwrap().view.clone()
    }
    fn begin(&self) -> Result<Busy<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "正在处理程序更新，请稍后再试。")?;
        Ok(Busy(&self.busy))
    }
    fn fail(&self, message: &str) {
        let mut data = self.data.lock().unwrap();
        data.view.phase = if data.installer.is_some() {
            "ready"
        } else {
            "error"
        }
        .into();
        data.view.error = Some(message.into());
    }
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}
fn daily_due(day: &str, current_day: &str) -> bool {
    day != current_day
}

fn fetch(
    proxy: &ProxySettings,
    address: &str,
    maximum: u64,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<Vec<u8>, String> {
    let response = network::github_client(proxy)?
        .get(address)
        .send()
        .map_err(|e| format!("程序更新连接失败：{}", e.without_url()))?;
    if address == ENDPOINT && response.status().as_u16() == 404 {
        return Err("在线升级清单尚未发布，可稍后再检查。".into());
    }
    let mut response = response
        .error_for_status()
        .map_err(|e| format!("程序更新连接失败：{}", e.without_url()))?;
    let length = response.content_length();
    if length.is_some_and(|n| n > maximum) {
        return Err("程序更新文件超过大小限制。".into());
    }
    let mut bytes = Vec::new();
    let mut chunk = [0; 32 * 1024];
    loop {
        let n = response
            .read(&mut chunk)
            .map_err(|_| "程序更新下载中断，请重试。")?;
        if n == 0 {
            break;
        }
        if bytes.len() as u64 + n as u64 > maximum {
            return Err("程序更新文件超过大小限制。".into());
        }
        bytes.extend_from_slice(&chunk[..n]);
        progress(bytes.len() as u64, length);
    }
    if length.is_some_and(|n| n != bytes.len() as u64) {
        return Err("程序更新文件未下载完整。".into());
    }
    Ok(bytes)
}

fn validate_manifest(json: &Value) -> Result<(), String> {
    let raw = json
        .get("version")
        .and_then(Value::as_str)
        .ok_or("程序版本清单缺少版本。")?;
    if raw.len() > 64 {
        return Err("程序版本无效。".into());
    }
    let version = semver::Version::parse(raw.strip_prefix('v').unwrap_or(raw))
        .map_err(|_| "程序版本无效。")?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err("自动升级仅支持正式版本。".into());
    }
    let platforms = json
        .get("platforms")
        .and_then(Value::as_object)
        .ok_or("程序更新清单缺少平台。")?;
    if platforms.len() != 1 || !platforms.contains_key("windows-x86_64") {
        return Err("程序更新清单平台无效。".into());
    }
    let item = &platforms["windows-x86_64"];
    let url = Url::parse(
        item.get("url")
            .and_then(Value::as_str)
            .ok_or("缺少安装包地址。")?,
    )
    .map_err(|_| "安装包地址无效。")?;
    let expected = format!(
        "/whoarei/wallpaper-box/releases/download/v{version}/wallpaper-box_{version}_x64-setup.exe"
    );
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.path() != expected
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("安装包必须来自官方程序仓库的对应正式版本。".into());
    }
    let signature = item
        .get("signature")
        .and_then(Value::as_str)
        .ok_or("缺少程序更新签名。")?;
    if signature.is_empty() || signature.len() > 4096 {
        return Err("程序更新签名无效。".into());
    }
    if let Some(size) = item.get("size") {
        if size.as_u64().is_none_or(|n| n == 0 || n > MAX_INSTALLER) {
            return Err("安装包大小无效。".into());
        }
    }
    if json
        .get("notes")
        .and_then(Value::as_str)
        .is_some_and(|notes| notes.len() > 128 * 1024)
    {
        return Err("更新说明过长。".into());
    }
    Ok(())
}
fn restore(app: &AppHandle, json: Value) -> Result<Option<Update>, String> {
    validate_manifest(&json)?;
    // Cache restore enforces signed-version verification too. Keep windows alive
    // if launching the installer fails; the plugin exits only after success.
    app.updater_builder()
        .on_before_exit(|| {})
        .build()
        .map_err(|e| e.to_string())?
        .restore_update(json)
        .map_err(|e| format!("程序更新清单无效：{e}"))
}
fn candidate_view(data: &mut Data, candidate: &Update) {
    data.view.version = Some(candidate.version.clone());
    data.view.notes = candidate.body.clone();
}
fn cached_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if fs::metadata(path)
        .map_err(|_| "已下载的安装包不存在，请重新下载。")?
        .len()
        > MAX_INSTALLER
    {
        return Err("安装包大小无效。".into());
    }
    fs::read(path).map_err(|_| "无法读取已下载的安装包。".into())
}
fn restore_cache(app: &AppHandle) -> Result<(), String> {
    let updater = app.state::<Updates>();
    let path = updater.root.join("pending.json");
    if !path.is_file() {
        return Ok(());
    }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_MANIFEST {
        return Err("缓存的程序更新清单过大。".into());
    }
    let json: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if let Some(candidate) = restore(app, json)? {
        let installer = updater
            .root
            .join(format!("wallpaper-box_{}_x64-setup.exe", candidate.version));
        let bytes = cached_bytes(&installer)?;
        candidate
            .verify(&bytes)
            .map_err(|_| "缓存安装包校验失败，请重新下载。")?;
        let mut data = updater.data.lock().unwrap();
        candidate_view(&mut data, &candidate);
        data.view.phase = "ready".into();
        data.view.received = bytes.len() as u64;
        data.view.total = Some(bytes.len() as u64);
        data.candidate = Some(candidate);
        data.installer = Some(installer);
    }
    Ok(())
}
pub fn check(app: &AppHandle) -> Result<(), String> {
    let updater = app.state::<Updates>();
    let _busy = updater.begin()?;
    {
        let mut data = updater.data.lock().unwrap();
        data.schedule = Schedule {
            last_checked_at: now(),
            day: today(),
        };
        data.view.last_checked_at = data.schedule.last_checked_at;
        data.view.phase = "checking".into();
        data.view.error = None;
        // Count attempts too: offline checks must not turn into a retry loop.
        let _ = catalog::atomic_json(&updater.root.join("schedule.json"), &data.schedule);
    }
    let result = (|| {
        let proxy = crate::host::proxy_settings(app);
        let bytes = fetch(&proxy, ENDPOINT, MAX_MANIFEST, |_, _| {})?;
        let json: Value = serde_json::from_slice(&bytes).map_err(|_| "无法读取程序更新清单。")?;
        let candidate = restore(app, json)?;
        if let Some(candidate) = candidate {
            {
                let mut data = updater.data.lock().unwrap();
                candidate_view(&mut data, &candidate);
                data.candidate = Some(candidate.clone());
                data.installer = None;
            }
            download_inner(app, &candidate)
        } else {
            let mut data = updater.data.lock().unwrap();
            data.view.phase = "up_to_date".into();
            data.view.version = None;
            data.view.notes = None;
            data.candidate = None;
            data.installer = None;
            Ok(())
        }
    })();
    if let Err(message) = &result {
        updater.fail(message);
    }
    result
}
fn download_inner(app: &AppHandle, candidate: &Update) -> Result<(), String> {
    let updater = app.state::<Updates>();
    let installer = updater
        .root
        .join(format!("wallpaper-box_{}_x64-setup.exe", candidate.version));
    // Reuse a verified cached download; never silently execute it.
    if let Ok(bytes) = cached_bytes(&installer) {
        if candidate.verify(&bytes).is_ok() {
            catalog::atomic_json(&updater.root.join("pending.json"), &candidate.raw_json)?;
            let mut data = updater.data.lock().unwrap();
            data.view.phase = "ready".into();
            data.view.error = None;
            data.view.received = bytes.len() as u64;
            data.view.total = Some(bytes.len() as u64);
            data.installer = Some(installer);
            return Ok(());
        }
    }
    {
        let mut data = updater.data.lock().unwrap();
        data.view.phase = "downloading".into();
        data.view.error = None;
        data.view.received = 0;
        data.view.total = None;
    }
    let proxy = crate::host::proxy_settings(app);
    let bytes = fetch(
        &proxy,
        candidate.download_url.as_str(),
        MAX_INSTALLER,
        |received, total| {
            let mut data = updater.data.lock().unwrap();
            data.view.received = received;
            data.view.total = total;
        },
    )?;
    if candidate.raw_json["platforms"]["windows-x86_64"]["size"]
        .as_u64()
        .is_some_and(|size| size != bytes.len() as u64)
    {
        return Err("安装包大小与清单不符。".into());
    }
    candidate
        .verify(&bytes)
        .map_err(|_| "安装包签名或版本校验失败，已拒绝此更新。".to_string())?;
    fs::create_dir_all(&updater.root).map_err(|e| e.to_string())?;
    let temporary = updater.root.join("installer.part");
    let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&temporary, &installer).map_err(|e| e.to_string())?;
    catalog::atomic_json(&updater.root.join("pending.json"), &candidate.raw_json)?;
    let mut data = updater.data.lock().unwrap();
    data.view.phase = "ready".into();
    data.view.error = None;
    data.installer = Some(installer);
    Ok(())
}
pub fn download(app: &AppHandle) -> Result<(), String> {
    let updater = app.state::<Updates>();
    let _busy = updater.begin()?;
    let candidate = updater
        .data
        .lock()
        .unwrap()
        .candidate
        .clone()
        .ok_or("请先检查程序更新。")?;
    let result = download_inner(app, &candidate);
    if let Err(message) = &result {
        updater.fail(message);
    }
    result
}
pub fn install(app: &AppHandle, confirmed: bool, expected_version: &str) -> Result<(), String> {
    if !confirmed {
        return Err("请先确认重启并升级程序。".into());
    }
    let updater = app.state::<Updates>();
    let _busy = updater.begin()?;
    let (candidate, path) = {
        let data = updater.data.lock().unwrap();
        if data.view.phase != "ready" {
            return Err("请等待程序更新下载并校验完成。".into());
        }
        if data.view.version.as_deref() != Some(expected_version) {
            return Err("更新版本已变化，请重新确认。".into());
        }
        (
            data.candidate.clone().ok_or("请先检查程序更新。")?,
            data.installer.clone().ok_or("请先下载程序更新。")?,
        )
    };
    let result = (|| {
        let bytes = match cached_bytes(&path).and_then(|bytes| {
            candidate
                .verify(&bytes)
                .map_err(|_| "安装包校验失败，请重新下载。".to_string())?;
            Ok(bytes)
        }) {
            Ok(bytes) => bytes,
            Err(message) => {
                updater.data.lock().unwrap().installer = None;
                return Err(message);
            }
        };
        updater.data.lock().unwrap().view.phase = "installing".into();
        // Called only by the explicit, manager-authorized install command.
        candidate
            .install(&bytes)
            .map_err(|e| format!("无法启动程序升级：{e}"))
    })();
    if let Err(message) = &result {
        updater.fail(message);
    }
    result
}
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        {
            let updater = app.state::<Updates>();
            // Startup cache restore participates in the same operation lock as
            // user checks/downloads, so it cannot replace a newer candidate.
            if let Ok(_busy) = updater.begin() {
                if let Err(message) = restore_cache(&app) {
                    updater.fail(&message);
                }
            };
        }
        std::thread::sleep(Duration::from_secs(5));
        let _ = check(&app); // Once for every launch, including same-day restarts.
        loop {
            std::thread::sleep(Duration::from_secs(60));
            let due = daily_due(
                &app.state::<Updates>().data.lock().unwrap().schedule.day,
                &today(),
            );
            if due {
                let _ = check(&app);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> Value {
        serde_json::json!({"version":"0.3.1","platforms":{"windows-x86_64":{"url":"https://github.com/whoarei/wallpaper-box/releases/download/v0.3.1/wallpaper-box_0.3.1_x64-setup.exe","signature":"test-signature"}}})
    }
    #[test]
    fn program_updates_reject_other_repositories_versions_platforms_and_sizes() {
        let valid = manifest();
        assert!(validate_manifest(&valid).is_ok());
        for url in ["http://github.com/whoarei/wallpaper-box/releases/download/v0.3.1/wallpaper-box_0.3.1_x64-setup.exe", "https://github.com/whoarei/wallpapers/releases/download/v0.3.1/wallpaper-box_0.3.1_x64-setup.exe", "https://github.com/whoarei/wallpaper-box/releases/download/v0.3.0/wallpaper-box_0.3.0_x64-setup.exe", "https://github.com.evil.test/whoarei/wallpaper-box/releases/download/v0.3.1/wallpaper-box_0.3.1_x64-setup.exe"] {
            let mut bad = valid.clone(); bad["platforms"]["windows-x86_64"]["url"] = url.into(); assert!(validate_manifest(&bad).is_err());
        }
        let mut bad = valid.clone();
        bad["platforms"]["windows-x86_64"]["size"] = (MAX_INSTALLER + 1).into();
        assert!(validate_manifest(&bad).is_err());
        let mut bad = valid.clone();
        bad["platforms"]["windows-x86_64-portable"] = valid["platforms"]["windows-x86_64"].clone();
        assert!(validate_manifest(&bad).is_err());
        let mut bad = valid;
        bad["version"] = "0.3.1-rc.1".into();
        assert!(validate_manifest(&bad).is_err());
    }
    #[test]
    fn failed_attempts_count_for_the_day_and_a_new_day_is_due() {
        let schedule = Schedule {
            last_checked_at: 1,
            day: "2026-11-11".into(),
        };
        assert!(!daily_due(&schedule.day, "2026-11-11"));
        assert!(daily_due(&schedule.day, "2026-11-12"));
        let bytes = serde_json::to_vec(&schedule).unwrap();
        let restored: Schedule = serde_json::from_slice(&bytes).unwrap();
        assert!(!daily_due(&restored.day, "2026-11-11"));
    }
    #[test]
    fn program_update_operations_are_serialized_without_blocking_wallpaper_state() {
        let temp = tempfile::tempdir().unwrap();
        let updates = Updates::new(temp.path().into());
        {
            let _first = updates.begin().unwrap();
            assert!(updates.begin().is_err());
            assert_eq!(updates.view().phase, "idle");
        }
        assert!(updates.begin().is_ok());
    }
}
