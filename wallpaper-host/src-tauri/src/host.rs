mod commands;
mod download_workers;
use crate::{
    catalog::{self, Module},
    desktop::{self, Attachment, Display},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const WALLPAPER_SCRIPT: &str = include_str!("../wallpaper-mode.js");
const AQUARIUM_FEED_SCRIPT: &str = include_str!("../aquarium-feed.js");
static NEXT_SURFACE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Selection {
    module_id: String,
    #[serde(default)]
    paused: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Settings {
    selected_monitor: String,
    assignments: BTreeMap<String, Selection>,
    #[serde(default = "yes")]
    auto_pause: bool,
}
fn yes() -> bool {
    true
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            selected_monitor: String::new(),
            assignments: BTreeMap::new(),
            auto_pause: true,
        }
    }
}

#[derive(Clone, Debug)]
struct Running {
    generation: u64,
    desktop_clicks: u64,
    z_order_repairs: u64,
    label: String,
    module_root: PathBuf,
    proof: Attachment,
    auto_paused: bool,
    effective_paused: bool,
}
struct Data {
    settings: Settings,
    modules: Vec<Module>,
    online: crate::online::State,
    warnings: Vec<String>,
    resource_scopes: BTreeMap<String, String>,
    last_error: Option<String>,
    running: BTreeMap<String, Running>,
}
pub struct Host {
    data: Mutex<Data>,
    operations: Mutex<()>,
    updates: Mutex<()>,
    catalog_check: Mutex<()>,
    downloads: Arc<crate::download_queue::Queue<crate::online::RemoteWallpaper>>,
    library: catalog::Library,
    dir: PathBuf,
    exiting: AtomicBool,
}

#[derive(Clone, Serialize)]
struct DownloadView {
    id: String,
    item: crate::online::RemoteWallpaper,
    phase: &'static str,
    received: u64,
    total: u64,
    speed: u64,
    error: Option<String>,
    queue_position: Option<usize>,
}

#[derive(Serialize)]
pub struct WallpaperView {
    display_id: String,
    module_id: String,
    name: String,
    paused: bool,
    auto_paused: bool,
    desktop_clicks: u64,
    z_order_repairs: u64,
    proof: Attachment,
}
#[derive(Serialize)]
pub struct View {
    version: &'static str,
    app_update: crate::app_updates::View,
    service: &'static str,
    online: crate::online::State,
    online_repository: &'static str,
    user_directory: String,
    warnings: Vec<String>,
    downloads: Vec<DownloadView>,
    selected_monitor: String,
    displays: Vec<Display>,
    modules: Vec<Module>,
    wallpapers: Vec<WallpaperView>,
    auto_pause: bool,
    last_error: Option<String>,
}

fn display_path(path: &std::path::Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
    }
}

