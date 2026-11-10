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
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const WALLPAPER_SCRIPT: &str = include_str!("../wallpaper-mode.js");

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
    label: String,
    proof: Attachment,
    auto_paused: bool,
    effective_paused: bool,
}
struct Data {
    settings: Settings,
    modules: Vec<Module>,
    online: bool,
    last_error: Option<String>,
    running: BTreeMap<String, Running>,
}
pub struct Host {
    data: Mutex<Data>,
    operations: Mutex<()>,
    dir: PathBuf,
    exiting: AtomicBool,
}

#[derive(Serialize)]
pub struct WallpaperView {
    display_id: String,
    module_id: String,
    name: String,
    paused: bool,
    auto_paused: bool,
    proof: Attachment,
}
#[derive(Serialize)]
pub struct View {
    version: &'static str,
    service: &'static str,
    online: bool,
    selected_monitor: String,
    displays: Vec<Display>,
    modules: Vec<Module>,
    wallpapers: Vec<WallpaperView>,
    auto_pause: bool,
    last_error: Option<String>,
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
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let data = host.data.lock().unwrap();
        let json = serde_json::to_vec_pretty(&data.settings)?;
        drop(data);
        fs::create_dir_all(&host.dir)?;
        fs::write(host.dir.join("settings.tmp"), json)?;
        fs::rename(
            host.dir.join("settings.tmp"),
            host.dir.join("settings.json"),
        )?;
        Ok(())
    })();
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
                proof,
            })
        })
        .collect();
    View {
        version: env!("CARGO_PKG_VERSION"),
        service: catalog::SERVICE,
        online: data.online,
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
    let changed;
    match catalog::fetch() {
        Ok(modules) => {
            let mut data = host.data.lock().unwrap();
            changed = data.modules != modules;
            data.modules = modules;
            data.online = true;
            data.last_error = None;
        }
        Err(message) => {
            let mut data = host.data.lock().unwrap();
            data.online = false;
            data.last_error = Some(message.clone());
            return Err(message);
        }
    }
    if changed {
        rebuild_tray(app);
    }
    let _ = app.emit("host-updated", ());
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
    let url = format!("{}{}", catalog::SERVICE, module.href)
        .parse()
        .map_err(|e| format!("壁纸地址错误：{e}"))?;
    let window_label = label(monitor_id);
    let window = if let Some(window) = app.get_webview_window(&window_label) {
        window.navigate(url).map_err(|e| e.to_string())?;
        window
    } else {
        let profile = host.dir.join("webview").join(&window_label);
        let _ = fs::create_dir_all(&profile);
        WebviewWindowBuilder::new(app, &window_label, WebviewUrl::External(url))
            .title(format!("壁纸盒子 · {} · {}", module.name, display.name))
            .inner_size(
                display.width as f64 / display.scale,
                display.height as f64 / display.scale,
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
                    && url.host_str() == Some("127.0.0.1")
                    && url.port() == Some(8088)
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
        data.settings.selected_monitor = monitor_id.into();
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
                label: window_label,
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
fn remove(app: &AppHandle, monitor_id: &str) {
    let host = app.state::<Host>();
    let _operation = host.operations.lock().unwrap();
    if let Some(window) = app.get_webview_window(&label(monitor_id)) {
        let _ = window.destroy();
    }
    {
        let mut data = host.data.lock().unwrap();
        data.running.remove(monitor_id);
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
fn quit(app: &AppHandle) {
    app.state::<Host>().exiting.store(true, Ordering::SeqCst);
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
        if iteration > 0 && iteration % 8 == 0 {
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
                if let Some(window) = app.get_webview_window(&label(&id)) {
                    if let Ok(handle) = window.hwnd() {
                        let raw = handle.0 as isize;
                        desktop::maintain_z_order(raw);
                        let proof = desktop::inspect(raw);
                        if !proof.attached
                            || proof.x != display.x
                            || proof.y != display.y
                            || proof.width != display.width
                            || proof.height != display.height
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
                        let mut data = host.data.lock().unwrap();
                        let cover = desktop::covering_window(display, &ignore);
                        let auto = data.settings.auto_pause && cover.is_some();
                        let effective = selection.paused || auto;
                        if let Some(running) = data.running.get_mut(&id) {
                            if auto != running.auto_paused {
                                let message =
                                    format!("Auto pause {id} = {auto}; covering={cover:?}");
                                use std::io::Write;
                                if let Ok(mut file) = fs::OpenOptions::new()
                                    .create(true)
                                    .append(true)
                                    .open(host.dir.join("host.log"))
                                {
                                    let _ = writeln!(file, "{message}");
                                }
                            }
                            let _ = window
                                .eval(format!("window.__SCREEN_GARDEN_SET_PAUSED?.({effective});"));
                            running.effective_paused = effective;
                            running.auto_paused = auto;
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

#[tauri::command]
async fn get_state(app: AppHandle) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || snapshot(&app))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn refresh_modules(app: AppHandle) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        refresh(&app)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn start_content_service(app: AppHandle) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        crate::content::start(&resources)?;
        refresh(&app)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn select_monitor(app: AppHandle, monitor_id: String) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        select(&app, &monitor_id)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn apply_wallpaper(
    app: AppHandle,
    monitor_id: String,
    module_id: String,
) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply(&app, &monitor_id, &module_id)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn pause_wallpaper(app: AppHandle, monitor_id: String, paused: bool) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_paused(&app, Some(&monitor_id), paused);
        snapshot(&app)
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn remove_wallpaper(app: AppHandle, monitor_id: String) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        remove(&app, &monitor_id);
        snapshot(&app)
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn auto_pause(app: AppHandle, enabled: bool) -> View {
    set_auto(&app, enabled);
    snapshot(&app)
}
#[tauri::command]
fn hide_manager(app: AppHandle) {
    if let Some(window) = app.get_webview_window("manager") {
        let _ = window.hide();
    }
}
#[tauri::command]
fn quit_app(app: AppHandle) {
    quit(&app);
}
#[tauri::command]
async fn capture_desktop(app: AppHandle, monitor_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let display = desktop::displays()
            .into_iter()
            .find(|d| d.id == monitor_id)
            .ok_or("显示器已断开连接。")?;
        let output = app
            .state::<Host>()
            .dir
            .join(format!("preview-{}.png", label(&monitor_id)));
        desktop::capture(&display, &output)?;
        Ok(output.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn show_desktop(app: AppHandle, monitor_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        desktop::show_desktop()?;
        std::thread::sleep(Duration::from_secs(3));
        let display = desktop::displays()
            .into_iter()
            .find(|d| d.id == monitor_id)
            .ok_or("显示器已断开连接。")?;
        let output = app
            .state::<Host>()
            .dir
            .join(format!("preview-{}.png", label(&monitor_id)));
        desktop::capture(&display, &output)?;
        Ok(output.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_manager(app)
        }))
        .invoke_handler(tauri::generate_handler![
            get_state,
            refresh_modules,
            start_content_service,
            select_monitor,
            apply_wallpaper,
            pause_wallpaper,
            remove_wallpaper,
            auto_pause,
            hide_manager,
            quit_app,
            capture_desktop,
            show_desktop
        ])
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
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
                    online: false,
                    last_error: None,
                    running: BTreeMap::new(),
                }),
                operations: Mutex::new(()),
                dir,
                exiting: AtomicBool::new(false),
            });
            let handle = app.handle().clone();
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
            Ok(())
        })
        .on_window_event(|window, event| {
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
