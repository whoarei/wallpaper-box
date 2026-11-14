mod placement;
use super::*;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

const LABEL: &str = "tray-menu";

#[derive(Default)]
pub(super) struct Popup {
    generation: AtomicU64,
    prepared: AtomicU64,
    requested: AtomicBool,
    creation: Mutex<()>,
}

#[derive(Serialize)]
pub struct Item {
    id: String,
    label: String,
    icon: &'static str,
    enabled: bool,
    checked: Option<bool>,
    children: Vec<Item>,
}

impl Item {
    fn new(
        id: impl Into<String>,
        label: impl Into<String>,
        icon: &'static str,
        enabled: bool,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon,
            enabled,
            checked: None,
            children: vec![],
        }
    }
    fn check(mut self, checked: bool) -> Self {
        self.checked = Some(checked);
        self
    }
    fn children(mut self, children: Vec<Item>) -> Self {
        self.children = children;
        self
    }
    fn separator() -> Self {
        Self::new("", "", "", false)
    }
    fn allows(&self, id: &str) -> bool {
        self.enabled
            && ((self.id == id && self.children.is_empty())
                || self.children.iter().any(|item| item.allows(id)))
    }
}

#[derive(Serialize)]
pub struct MenuView {
    generation: u64,
    locale: &'static str,
    brand: &'static str,
    version: &'static str,
    display: String,
    wallpaper: String,
    status: &'static str,
    playing: bool,
    items: Vec<Item>,
}

fn model(app: &AppHandle) -> MenuView {
    let view = snapshot(app);
    let tr = |zh, en| crate::language::text(view.locale, zh, en);
    let selected = view.displays.iter().find(|d| d.id == view.selected_monitor);
    let current = view
        .wallpapers
        .iter()
        .find(|w| w.display_id == view.selected_monitor);
    let screens = view
        .displays
        .iter()
        .map(|d| {
            Item::new(format!("display:{}", d.id), &d.name, "monitor", true)
                .check(d.id == view.selected_monitor)
        })
        .collect();
    let mut wallpapers: Vec<_> = view
        .modules
        .iter()
        .map(|module| {
            Item::new(
                format!("wallpaper:{}", module.id),
                module.localized_name(view.locale),
                "image",
                true,
            )
            .check(current.is_some_and(|w| w.module_id == module.id))
        })
        .collect();
    if wallpapers.is_empty() {
        wallpapers.push(Item::new(
            "no-wallpapers",
            tr(
                "暂无壁纸，请打开壁纸管理",
                "No wallpapers. Open the manager",
            ),
            "image",
            false,
        ));
    }
    let mut actions = vec![];
    if let Some(current) = current {
        if let Some(instance) = &current.instance_id {
            let pause = crate::wallpaper_protocol::PauseState::new(
                current.paused,
                current.auto_paused,
                false,
            );
            for action in &current.actions {
                actions.push(Item::new(
                    format!("action:{instance}:{}", action.id),
                    &action.label,
                    "sparkles",
                    action.allowed(pause) && !current.action_busy,
                ));
            }
            if !actions.is_empty() {
                actions.push(Item::separator());
            }
        }
    }
    actions.push(
        Item::new(
            "pause-current",
            tr("暂停当前壁纸", "Pause current wallpaper"),
            "pause",
            current.is_some(),
        )
        .check(current.is_some_and(|w| w.paused)),
    );
    actions.push(Item::new(
        "remove-current",
        tr("关闭当前屏幕壁纸", "Remove wallpaper from current display"),
        "close",
        current.is_some(),
    ));
    wallpapers.push(Item::separator());
    wallpapers.push(
        Item::new(
            "wallpaper-actions",
            tr("壁纸操作", "Wallpaper actions"),
            "sparkles",
            current.is_some(),
        )
        .children(actions),
    );
    let all_paused = !view.wallpapers.is_empty() && view.wallpapers.iter().all(|w| w.paused);
    MenuView {
        generation: app.state::<Popup>().generation.load(Ordering::SeqCst),
        locale: view.locale,
        brand: tr("壁纸盒子", "Wallpaper Box"),
        version: view.version,
        display: selected
            .map(|d| d.name.clone())
            .unwrap_or_else(|| tr("未连接显示器", "No connected display").into()),
        wallpaper: current
            .map(|w| w.name.clone())
            .unwrap_or_else(|| tr("当前屏幕未播放壁纸", "No wallpaper on this display").into()),
        status: if current.is_some_and(|w| w.paused || w.auto_paused) {
            tr("已暂停", "Paused")
        } else if current.is_some() {
            tr("播放中", "Playing")
        } else {
            tr("未播放", "Idle")
        },
        playing: current.is_some_and(|w| !w.paused && !w.auto_paused),
        items: vec![
            Item::new(
                "open-manager",
                tr("打开壁纸管理", "Open wallpaper manager"),
                "grid",
                true,
            ),
            Item::separator(),
            Item::new(
                "displays",
                tr("选择显示器", "Select display"),
                "monitor",
                !view.displays.is_empty(),
            )
            .children(screens),
            Item::new(
                "wallpapers",
                tr("壁纸", "Wallpapers"),
                "image",
                selected.is_some(),
            )
            .children(wallpapers),
            Item::new(
                "pause-all",
                if all_paused {
                    tr("继续全部壁纸", "Resume all wallpapers")
                } else {
                    tr("暂停全部壁纸", "Pause all wallpapers")
                },
                if all_paused { "play" } else { "pause" },
                !view.wallpapers.is_empty(),
            ),
            Item::separator(),
            Item::new("open-settings", tr("设置", "Settings"), "settings", true),
            Item::new(
                "auto-pause",
                tr("遮挡时自动暂停", "Pause when covered"),
                "auto-pause",
                true,
            )
            .check(view.auto_pause),
            Item::new(
                "check-app-update",
                tr("检查程序更新", "Check for app updates"),
                "refresh",
                true,
            ),
            Item::new(
                "about",
                tr("关于壁纸盒子", "About Wallpaper Box"),
                "info",
                true,
            ),
            Item::separator(),
            Item::new(
                "quit",
                tr("退出壁纸盒子", "Quit Wallpaper Box"),
                "power",
                true,
            ),
        ],
    }
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("此窗口没有托盘菜单权限。".into());
    }
    Ok(())
}