fn label(id: &str) -> String {
    format!(
        "wallpaper-{}",
        id.chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_lowercase()
    )
}
fn save(app: &AppHandle) {
    let host = app.state::<Host>();
    let result = {
        let data = host.data.lock().unwrap();
        // Serialize the latest settings while holding their lock. Concurrent
        // commands cannot overwrite a newer snapshot or share a temporary file.
        catalog::atomic_json(&host.dir.join("settings.json"), &data.settings)
    };
    if let Err(error) = result {
        log(app, &format!("Save settings: {error}"));
    }
}
fn log(app: &AppHandle, message: &str) {
    use std::io::Write;
    let host = app.state::<Host>();
    let file = host.dir.join("host.log");
    if fs::metadata(&file)
        .map(|m| m.len() > 1024 * 1024)
        .unwrap_or(false)
    {
        let _ = fs::write(&file, "");
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(file, "{:?} {message}", std::time::SystemTime::now());
    }
}
fn error(app: &AppHandle, message: String) {
    log(app, &message);
    app.state::<Host>().data.lock().unwrap().last_error = Some(message);
    let _ = app.emit("host-updated", ());
}
fn show_manager(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("manager") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn snapshot(app: &AppHandle) -> View {
    let host = app.state::<Host>();
    let downloads = host
        .downloads
        .snapshot()
        .into_iter()
        .map(|task| DownloadView {
            id: task.id,
            item: task.item,
            phase: task.phase.as_str(),
            received: task.received,
            total: task.total,
            speed: task.speed,
            error: task.error,
            queue_position: task.queue_position,
        })
        .collect();
    let data = host.data.lock().unwrap();
    let wallpapers = data
        .running
        .iter()
        .filter_map(|(id, running)| {
            let selection = data.settings.assignments.get(id)?;
            let name = data
                .modules
                .iter()
                .find(|m| m.id == selection.module_id)
                .map(|m| m.name.clone())
                .unwrap_or_else(|| selection.module_id.clone());
            let mut proof = desktop::inspect(running.proof.hwnd as isize);
            proof.method = running.proof.method.clone();
            Some(WallpaperView {
                display_id: id.clone(),
                module_id: selection.module_id.clone(),
                name,
                paused: selection.paused,
                auto_paused: running.auto_paused,
                desktop_clicks: running.desktop_clicks,
                z_order_repairs: running.z_order_repairs,
                proof,
            })
        })
        .collect();
    View {
        version: env!("CARGO_PKG_VERSION"),
        app_update: app.state::<crate::app_updates::Updates>().view(),
        service: catalog::ORIGIN,
        online: data.online.clone(),
        online_repository: crate::online::REPOSITORY,
        user_directory: display_path(&host.library.user.join("local")),
        warnings: data.warnings.clone(),
        downloads,
        selected_monitor: data.settings.selected_monitor.clone(),
        displays: desktop::displays(),
        modules: data.modules.clone(),
        wallpapers,
        auto_pause: data.settings.auto_pause,
        last_error: data.last_error.clone(),
    }
}
fn diagnostics(app: &AppHandle) {
    let view = snapshot(app);
    let host = app.state::<Host>();
    if let Ok(bytes) = serde_json::to_vec_pretty(&view) {
        let _ = fs::write(host.dir.join("diagnostics.json"), bytes);
    }
}

fn refresh(app: &AppHandle) -> Result<(), String> {
    let host = app.state::<Host>();
    let (modules, warnings) = host.library.discover();
    let changed = {
        let mut data = host.data.lock().unwrap();
        let changed = data.modules != modules;
        data.modules = modules;
        data.warnings = warnings;
        changed
    };
    if changed {
        rebuild_tray(app);
    }
    let _ = app.emit("host-updated", ());
    Ok(())
}

fn preview(app: &AppHandle, module_id: &str) -> Result<(), String> {
    let host = app.state::<Host>();
    let _operation = host.operations.lock().unwrap();
    let module = host
        .data
        .lock()
        .unwrap()
        .modules
        .iter()
        .find(|module| module.id == module_id)
        .cloned()
        .ok_or("该壁纸已移除，请刷新列表。")?;
    let url = format!("{}{}", catalog::ORIGIN, module.href)
        .parse()
        .map_err(|error| format!("壁纸地址错误：{error}"))?;
    let profile = host.dir.join("webview").join("preview");
    fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
    // Only one live preview is needed. It never enters the desktop assignments
    // or running surfaces, and receives no manager IPC capability.
    for (label, window) in app.webview_windows() {
        if label.starts_with("preview-") {
            window.destroy().map_err(|error| error.to_string())?;
        }
    }
    let label = format!("preview-{}", NEXT_SURFACE.fetch_add(1, Ordering::Relaxed));
    host.data
        .lock()
        .unwrap()
        .resource_scopes
        .insert(label.clone(), module_id.into());
    let result = WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(url))
        .title(format!("预览 · {}", module.name))
        .inner_size(960.0, 600.0)
        .min_inner_size(640.0, 400.0)
        .center()
        .data_directory(profile)
        .on_navigation(|url| {
            url.scheme() == "http"
                && url.host_str() == Some("wallpaper.localhost")
                && url.port().is_none()
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build();
    if let Err(error) = result {
        host.data.lock().unwrap().resource_scopes.remove(&label);
        return Err(format!("打开预览失败：{error}"));
    }
    Ok(())
}

fn apply_inner(app: &AppHandle, monitor_id: &str, module_id: &str) -> Result<(), String> {
    let display = desktop::displays()
        .into_iter()
        .find(|d| d.id == monitor_id)
        .ok_or("所选显示器已断开连接。")?;
    let host = app.state::<Host>();
    let module = host
        .data
        .lock()
        .unwrap()
        .modules
        .iter()
        .find(|m| m.id == module_id)
        .cloned()
        .ok_or("该壁纸已从模块目录移除，请刷新列表。")?;
    let url = format!("{}{}", catalog::ORIGIN, module.href)
        .parse()
        .map_err(|e| format!("壁纸地址错误：{e}"))?;
    let window_label = label(monitor_id);
    host.data
        .lock()
        .unwrap()
        .resource_scopes
        .insert(window_label.clone(), module_id.into());
    let window = if let Some(window) = app.get_webview_window(&window_label) {
        window.navigate(url).map_err(|e| e.to_string())?;
        window
    } else {
        let profile = host.dir.join("webview").join(&window_label);
        let _ = fs::create_dir_all(&profile);
        WebviewWindowBuilder::new(app, &window_label, WebviewUrl::CustomProtocol(url))
            .title(format!("壁纸盒子 · {} · {}", module.name, display.name))
            .inner_size(
                display.work_area.width as f64 / display.scale,
                display.work_area.height as f64 / display.scale,
            )
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .resizable(false)
            .visible(false)
            .data_directory(profile)
            .initialization_script(WALLPAPER_SCRIPT)
            .on_navigation(|url| {
                url.scheme() == "http"
                    && url.host_str() == Some("wallpaper.localhost")
                    && url.port().is_none()
            })
            .build()
            .map_err(|e| format!("创建壁纸窗口失败：{e}"))?
    };
    let handle = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let proof = match desktop::attach(handle, &display) {
        Ok(proof) => proof,
        Err(message) => {
            let _ = window.destroy();
            return Err(message);
        }
    };
    let _ = window.set_ignore_cursor_events(true);
    let covered = desktop::covering_window(&display, &[handle]).is_some();
    let effective;
    {
        let mut data = host.data.lock().unwrap();
        let paused = data
            .settings
            .assignments
            .get(monitor_id)
            .map(|s| s.paused)
            .unwrap_or(false);
        data.settings.assignments.insert(
            monitor_id.into(),
            Selection {
                module_id: module_id.into(),
                paused,
            },
        );
        let automatic = data.settings.auto_pause && covered;
        effective = paused || automatic;
        data.running.insert(
            monitor_id.into(),
            Running {
                generation: NEXT_SURFACE.fetch_add(1, Ordering::Relaxed),
                desktop_clicks: 0,
                z_order_repairs: 0,
                label: window_label,
                module_root: module.root.clone(),
                proof: proof.clone(),
                auto_paused: automatic,
                effective_paused: effective,
            },
        );
        data.last_error = None;
    }
    let _ = window.eval(format!("window.__SCREEN_GARDEN_SET_PAUSED?.({effective});"));
    // The initial script handles callbacks that are registered before navigation finishes.
    log(
        app,
        &format!("Applied {} to {}: {:?}", module.id, display.id, proof),
    );
    save(app);
    diagnostics(app);
    rebuild_tray(app);
    let _ = app.emit("host-updated", ());
    Ok(())
}
fn apply(app: &AppHandle, monitor_id: &str, module_id: &str) -> Result<(), String> {
    let host = app.state::<Host>();
    let _operation = host.operations.lock().unwrap();
    apply_inner(app, monitor_id, module_id)
}
fn input_surfaces(app: &AppHandle) -> Vec<crate::desktop_input::Surface> {
    let Some(host) = app.try_state::<Host>() else {
        return vec![];
    };
    if host.exiting.load(Ordering::Acquire) {
        return vec![];
    }
    let candidates: Vec<_> = {
        let data = host.data.lock().unwrap();
        data.running
            .iter()
            .filter_map(|(id, running)| {
                if data.settings.assignments.get(id)?.paused {
                    return None;
                }
                Some((running.generation, running.proof.hwnd as isize))
            })
            .collect()
    };
    candidates
        .into_iter()
        .filter_map(|(generation, hwnd)| {
            let proof = desktop::inspect(hwnd);
            if !proof.attached {
                return None;
            }
            Some(crate::desktop_input::Surface {
                generation,
                hwnd,
                x: proof.x,
                y: proof.y,
                width: proof.width,
                height: proof.height,
            })
        })
        .collect()
}
fn relay_desktop_click(app: &AppHandle, click: crate::desktop_input::Click) {
    let Some(host) = app.try_state::<Host>() else {
        return;
    };
    let Ok(_operation) = host.operations.try_lock() else {
        return;
    };
    if !input_surfaces(app).contains(&click.surface) {
        return;
    }
    let (display_id, module_id, window_label) = {
        let data = host.data.lock().unwrap();
        let Some((id, running)) = data
            .running
            .iter()
            .find(|(_, running)| running.generation == click.surface.generation)
        else {
            return;
        };
        let Some(selection) = data.settings.assignments.get(id) else {
            return;
        };
        (
            id.clone(),
            selection.module_id.clone(),
            running.label.clone(),
        )
    };
    let Some(window) = app.get_webview_window(&window_label) else {
        return;
    };
    let script = format!(
        "window.__SCREEN_GARDEN_DESKTOP_CLICK?.({}, {})",
        click.x, click.y
    );
    let handle = app.clone();
    let result = window.eval_with_callback(script, move |reply| {
        let Ok(receipt) = serde_json::from_str::<serde_json::Value>(&reply) else {
            return;
        };
        if receipt.get("delivered").and_then(|v| v.as_bool()) != Some(true) {
            return;
        }
        let Some(host) = handle.try_state::<Host>() else {
            return;
        };
        let matched = {
            let mut data = host.data.lock().unwrap();
            if let Some(running) = data
                .running
                .get_mut(&display_id)
                .filter(|r| r.generation == click.surface.generation)
            {
                running.desktop_clicks += 1;
                true
            } else {
                false
            }
        };
        if matched {
            log(
                &handle,
                &format!("Desktop click {module_id} on {display_id}: {receipt}"),
            );
        }
    });
    if let Err(message) = result {
        log(app, &format!("Desktop click delivery: {message}"));
    }
}
fn remove(app: &AppHandle, monitor_id: &str) {
    let host = app.state::<Host>();
    let _operation = host.operations.lock().unwrap();
    if let Some(window) = app.get_webview_window(&label(monitor_id)) {
        let _ = window.destroy();
    }
    {
        let mut data = host.data.lock().unwrap();
        data.running.remove(monitor_id);
        data.resource_scopes.remove(&label(monitor_id));
        data.settings.assignments.remove(monitor_id);
    }
    save(app);
    diagnostics(app);
    rebuild_tray(app);
    let _ = app.emit("host-updated", ());
}
fn set_paused(app: &AppHandle, monitor_id: Option<&str>, paused: bool) {
    let host = app.state::<Host>();
    let _operation = host.operations.lock().unwrap();
    let mut changes = vec![];
    {
        let mut data = host.data.lock().unwrap();
        let ids: Vec<_> = data
            .settings
            .assignments
            .keys()
            .filter(|id| monitor_id.map(|m| m == id.as_str()).unwrap_or(true))
            .cloned()
            .collect();
        for id in ids {
            if let Some(selection) = data.settings.assignments.get_mut(&id) {
                selection.paused = paused;
            }
            if let Some(running) = data.running.get_mut(&id) {
                let value = paused || running.auto_paused;
                running.effective_paused = value;
                changes.push((running.label.clone(), value));
            }
        }
    }
    for (label, paused) in changes {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.eval(format!("window.__SCREEN_GARDEN_SET_PAUSED?.({paused});"));
        }
    }
    save(app);
    diagnostics(app);
    rebuild_tray(app);
    let _ = app.emit("host-updated", ());
}

fn select(app: &AppHandle, id: &str) -> Result<(), String> {
    if !desktop::displays().iter().any(|d| d.id == id) {
        return Err("显示器已断开连接。".into());
    }
    app.state::<Host>()
        .data
        .lock()
        .unwrap()
        .settings
        .selected_monitor = id.into();
    save(app);
    rebuild_tray(app);
    let _ = app.emit("host-updated", ());
    Ok(())
}
fn set_auto(app: &AppHandle, enabled: bool) {
    app.state::<Host>().data.lock().unwrap().settings.auto_pause = enabled;
    save(app);
    rebuild_tray(app);
    let _ = app.emit("host-updated", ());
}
fn feed_aquarium(app: &AppHandle, monitor_id: &str) -> Result<(), String> {
    let host = app.state::<Host>();
    let _operation = host.operations.lock().unwrap();
    if !desktop::displays()
        .iter()
        .any(|display| display.id == monitor_id)
    {
        return Err("显示器已断开连接。".into());
    }
    let window_label = {
        let data = host.data.lock().unwrap();
        let selected = data
            .settings
            .assignments
            .get(monitor_id)
            .ok_or("该屏幕尚未设置壁纸。")?;
        if selected.module_id != "aquarium" {
            return Err("请先将当前屏幕切换到静水之间水族箱。".into());
        }
        if selected.paused {
            return Err("水族箱已暂停，请先继续播放。".into());
        }
        data.running
            .get(monitor_id)
            .ok_or("当前屏幕的水族箱尚未就绪。")?
            .label
            .clone()
    };
    let window = app
        .get_webview_window(&window_label)
        .ok_or("水族箱窗口尚未就绪。")?;
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    window
        .eval_with_callback(AQUARIUM_FEED_SCRIPT, move |reply| {
            let _ = send.try_send(reply);
        })
        .map_err(|e| format!("投喂未能送达水族箱：{e}"))?;
    let reply = receive
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "水族箱暂未响应，请稍后再试。")?;
    let result: serde_json::Value =
        serde_json::from_str(&reply).map_err(|_| "水族箱未确认投喂，请稍后再试。")?;
    if result.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err(result
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("水族箱未确认投喂，请稍后再试。")
            .to_string());
    }
    log(app, &format!("Fed aquarium on {monitor_id}: {result}"));
    Ok(())
}
fn quit(app: &AppHandle) {
    app.state::<Host>().exiting.store(true, Ordering::SeqCst);
    app.state::<Host>().downloads.close();
    if let Some(listener) = app.try_state::<crate::desktop_input::Listener>() {
        listener.stop();
    }
    for (label, window) in app.webview_windows() {
        if label.starts_with("wallpaper-") {
            let _ = window.destroy();
        }
    }
    app.exit(0);
}

