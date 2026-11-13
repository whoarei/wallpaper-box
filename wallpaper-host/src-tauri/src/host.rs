mod commands;
mod download_workers;
mod wallpaper_actions;
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
    time::{Duration, Instant},
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

static NEXT_SURFACE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Selection {
    module_id: String,
    #[serde(default)]
    paused: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Settings {
    #[serde(default)]
    language: crate::language::Language,
    selected_monitor: String,
    assignments: BTreeMap<String, Selection>,
    #[serde(default = "yes")]
    auto_pause: bool,
    #[serde(default = "yes")]
    auto_start: bool,
    #[serde(default)]
    proxy: crate::network::ProxySettings,
    #[serde(default = "crate::repositories::defaults")]
    wallpaper_repositories: Vec<crate::repositories::Repository>,
}
fn yes() -> bool {
    true
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            language: crate::language::Language::default(),
            selected_monitor: String::new(),
            assignments: BTreeMap::new(),
            auto_pause: true,
            auto_start: true,
            proxy: crate::network::ProxySettings::default(),
            wallpaper_repositories: crate::repositories::defaults(),
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
    protocol: crate::wallpaper_protocol::Session,
}
struct Data {
    settings: Settings,
    modules: Vec<Module>,
    online: crate::online::State,
    auto_start_error: Option<String>,
    warnings: Vec<String>,
    resource_scopes: BTreeMap<String, String>,
    history: crate::online::history::Cache,
    last_error: Option<String>,
    running: BTreeMap<String, Running>,
}
pub struct Host {
    data: Mutex<Data>,
    resources: Mutex<crate::resource_usage::Monitor>,
    operations: Mutex<()>,
    updates: Mutex<()>,
    catalog_check: Mutex<()>,
    history_check: Mutex<()>,
    downloads: Arc<crate::download_queue::Queue<crate::online::InstallRequest>>,
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
    instance_id: Option<String>,
    actions: Vec<crate::wallpaper_protocol::Action>,
    actions_error: Option<String>,
    action_busy: bool,
    resources: crate::resource_usage::Usage,
    desktop_clicks: u64,
    z_order_repairs: u64,
    proof: Attachment,
}
#[derive(Serialize)]
pub struct View {
    language: crate::language::Language,
    locale: &'static str,
    version: &'static str,
    desktop_input: Option<crate::desktop_input::DiagnosticSnapshot>,
    app_update: crate::app_updates::View,
    service: &'static str,
    online: crate::online::State,
    wallpaper_repositories: Vec<crate::repositories::Repository>,
    user_directory: String,
    warnings: Vec<String>,
    downloads: Vec<DownloadView>,
    selected_monitor: String,
    displays: Vec<Display>,
    modules: Vec<Module>,
    wallpapers: Vec<WallpaperView>,
    auto_pause: bool,
    auto_start: bool,
    auto_start_error: Option<String>,
    proxy: crate::network::ProxySettings,
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

fn display_name(display: &Display, locale: &str) -> String {
    format!(
        "{}{}",
        display.id.trim_start_matches(r"\\.\"),
        if display.primary {
            crate::language::text(locale, " · 主显示器", " · Primary display")
        } else {
            ""
        }
    )
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
        if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
            reset_resources(app);
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn reset_resources(app: &AppHandle) {
    if let Some(host) = app.try_state::<Host>() {
        host.resources.lock().unwrap().reset();
    }
}

fn sample_resources(app: &AppHandle) {
    use crate::resource_usage::{exclusive_group, measure, process_group};
    let host = app.state::<Host>();
    let visible = app.get_webview_window("manager").is_some_and(|window| {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true)
    });
    if !visible {
        host.resources.lock().unwrap().reset();
        return;
    }
    let Some(ticket) = host.resources.lock().unwrap().begin(Instant::now()) else {
        return;
    };
    let targets: Vec<_> = host
        .data
        .lock()
        .unwrap()
        .running
        .values()
        .map(|running| (running.label.clone(), running.generation))
        .collect();
    if targets.is_empty() {
        host.resources
            .lock()
            .unwrap()
            .finish(ticket, BTreeMap::new());
        return;
    }

    // Query all views so shared processes cannot be charged to one screen.
    // Never hold a host lock while dispatching work onto the WebView thread.
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut groups = BTreeMap::new();
    for (label, window) in app.webview_windows() {
        groups.insert(label.clone(), Err(()));
        let reply = sender.clone();
        let reply_label = label.clone();
        if window
            .with_webview(move |webview| {
                let _ = reply.send((reply_label, process_group(webview.environment())));
            })
            .is_err()
        {
            groups.insert(label, Err(()));
        }
    }
    drop(sender);
    let deadline = Instant::now() + Duration::from_millis(750);
    while let Ok((label, group)) =
        receiver.recv_timeout(deadline.saturating_duration_since(Instant::now()))
    {
        groups.insert(label, group);
    }
    let readings = targets
        .into_iter()
        .map(|(label, generation)| {
            let reading = exclusive_group(&label, &groups).ok_or(()).and_then(measure);
            (generation, reading)
        })
        .collect();
    host.resources.lock().unwrap().finish(ticket, readings);
}

fn snapshot(app: &AppHandle) -> View {
    let host = app.state::<Host>();
    let startup = app.state::<crate::autostart::Autostart>().enabled();
    let (auto_start, auto_start_error) = match startup {
        Ok(enabled) => (enabled, None),
        Err(error) => (false, Some(error)),
    };
    let downloads = host
        .downloads
        .snapshot()
        .into_iter()
        .map(|task| DownloadView {
            id: task.id,
            item: task.item.item,
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
                .map(|m| {
                    m.localized_name(data.settings.language.locale())
                        .to_string()
                })
                .unwrap_or_else(|| selection.module_id.clone());
            let mut proof = desktop::inspect(running.proof.hwnd as isize);
            proof.method = running.proof.method.clone();
            Some(WallpaperView {
                display_id: id.clone(),
                module_id: selection.module_id.clone(),
                name,
                paused: selection.paused,
                auto_paused: running.auto_paused,
                instance_id: running.protocol.instance_id.clone(),
                actions: running.protocol.actions.clone(),
                actions_error: running.protocol.error.clone(),
                action_busy: running.protocol.request_id.is_some(),
                resources: host.resources.lock().unwrap().usage(running.generation),
                desktop_clicks: running.desktop_clicks,
                z_order_repairs: running.z_order_repairs,
                proof,
            })
        })
        .collect();
    View {
        language: data.settings.language,
        locale: data.settings.language.locale(),
        version: env!("CARGO_PKG_VERSION"),
        desktop_input: app
            .try_state::<crate::desktop_input::Listener>()
            .map(|listener| listener.diagnostics()),
        app_update: app.state::<crate::app_updates::Updates>().view(),
        service: catalog::ORIGIN,
        online: data.online.clone(),
        wallpaper_repositories: data.settings.wallpaper_repositories.clone(),
        user_directory: display_path(&host.library.user.join("local")),
        warnings: data.warnings.clone(),
        downloads,
        selected_monitor: data.settings.selected_monitor.clone(),
        displays: desktop::displays()
            .into_iter()
            .map(|mut display| {
                display.name = display_name(&display, data.settings.language.locale());
                display
            })
            .collect(),
        modules: data.modules.clone(),
        wallpapers,
        auto_pause: data.settings.auto_pause,
        auto_start,
        auto_start_error: auto_start_error.or_else(|| data.auto_start_error.clone()),
        proxy: data.settings.proxy.clone(),
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

pub(crate) fn proxy_settings(app: &AppHandle) -> crate::network::ProxySettings {
    app.state::<Host>()
        .data
        .lock()
        .unwrap()
        .settings
        .proxy
        .clone()
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
    let locale = host.data.lock().unwrap().settings.language.locale();
    let result = WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(url))
        .title(format!(
            "{} · {}",
            crate::language::text(locale, "预览", "Preview"),
            module.localized_name(locale)
        ))
        .inner_size(960.0, 600.0)
        .min_inner_size(640.0, 400.0)
        .center()
        .data_directory(profile)
        .initialization_script(crate::wallpaper_protocol::initialization_script(
            false, locale,
        ))
        .on_navigation(|url| {
            url.scheme() == "http"
                && url.host_str() == Some("wallpaper.localhost")
                && url.port().is_none()
        })
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                sync_locale(window.app_handle(), window.label());
            }
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
    let locale = host.data.lock().unwrap().settings.language.locale();
    let window = if let Some(window) = app.get_webview_window(&window_label) {
        window.navigate(url).map_err(|e| e.to_string())?;
        window
    } else {
        let profile = host.dir.join("webview").join(&window_label);
        let _ = fs::create_dir_all(&profile);
        WebviewWindowBuilder::new(app, &window_label, WebviewUrl::CustomProtocol(url))
            .title(format!(
                "{} · {} · {}",
                crate::language::text(locale, "壁纸盒子", "Wallpaper Box"),
                module.localized_name(locale),
                display_name(&display, locale)
            ))
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
            .initialization_script(crate::wallpaper_protocol::initialization_script(
                true, locale,
            ))
            .on_page_load(|window, payload| match payload.event() {
                tauri::webview::PageLoadEvent::Started => {
                    wallpaper_actions::loading(window.app_handle(), window.label())
                }
                tauri::webview::PageLoadEvent::Finished => {
                    sync_locale(window.app_handle(), window.label());
                    wallpaper_actions::sync_state(window.app_handle(), window.label())
                }
            })
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
    let pause_state;
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
        pause_state = crate::wallpaper_protocol::PauseState::new(paused, automatic, false);
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
                protocol: Default::default(),
            },
        );
        data.last_error = None;
    }
    let _ = window.eval(pause_state.script());
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
fn relay_desktop_input(app: &AppHandle, input: crate::desktop_input::Input) {
    let Some(host) = app.try_state::<Host>() else {
        return;
    };
    let Ok(_operation) = host.operations.try_lock() else {
        return;
    };
    if !input_surfaces(app).contains(&input.surface) {
        return;
    }
    let (display_id, module_id, window_label) = {
        let data = host.data.lock().unwrap();
        let Some((id, running)) = data
            .running
            .iter()
            .find(|(_, running)| running.generation == input.surface.generation)
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
    if matches!(input.kind, crate::desktop_input::InputKind::Move) {
        let _ = window.eval(format!(
            "window.__SCREEN_GARDEN_DESKTOP_MOVE?.({}, {})",
            input.x, input.y
        ));
        return;
    }
    let script = format!(
        "window.__SCREEN_GARDEN_DESKTOP_CLICK?.({}, {})",
        input.x, input.y
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
                .filter(|r| r.generation == input.surface.generation)
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
                changes.push((
                    running.label.clone(),
                    crate::wallpaper_protocol::PauseState::new(paused, running.auto_paused, false),
                ));
            }
        }
    }
    for (label, pause) in changes {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.eval(pause.script());
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

fn sync_locale(app: &AppHandle, label: &str) {
    let (locale, preview_title) = {
        let host = app.state::<Host>();
        let data = host.data.lock().unwrap();
        let locale = data.settings.language.locale();
        let title = if label.starts_with("preview-") {
            data.resource_scopes
                .get(label)
                .and_then(|id| data.modules.iter().find(|module| &module.id == id))
                .map(|module| {
                    format!(
                        "{} · {}",
                        crate::language::text(locale, "预览", "Preview"),
                        module.localized_name(locale)
                    )
                })
        } else {
            None
        };
        (locale, title)
    };
    if let Some(window) = app.get_webview_window(label) {
        if let Some(title) = preview_title {
            let _ = window.set_title(&title);
        }
        if let Err(message) = window.eval(crate::language::script(locale)) {
            log(app, &format!("Set wallpaper locale: {message}"));
        }
    }
}

fn rebuild_tray(app: &AppHandle) {
    let view = snapshot(app);
    let tr = |zh, en| crate::language::text(view.locale, zh, en);
    if let Some(window) = app.get_webview_window("manager") {
        let _ = window.set_title(tr(
            "壁纸盒子 · 壁纸管理",
            "Wallpaper Box · Wallpaper Manager",
        ));
    }
    let result = (|| -> tauri::Result<()> {
        let menu = Menu::new(app)?;
        let selected = view.displays.iter().find(|d| d.id == view.selected_monitor);
        menu.append(&MenuItem::with_id(
            app,
            "current-display",
            selected
                .map(|d| d.name.as_str())
                .unwrap_or(tr("未选择显示器", "No display selected")),
            false,
            None::<&str>,
        )?)?;
        let screens = Submenu::with_id(app, "displays", tr("选择显示器", "Select display"), true)?;
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
                module.localized_name(view.locale),
                true,
                current.map(|w| w.module_id == module.id).unwrap_or(false),
                None::<&str>,
            )?)?;
        }
        if view.modules.is_empty() {
            menu.append(&MenuItem::with_id(
                app,
                "no-wallpapers",
                tr(
                    "暂无壁纸，打开管理窗口刷新",
                    "No wallpapers. Open the manager to refresh",
                ),
                false,
                None::<&str>,
            )?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        if let Some(current) = current {
            if let Some(instance_id) = &current.instance_id {
                let pause = crate::wallpaper_protocol::PauseState::new(
                    current.paused,
                    current.auto_paused,
                    false,
                );
                for action in &current.actions {
                    menu.append(&MenuItem::with_id(
                        app,
                        format!("action:{instance_id}:{}", action.id),
                        &action.label,
                        action.allowed(pause) && !current.action_busy,
                        None::<&str>,
                    )?)?;
                }
            }
        }
        menu.append(&CheckMenuItem::with_id(
            app,
            "pause-current",
            tr("暂停当前壁纸", "Pause current wallpaper"),
            current.is_some(),
            current.map(|w| w.paused).unwrap_or(false),
            None::<&str>,
        )?)?;
        let all_paused = !view.wallpapers.is_empty() && view.wallpapers.iter().all(|w| w.paused);
        menu.append(&MenuItem::with_id(
            app,
            "pause-all",
            if all_paused {
                tr("继续全部壁纸", "Resume all wallpapers")
            } else {
                tr("暂停全部壁纸", "Pause all wallpapers")
            },
            !view.wallpapers.is_empty(),
            None::<&str>,
        )?)?;
        menu.append(&CheckMenuItem::with_id(
            app,
            "auto-pause",
            tr("遮挡时自动暂停", "Pause when covered"),
            true,
            view.auto_pause,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "remove-current",
            tr("关闭当前屏幕壁纸", "Remove wallpaper from current display"),
            current.is_some(),
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(
            app,
            "show-desktop",
            tr("显示 / 还原桌面", "Show / restore desktop"),
            true,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "open-manager",
            tr("打开壁纸管理", "Open wallpaper manager"),
            true,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "check-app-update",
            tr("检查程序更新", "Check for app updates"),
            true,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "about",
            tr("关于壁纸盒子", "About Wallpaper Box"),
            true,
            None::<&str>,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "quit",
            tr("退出壁纸盒子", "Quit Wallpaper Box"),
            true,
            None::<&str>,
        )?)?;
        if let Some(tray) = app.tray_by_id("screen-garden") {
            tray.set_tooltip(Some(tr(
                "壁纸盒子 · 右键切换壁纸",
                "Wallpaper Box · Right-click to switch wallpaper",
            )))?;
            tray.set_menu(Some(menu))?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        log(app, &format!("Tray menu: {error}"));
    }
}

fn tray_action(app: &AppHandle, id: &str) {
    if id == "about" {
        show_manager(app);
        if let Some(window) = app.get_webview_window("manager") {
            if let Err(message) = window.emit("show-about", ()) {
                error(app, format!("打开关于失败：{message}"));
            }
        }
        return;
    }
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
        } else if let Some(action) = id.strip_prefix("action:") {
            wallpaper_actions::tray_invoke(&app, action)
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
                        if let Some((auto, _effective, auto_changed)) = change {
                            if auto_changed {
                                log(
                                    &app,
                                    &format!("Auto pause {id} = {auto}; covering={cover:?}"),
                                );
                            }
                            let _ = window.eval(
                                crate::wallpaper_protocol::PauseState::new(
                                    selection.paused,
                                    auto,
                                    false,
                                )
                                .script(),
                            );
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
    let background = crate::autostart::background_launch(std::env::args_os());
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
        .plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            if !crate::autostart::background_launch(arguments) {
                show_manager(app)
            }
        }))
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::set_language,
            commands::open_about_link,
            commands::check_app_update,
            commands::download_app_update,
            commands::install_app_update,
            commands::refresh_modules,
            commands::select_monitor,
            commands::apply_wallpaper,
            commands::preview_wallpaper,
            commands::pause_wallpaper,
            commands::invoke_wallpaper_action,
            commands::remove_wallpaper,
            commands::auto_pause,
            commands::set_auto_start,
            commands::set_proxy,
            commands::set_wallpaper_repositories,
            commands::test_proxy,
            commands::load_online_cover,
            commands::load_wallpaper_history,
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
        .setup(move |app| {
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
            app.manage(crate::app_updates::Updates::new(dir.join("app-updates")));
            let settings_path = dir.join("settings.json");
            let first = !settings_path.exists();
            let mut settings: Settings = fs::read(&settings_path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            let startup = crate::autostart::Autostart::new(
                app.config()
                    .product_name
                    .as_deref()
                    .unwrap_or(env!("CARGO_PKG_NAME")),
            );
            let startup_error = startup.initialize(settings.auto_start).err();
            app.manage(startup);
            let online = crate::online::load_cache(&dir, &settings.wallpaper_repositories);
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
                    auto_start_error: startup_error.clone(),
                    warnings: vec![],
                    resource_scopes: BTreeMap::new(),
                    history: crate::online::history::Cache::default(),
                    last_error: None,
                    running: BTreeMap::new(),
                }),
                resources: Mutex::new(crate::resource_usage::Monitor::default()),
                operations: Mutex::new(()),
                updates: Mutex::new(()),
                catalog_check: Mutex::new(()),
                history_check: Mutex::new(()),
                downloads: Arc::default(),
                library,
                dir,
                exiting: AtomicBool::new(false),
            });
            let handle = app.handle().clone();
            if let Some(error) = startup_error {
                log(&handle, &format!("Autostart: {error}"));
            }
            download_workers::start(&handle);
            wallpaper_actions::start(&handle);
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
            let relay_app = app.handle().clone();
            match crate::desktop_input::start(
                move || input_surfaces(&input_app),
                move |input| relay_desktop_input(&relay_app, input),
            ) {
                Ok(listener) => {
                    app.manage(listener);
                    log(
                        app.handle(),
                        "Desktop blank-click and pointer relay started",
                    );
                }
                Err(message) => log(app.handle(), &message),
            }
            crate::app_updates::start(app.handle().clone());
            if !background {
                show_manager(app.handle());
            }
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
                if matches!(event, WindowEvent::Resized(_))
                    && window.is_minimized().unwrap_or(false)
                {
                    reset_resources(window.app_handle());
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    reset_resources(window.app_handle());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_gain_system_proxy_without_losing_playback_preferences() {
        let saved = r#"{"selected_monitor":"display-2","assignments":{"display-2":{"module_id":"aquarium","paused":true}},"auto_pause":false}"#;
        let settings: Settings = serde_json::from_str(saved).unwrap();
        assert_eq!(settings.proxy, crate::network::ProxySettings::default());
        assert_eq!(
            settings.wallpaper_repositories,
            crate::repositories::defaults()
        );
        assert_eq!(settings.selected_monitor, "display-2");
        assert_eq!(settings.assignments["display-2"].module_id, "aquarium");
        assert!(settings.assignments["display-2"].paused);
        assert!(!settings.auto_pause);
        assert!(settings.auto_start);
        assert_eq!(settings.language, crate::language::Language::System);
    }

    #[test]
    fn disabled_startup_preference_survives_settings_round_trip() {
        let saved = r#"{"selected_monitor":"display-2","assignments":{"display-2":{"module_id":"aquarium"}},"auto_start":false}"#;
        let settings: Settings = serde_json::from_str(saved).unwrap();
        let reloaded: Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert!(!reloaded.auto_start);
        assert_eq!(reloaded.selected_monitor, "display-2");
        assert_eq!(reloaded.assignments["display-2"].module_id, "aquarium");
        assert!(Settings::default().auto_start);
    }

    #[test]
    fn language_round_trip_preserves_display_assignments() {
        let saved = r#"{"language":"en","selected_monitor":"display-2","assignments":{"display-2":{"module_id":"aquarium","paused":true}},"auto_pause":false}"#;
        let settings: Settings = serde_json::from_str(saved).unwrap();
        let reloaded: Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(reloaded.language, crate::language::Language::English);
        assert_eq!(reloaded.language.locale(), "en");
        assert_eq!(reloaded.selected_monitor, "display-2");
        assert!(reloaded.assignments["display-2"].paused);
        assert!(!reloaded.auto_pause);
    }
}