pub(super) fn hide(app: &AppHandle) {
    app.state::<Popup>()
        .requested
        .store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

pub(super) fn refresh(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.emit("tray-menu-updated", ());
        }
    }
}

pub(super) fn open(app: &AppHandle, position: PhysicalPosition<f64>) {
    let popup = app.state::<Popup>();
    let generation = popup.generation.fetch_add(1, Ordering::SeqCst) + 1;
    popup.requested.store(true, Ordering::SeqCst);
    let app = app.clone();
    // WebView2 creation can deadlock in a synchronous tray event handler.
    // Record intent before spawning so a left click or dismissal also cancels
    // an opening whose document has not finished loading yet.
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(message) = open_inner(&app, position, generation) {
            if app.state::<Popup>().generation.load(Ordering::SeqCst) == generation {
                hide(&app);
                error(&app, format!("打开托盘菜单失败：{message}"));
                show_manager(&app);
            }
        }
    });
}

fn open_inner(
    app: &AppHandle,
    position: PhysicalPosition<f64>,
    generation: u64,
) -> tauri::Result<()> {
    let popup = app.state::<Popup>();
    let _creation = popup.creation.lock().unwrap();
    let requested = || {
        popup.requested.load(Ordering::SeqCst)
            && generation == popup.generation.load(Ordering::SeqCst)
    };
    if !requested() {
        return Ok(());
    }
    let window = if let Some(window) = app.get_webview_window(LABEL) {
        window
    } else {
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("tray-menu.html".into()))
            .title("Wallpaper Box")
            .inner_size(320.0, 548.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible(false)
            .focused(false)
            .build()?
    };
    // Tray coordinates and monitor work areas are physical pixels. Clamp on the
    // clicked monitor, including negative origins and taskbars on any edge.
    if let Some(display) = desktop::displays().into_iter().min_by_key(|d| {
        let x = position.x.clamp(d.x as f64, (d.x + d.width) as f64);
        let y = position.y.clamp(d.y as f64, (d.y + d.height) as f64);
        ((position.x - x).powi(2) + (position.y - y).powi(2)) as i64
    }) {
        let area = display.work_area;
        let (x, y, width, height) = placement::place(
            (area.x, area.y, area.width, area.height),
            display.scale,
            (position.x, position.y),
        );
        window.set_position(PhysicalPosition::new(x, y))?;
        window.set_size(PhysicalSize::new(width, height))?;
    }
    if requested() {
        // Do not reveal the document before it is positioned on the right DPI
        // monitor. Its initial load and this event cover either loading order.
        popup.prepared.store(generation, Ordering::SeqCst);
        window.emit("tray-menu-open", ())?;
    }
    Ok(())
}

#[tauri::command]
pub fn tray_menu_state(app: AppHandle, window: WebviewWindow) -> Result<MenuView, String> {
    authorize(&window)?;
    Ok(model(&app))
}

#[tauri::command]
pub fn tray_menu_ready(
    app: AppHandle,
    window: WebviewWindow,
    generation: u64,
) -> Result<(), String> {
    authorize(&window)?;
    let popup = app.state::<Popup>();
    if popup.requested.load(Ordering::SeqCst)
        && generation == popup.generation.load(Ordering::SeqCst)
        && generation == popup.prepared.load(Ordering::SeqCst)
    {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn tray_menu_hide(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    hide(&app);
    Ok(())
}

#[tauri::command]
pub fn tray_menu_action(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    generation: u64,
) -> Result<(), String> {
    authorize(&window)?;
    let view = model(&app);
    if !app.state::<Popup>().requested.load(Ordering::SeqCst)
        || generation != view.generation
        || !view.items.iter().any(|item| item.allows(&id))
    {
        return Err("菜单操作已失效，请重新打开菜单。".into());
    }
    hide(&app);
    tray_action(&app, &id);
    Ok(())
}