fn rebuild_tray(app: &AppHandle) {
    let view = snapshot(app);
    let result = (|| -> tauri::Result<()> {
        let menu = Menu::new(app)?;
        let selected = view.displays.iter().find(|d| d.id == view.selected_monitor);
        menu.append(&MenuItem::with_id(
            app,
            "current-display",
            selected.map(|d| d.name.as_str()).unwrap_or("未选择显示器"),
            false,
            None::<&str>,
        )?)?;
        let screens = Submenu::with_id(app, "displays", "选择显示器", true)?;
        for display in &view.displays {
            screens.append(&CheckMenuItem::with_id(
                app,
                format!("display:{}", display.id),
                &display.name,
                true,
                display.id == view.selected_monitor,
                None::<&str>,
            )?)?;
        }
        menu.append(&screens)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        let current = view
            .wallpapers
            .iter()
            .find(|w| w.display_id == view.selected_monitor);
        for module in &view.modules {
            menu.append(&CheckMenuItem::with_id(
                app,
                format!("wallpaper:{}", module.id),
                &module.name,
                true,
                current.map(|w| w.module_id == module.id).unwrap_or(false),
                None::<&str>,
            )?)?;
        }
        if view.modules.is_empty() {
            menu.append(&MenuItem::with_id(
                app,
                "no-wallpapers",
                "暂无壁纸，打开管理窗口刷新",
                false,
                None::<&str>,
            )?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        if let Some(aquarium) = current.filter(|w| w.module_id == "aquarium") {
            menu.append(&MenuItem::with_id(
                app,
                "feed-aquarium",
                "投喂鱼儿",
                !aquarium.paused,
                None::<&str>,
            )?)?;
        }
        menu.append(&CheckMenuItem::with_id(
            app,
            "pause-current",
            "暂停当前壁纸",
            current.is_some(),
            current.map(|w| w.paused).unwrap_or(false),
            None::<&str>,
        )?)?;
        let all_paused = !view.wallpapers.is_empty() && view.wallpapers.iter().all(|w| w.paused);
        menu.append(&MenuItem::with_id(
            app,
            "pause-all",
            if all_paused {
                "继续全部壁纸"
            } else {
                "暂停全部壁纸"
            },
            !view.wallpapers.is_empty(),
            None::<&str>,
        )?)?;
        menu.append(&CheckMenuItem::with_id(
            app,
            "auto-pause",
            "遮挡时自动暂停",
            true,
            view.auto_pause,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "remove-current",
            "关闭当前屏幕壁纸",
            current.is_some(),
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(
            app,
            "show-desktop",
            "显示 / 还原桌面",
            true,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "open-manager",
            "打开壁纸管理",
            true,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "check-app-update",
            "检查程序更新",
            true,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "quit",
            "退出壁纸盒子",
            true,
            None::<&str>,
        )?)?;
        if let Some(tray) = app.tray_by_id("screen-garden") {
            tray.set_menu(Some(menu))?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        log(app, &format!("Tray menu: {error}"));
    }
}

fn tray_action(app: &AppHandle, id: &str) {
    if id == "open-manager" {
        show_manager(app);
        return;
    }
    let id = id.to_string();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let view = snapshot(&app);
        let result = if let Some(display) = id.strip_prefix("display:") {
            select(&app, display)
        } else if let Some(module) = id.strip_prefix("wallpaper:") {
            apply(&app, &view.selected_monitor, module)
        } else if id == "feed-aquarium" {
            feed_aquarium(&app, &view.selected_monitor)
        } else if id == "check-app-update" {
            show_manager(&app);
            let _ = crate::app_updates::check(&app);
            Ok(())
        } else {
            match id.as_str() {
                "pause-current" => {
                    let paused = view
                        .wallpapers
                        .iter()
                        .find(|w| w.display_id == view.selected_monitor)
                        .map(|w| w.paused)
                        .unwrap_or(false);
                    set_paused(&app, Some(&view.selected_monitor), !paused);
                }
                "pause-all" => {
                    let paused =
                        !view.wallpapers.is_empty() && view.wallpapers.iter().all(|w| w.paused);
                    set_paused(&app, None, !paused);
                }
                "auto-pause" => set_auto(&app, !view.auto_pause),
                "remove-current" => remove(&app, &view.selected_monitor),
                "show-desktop" => {
                    let _ = desktop::show_desktop();
                }
                "quit" => quit(&app),
                _ => {}
            }
            Ok(())
        };
        if let Err(message) = result {
            error(&app, message);
            show_manager(&app);
        }
    });
}

fn tray_image() -> tauri::image::Image<'static> {
    let mut rgba = vec![0u8; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let p = (y * 32 + x) * 4;
            let dx = x as f64 - 15.5;
            let dy = y as f64 - 15.5;
            if dx * dx + dy * dy < 225.0 {
                rgba[p..p + 4].copy_from_slice(&[61, 95, 74, 255]);
                let wave = 14.0 + (x as f64 * 0.38).sin() * 2.2;
                if x > 6
                    && x < 26
                    && ((y as f64 - wave).abs() < 1.2 || (y as f64 - wave - 5.5).abs() < 1.2)
                {
                    rgba[p..p + 4].copy_from_slice(&[235, 238, 203, 255]);
                }
            }
        }
    }
    tauri::image::Image::new_owned(rgba, 32, 32)
}

fn maintenance(app: AppHandle, first: bool) {
    let _ = refresh(&app);
    if first {
        if let Some(primary) = desktop::displays().into_iter().find(|d| d.primary) {
            let host = app.state::<Host>();
            let mut data = host.data.lock().unwrap();
            data.settings.selected_monitor = primary.id.clone();
            data.settings.assignments.insert(
                primary.id,
                Selection {
                    module_id: "aquarium".into(),
                    paused: false,
                },
            );
            drop(data);
            save(&app);
        }
    }
    let mut iteration = 0u64;
    let mut known_displays = Vec::new();
    loop {
        if app.state::<Host>().exiting.load(Ordering::SeqCst) {
            break;
        }
        if iteration > 0 {
            let _ = refresh(&app);
        }
        let displays = desktop::displays();
        let displays_changed = displays != known_displays;
        known_displays = displays.clone();
        let needs_selection = {
            let host = app.state::<Host>();
            let mut data = host.data.lock().unwrap();
            if !displays
                .iter()
                .any(|d| d.id == data.settings.selected_monitor)
            {
                data.settings.selected_monitor =
                    displays.first().map(|d| d.id.clone()).unwrap_or_default();
                true
            } else {
                false
            }
        };
        if needs_selection {
            save(&app);
        }
        if needs_selection || displays_changed {
            rebuild_tray(&app);
        }
        let desired = app
            .state::<Host>()
            .data
            .lock()
            .unwrap()
            .settings
            .assignments
            .clone();
        for (id, _) in desired {
            let Some(display) = displays.iter().find(|d| d.id == id) else {
                if let Some(window) = app.get_webview_window(&label(&id)) {
                    let _ = window.destroy();
                }
                app.state::<Host>().data.lock().unwrap().running.remove(&id);
                continue;
            };
            let host = app.state::<Host>();
            if let Ok(_operation) = host.operations.try_lock() {
                // Re-read after taking the operation lock so a recent tray
                // removal or pause cannot be undone by an older loop snapshot.
                let Some(selection) = host
                    .data
                    .lock()
                    .unwrap()
                    .settings
                    .assignments
                    .get(&id)
                    .cloned()
                else {
                    continue;
                };
                let current_module = host
                    .data
                    .lock()
                    .unwrap()
                    .modules
                    .iter()
                    .find(|m| m.id == selection.module_id)
                    .cloned();
                let Some(current_module) = current_module else {
                    if host
                        .data
                        .lock()
                        .unwrap()
                        .modules
                        .iter()
                        .any(|m| m.id == "aquarium")
                    {
                        if let Err(message) = apply_inner(&app, &id, "aquarium") {
                            error(&app, message);
                        }
                    }
                    continue;
                };
                let changed_root = host
                    .data
                    .lock()
                    .unwrap()
                    .running
                    .get(&id)
                    .is_some_and(|r| r.module_root != current_module.root);
                if changed_root {
                    if let Err(message) = apply_inner(&app, &id, &selection.module_id) {
                        error(&app, message);
                    }
                    continue;
                }
                if let Some(window) = app.get_webview_window(&label(&id)) {
                    if let Ok(handle) = window.hwnd() {
                        let raw = handle.0 as isize;
                        let repairs = desktop::maintain_z_order(raw);
                        if repairs != 0 {
                            if let Some(running) = host.data.lock().unwrap().running.get_mut(&id) {
                                running.z_order_repairs += repairs;
                            }
                            log(
                                &app,
                                &format!("Repaired desktop Z order {id}: {repairs} moves"),
                            );
                        }
                        let proof = desktop::inspect(raw);
                        let bounds = display.work_area;
                        if !proof.attached
                            || proof.x != bounds.x
                            || proof.y != bounds.y
                            || proof.width != bounds.width
                            || proof.height != bounds.height
                        {
                            match desktop::attach(raw, display) {
                                Ok(new_proof) => {
                                    if let Some(r) = host.data.lock().unwrap().running.get_mut(&id)
                                    {
                                        r.proof = new_proof;
                                    }
                                }
                                Err(message) => error(&app, message),
                            }
                        }
                        let ignore: Vec<_> = host
                            .data
                            .lock()
                            .unwrap()
                            .running
                            .values()
                            .map(|r| r.proof.hwnd as isize)
                            .collect();
                        // GetWindowTextW may synchronously query our manager's
                        // UI thread. Never hold its state lock during this call.
                        let cover = desktop::covering_window(display, &ignore);
                        let change = {
                            let mut data = host.data.lock().unwrap();
                            let auto = data.settings.auto_pause && cover.is_some();
                            let effective = selection.paused || auto;
                            data.running.get_mut(&id).map(|running| {
                                let auto_changed = auto != running.auto_paused;
                                running.effective_paused = effective;
                                running.auto_paused = auto;
                                (auto, effective, auto_changed)
                            })
                        };
                        if let Some((auto, effective, auto_changed)) = change {
                            if auto_changed {
                                log(
                                    &app,
                                    &format!("Auto pause {id} = {auto}; covering={cover:?}"),
                                );
                            }
                            let _ = window
                                .eval(format!("window.__SCREEN_GARDEN_SET_PAUSED?.({effective});"));
                        }
                    }
                } else if let Err(message) = apply_inner(&app, &id, &selection.module_id) {
                    error(&app, message);
                }
            };
        }
        diagnostics(&app);
        iteration += 1;
        std::thread::sleep(Duration::from_secs(2));
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("wallpaper", |context, request, responder| {
            let app = context.app_handle().clone();
            let window_label = context.webview_label().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                let Some(host) = app.try_state::<Host>() else {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(503)
                            .body(Vec::<u8>::new())
                            .unwrap(),
                    );
                    return;
                };
                let (modules, scope) = {
                    let data = host.data.lock().unwrap();
                    (
                        data.modules.clone(),
                        data.resource_scopes.get(&window_label).cloned(),
                    )
                };
                if window_label != "manager" && scope.is_none() {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(403)
                            .body(Vec::<u8>::new())
                            .unwrap(),
                    );
                    return;
                }
                responder.respond(crate::protocol::serve(&modules, scope.as_deref(), request));
            });
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_manager(app)
        }))
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::check_app_update,
            commands::download_app_update,
            commands::install_app_update,
            commands::refresh_modules,
            commands::select_monitor,
            commands::apply_wallpaper,
            commands::preview_wallpaper,
            commands::pause_wallpaper,
            commands::feed_aquarium,
            commands::remove_wallpaper,
            commands::auto_pause,
            commands::hide_manager,
            commands::quit_app,
            commands::capture_desktop,
            commands::show_desktop,
            commands::check_online,
            commands::install_online,
            commands::download_action,
            commands::rollback_wallpaper,
            commands::import_wallpaper,
            commands::open_wallpaper_folder,
        ])
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let resources = app.path().resource_dir()?;
            let builtin = if resources.join("wallpapers").is_dir() {
                resources.join("wallpapers")
            } else {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../wallpapers")
            };
            let user = app.path().local_data_dir()?.join("WallpaperBox/wallpapers");
            let library =
                catalog::Library::prepare(builtin, user).map_err(std::io::Error::other)?;
            let online = crate::online::load_cache(&dir);
            app.manage(crate::app_updates::Updates::new(dir.join("app-updates")));
            let settings_path = dir.join("settings.json");
            let first = !settings_path.exists();
            let mut settings: Settings = fs::read(&settings_path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            let displays = desktop::displays();
            if !displays.iter().any(|d| d.id == settings.selected_monitor) {
                settings.selected_monitor =
                    displays.first().map(|d| d.id.clone()).unwrap_or_default();
            }
            app.manage(Host {
                data: Mutex::new(Data {
                    settings,
                    modules: vec![],
                    online,
                    warnings: vec![],
                    resource_scopes: BTreeMap::new(),
                    last_error: None,
                    running: BTreeMap::new(),
                }),
                operations: Mutex::new(()),
                updates: Mutex::new(()),
                catalog_check: Mutex::new(()),
                downloads: Arc::default(),
                library,
                dir,
                exiting: AtomicBool::new(false),
            });
            let handle = app.handle().clone();
            download_workers::start(&handle);
            TrayIconBuilder::with_id("screen-garden")
                .icon(tray_image())
                .tooltip("壁纸盒子 · 右键切换壁纸")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| tray_action(app, event.id().as_ref()))
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_manager(tray.app_handle());
                    }
                })
                .build(app)?;
            rebuild_tray(&handle);
            if let (Some(secondary), Some(manager)) = (
                displays.iter().find(|d| !d.primary),
                app.get_webview_window("manager"),
            ) {
                let _ = manager.set_position(tauri::PhysicalPosition::new(
                    secondary.x + 80,
                    secondary.y + 70,
                ));
            }
            log(
                &handle,
                &format!(
                    "Started; displays={displays:?}; desktop={}",
                    desktop::desktop_handles()
                ),
            );
            std::thread::spawn(move || maintenance(handle, first));
            let input_app = app.handle().clone();
            let click_app = app.handle().clone();
            match crate::desktop_input::start(
                move || input_surfaces(&input_app),
                move |click| relay_desktop_click(&click_app, click),
            ) {
                Ok(listener) => {
                    app.manage(listener);
                    log(app.handle(), "Desktop blank-click relay started");
                }
                Err(message) => log(app.handle(), &message),
            }
            crate::app_updates::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label().starts_with("preview-") && matches!(event, WindowEvent::Destroyed) {
                if let Some(host) = window.app_handle().try_state::<Host>() {
                    host.data
                        .lock()
                        .unwrap()
                        .resource_scopes
                        .remove(window.label());
                }
            }
            if window.label() == "manager" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to create Wallpaper Box");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<Host>().exiting.load(Ordering::SeqCst) {
                api.prevent_exit();
            }
        }
    });
}
