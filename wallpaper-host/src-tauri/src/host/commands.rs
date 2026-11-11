use super::*;
use tauri::WebviewWindow;

fn manager(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "manager" {
        return Err("壁纸页面没有程序管理权限。".into());
    }
    Ok(())
}
fn reload(app: &AppHandle, id: &str) {
    let host = app.state::<Host>();
    let _operation = host.operations.lock().unwrap();
    let connected: Vec<_> = desktop::displays().into_iter().map(|d| d.id).collect();
    let targets: Vec<_> = host
        .data
        .lock()
        .unwrap()
        .settings
        .assignments
        .iter()
        .filter(|(display, s)| s.module_id == id && connected.contains(display))
        .map(|(display, _)| display.clone())
        .collect();
    let mut failures = vec![];
    for display in targets {
        if let Err(message) = apply_inner(app, &display, id) {
            failures.push(format!("{display}: {message}"));
        }
    }
    if !failures.is_empty() {
        // The content transaction already succeeded. A disconnected or failing
        // display should not turn it into a misleading installation failure.
        error(
            app,
            format!("壁纸已保存，屏幕重新加载待重试：{}", failures.join("；")),
        );
    }
    diagnostics(app);
}

#[tauri::command]
pub async fn get_state(app: AppHandle, window: WebviewWindow) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || snapshot(&app))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn check_app_update(app: AppHandle, window: WebviewWindow) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::app_updates::check(&app)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn download_app_update(app: AppHandle, window: WebviewWindow) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::app_updates::download(&app)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    window: WebviewWindow,
    confirmed: bool,
    version: String,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        save(&app);
        crate::app_updates::install(&app, confirmed, &version)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn refresh_modules(app: AppHandle, window: WebviewWindow) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        refresh(&app)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn select_monitor(
    app: AppHandle,
    window: WebviewWindow,
    monitor_id: String,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        select(&app, &monitor_id)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn apply_wallpaper(
    app: AppHandle,
    window: WebviewWindow,
    monitor_id: String,
    module_id: String,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        apply(&app, &monitor_id, &module_id)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn preview_wallpaper(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
) -> Result<(), String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || preview(&app, &module_id))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn pause_wallpaper(
    app: AppHandle,
    window: WebviewWindow,
    monitor_id: String,
    paused: bool,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        set_paused(&app, Some(&monitor_id), paused);
        snapshot(&app)
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn feed_aquarium(
    app: AppHandle,
    window: WebviewWindow,
    monitor_id: String,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        super::feed_aquarium(&app, &monitor_id)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn remove_wallpaper(
    app: AppHandle,
    window: WebviewWindow,
    monitor_id: String,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        remove(&app, &monitor_id);
        snapshot(&app)
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn auto_pause(app: AppHandle, window: WebviewWindow, enabled: bool) -> Result<View, String> {
    manager(&window)?;
    set_auto(&app, enabled);
    Ok(snapshot(&app))
}

#[tauri::command]
pub async fn set_proxy(
    app: AppHandle,
    window: WebviewWindow,
    proxy: crate::network::ProxySettings,
) -> Result<View, String> {
    manager(&window)?;
    let proxy = proxy.normalized()?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        {
            let mut data = host.data.lock().unwrap();
            let mut settings = data.settings.clone();
            settings.proxy = proxy;
            // Commit to disk before changing the live policy. Failed saves leave
            // both the current configuration and the manager draft intact.
            catalog::atomic_json(&host.dir.join("settings.json"), &settings)
                .map_err(|_| "代理设置保存失败，请检查设置目录是否可写。")?;
            data.settings = settings;
        }
        let _ = app.emit("host-updated", ());
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn test_proxy(
    window: WebviewWindow,
    proxy: crate::network::ProxySettings,
) -> Result<(), String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || crate::network::test_connection(&proxy))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_online_cover(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
) -> Result<String, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let (item, proxy) = {
            let data = host.data.lock().unwrap();
            let item = data
                .online
                .catalog
                .as_ref()
                .and_then(|catalog| catalog.wallpapers.iter().find(|item| item.id == module_id))
                .cloned()
                .ok_or("在线壁纸不存在。")?;
            (item, data.settings.proxy.clone())
        };
        crate::online::cover(&item, &proxy)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn hide_manager(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    manager(&window)?;
    if let Some(w) = app.get_webview_window("manager") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn quit_app(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    manager(&window)?;
    quit(&app);
    Ok(())
}
#[tauri::command]
pub async fn capture_desktop(
    app: AppHandle,
    window: WebviewWindow,
    monitor_id: String,
) -> Result<String, String> {
    manager(&window)?;
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
pub async fn show_desktop(
    app: AppHandle,
    window: WebviewWindow,
    monitor_id: String,
) -> Result<String, String> {
    manager(&window)?;
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
#[tauri::command]
pub async fn check_online(app: AppHandle, window: WebviewWindow) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let _update = host
            .updates
            .try_lock()
            .map_err(|_| "正在处理壁纸，请稍后再试。")?;
        let proxy = proxy_settings(&app);
        match crate::online::check(&host.dir, &proxy) {
            Ok(state) => {
                host.data.lock().unwrap().online = state;
                Ok(snapshot(&app))
            }
            Err(message) => {
                host.data.lock().unwrap().online.last_error = Some(message.clone());
                Err(message)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn install_online(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let _update = host
            .updates
            .try_lock()
            .map_err(|_| "正在处理壁纸，请稍后再试。")?;
        let item = host
            .data
            .lock()
            .unwrap()
            .online
            .catalog
            .as_ref()
            .and_then(|c| c.wallpapers.iter().find(|m| m.id == module_id))
            .cloned()
            .ok_or("请先检查在线壁纸清单。")?;
        host.data.lock().unwrap().transfer = Some(Transfer {
            id: item.id.clone(),
            name: item.name.clone(),
            received: 0,
            total: item.size,
        });
        let proxy = proxy_settings(&app);
        let result = crate::online::install(&host.library, &item, &proxy, |received, total| {
            if let Some(transfer) = host.data.lock().unwrap().transfer.as_mut() {
                transfer.received = received;
                transfer.total = total;
            }
        });
        host.data.lock().unwrap().transfer = None;
        if let Err(message) = result {
            host.data.lock().unwrap().online.last_error = Some(message.clone());
            return Err(message);
        }
        host.data.lock().unwrap().online.last_error = None;
        log(
            &app,
            &format!(
                "Installed {} {}: {:?}",
                item.id,
                item.version,
                host.library.active_path(&item.id)
            ),
        );
        refresh(&app)?;
        reload(&app, &module_id);
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn rollback_wallpaper(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let _update = host
            .updates
            .try_lock()
            .map_err(|_| "正在处理壁纸，请稍后再试。")?;
        host.library.rollback(&module_id)?;
        refresh(&app)?;
        reload(&app, &module_id);
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn import_wallpaper(
    app: AppHandle,
    window: WebviewWindow,
    kind: String,
) -> Result<Option<View>, String> {
    manager(&window)?;
    if kind != "folder" && kind != "zip" {
        return Err("请选择文件夹或 ZIP。".into());
    }
    let parent = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = crate::picker::choose(kind == "folder", parent)? else {
            return Ok(None);
        };
        if kind == "zip"
            && path
                .extension()
                .and_then(|v| v.to_str())
                .is_none_or(|v| !v.eq_ignore_ascii_case("zip"))
        {
            return Err("请选择 ZIP 壁纸包。".into());
        }
        let host = app.state::<Host>();
        let _update = host
            .updates
            .try_lock()
            .map_err(|_| "正在处理壁纸，请稍后再试。")?;
        crate::online::import_path(&host.library, &path)?;
        refresh(&app)?;
        Ok(Some(snapshot(&app)))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn open_wallpaper_folder(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    manager(&window)?;
    let folder = app.state::<Host>().library.user.join("local");
    std::process::Command::new("explorer.exe")
        .arg(display_path(&folder))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
