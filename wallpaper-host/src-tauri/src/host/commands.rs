use super::*;
use tauri::WebviewWindow;

pub(super) fn manager(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "manager" {
        return Err("壁纸页面没有程序管理权限。".into());
    }
    Ok(())
}
pub(super) fn reload(app: &AppHandle, id: &str) {
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
pub fn open_about_link(window: WebviewWindow, link: String) -> Result<(), String> {
    manager(&window)?;
    // Accept named destinations only; wallpaper pages cannot open arbitrary URLs.
    let url = match link.as_str() {
        "project" => "https://github.com/whoarei/wallpaper-box",
        "issues" => "https://github.com/whoarei/wallpaper-box/issues",
        "tauri" => "https://github.com/tauri-apps/tauri",
        "webview2" => {
            "https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution"
        }
        _ => return Err("未知的关于链接。".into()),
    };
    use windows::{
        core::{w, HSTRING, PCWSTR},
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(url),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        return Err("无法打开默认浏览器，请稍后重试。".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_state(app: AppHandle, window: WebviewWindow) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        sample_resources(&app);
        snapshot(&app)
    })
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
pub async fn invoke_wallpaper_action(
    app: AppHandle,
    window: WebviewWindow,
    monitor_id: String,
    instance_id: String,
    action_id: String,
) -> Result<crate::wallpaper_protocol::ActionResult, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        super::wallpaper_actions::invoke(&app, &monitor_id, &instance_id, &action_id)
    })
    .await
    .map_err(|e| e.to_string())
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
pub async fn set_auto_start(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let result = {
            let mut data = host.data.lock().unwrap();
            let mut settings = data.settings.clone();
            settings.auto_start = enabled;
            let path = host.dir.join("settings.json");
            catalog::atomic_json(&path, &settings)
                .map_err(|_| "无法保存开机启动设置，未修改系统启动项。")?;
            match app
                .state::<crate::autostart::Autostart>()
                .set_enabled(enabled)
            {
                Ok(()) => {
                    data.settings = settings;
                    data.auto_start_error = None;
                    Ok(())
                }
                Err(mut error) => {
                    if catalog::atomic_json(&path, &data.settings).is_err() {
                        data.settings = settings;
                        error.push_str(" 设置文件还原失败，请重新检查此开关。");
                    }
                    data.auto_start_error = Some(error.clone());
                    Err(error)
                }
            }
        };
        let _ = app.emit("host-updated", ());
        result?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|error| error.to_string())?
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
            if data.settings.proxy != settings.proxy {
                data.history.clear();
            }
            data.settings = settings;
        }
        let _ = app.emit("host-updated", ());
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_wallpaper_repositories(
    app: AppHandle,
    window: WebviewWindow,
    repositories: Vec<crate::repositories::Repository>,
) -> Result<View, String> {
    manager(&window)?;
    let repositories = crate::repositories::normalize(repositories)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let _catalog = host
            .catalog_check
            .try_lock()
            .map_err(|_| "正在刷新壁纸库，请稍后保存仓库设置。")?;
        let _update = host
            .updates
            .try_lock()
            .map_err(|_| "正在处理壁纸，请稍后保存仓库设置。")?;
        let online = crate::online::load_cache(&host.dir, &repositories);
        {
            let mut data = host.data.lock().unwrap();
            let mut settings = data.settings.clone();
            settings.wallpaper_repositories = repositories;
            catalog::atomic_json(&host.dir.join("settings.json"), &settings)
                .map_err(|_| "壁纸仓库设置保存失败，请检查设置目录是否可写。")?;
            if data.settings.wallpaper_repositories != settings.wallpaper_repositories {
                data.history.clear();
            }
            data.settings = settings;
            data.online = online;
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
    reset_resources(&app);
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
            .catalog_check
            .try_lock()
            .map_err(|_| "正在处理壁纸，请稍后再试。")?;
        let proxy = proxy_settings(&app);
        let repositories = host
            .data
            .lock()
            .unwrap()
            .settings
            .wallpaper_repositories
            .clone();
        let state = crate::online::check(&host.dir, &repositories, &proxy);
        {
            let mut data = host.data.lock().unwrap();
            data.online = state;
            data.history.clear();
        }
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn load_wallpaper_history(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
    repository: String,
    page: u32,
) -> Result<crate::online::history::Page, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let _check = host
            .history_check
            .try_lock()
            .map_err(|_| "正在加载历史版本，请稍后重试。")?;
        let (item, proxy, revision) = {
            let data = host.data.lock().unwrap();
            let item = data
                .online
                .catalog
                .as_ref()
                .and_then(|catalog| {
                    catalog
                        .wallpapers
                        .iter()
                        .find(|item| item.id == module_id && item.repository == repository)
                })
                .cloned()
                .ok_or("壁纸来源已变化，请重新打开版本列表。")?;
            (item, data.settings.proxy.clone(), data.history.revision())
        };
        let page = crate::online::history::load(&item, page, &proxy)?;
        let mut data = host.data.lock().unwrap();
        if revision != data.history.revision() {
            return Err("壁纸库或网络设置已变化，请重新打开版本列表。".into());
        }
        if !data
            .settings
            .wallpaper_repositories
            .iter()
            .any(|source| source.enabled && source.url == repository)
        {
            return Err("壁纸来源仓库已关闭或移除。".into());
        }
        data.history.remember(&repository, &module_id, &page);
        Ok(page)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_online(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
    version: Option<String>,
    repository: Option<String>,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let item = {
            let data = host.data.lock().unwrap();
            let item = if let Some(version) = &version {
                let repository = repository.as_ref().ok_or("请选择版本的来源仓库。")?;
                data.history.select(repository, &module_id, version)
            } else {
                data.online
                    .catalog
                    .as_ref()
                    .and_then(|catalog| catalog.wallpapers.iter().find(|item| item.id == module_id))
                    .cloned()
            }
            .ok_or("请重新加载壁纸清单或版本列表后重试。")?;
            if !data
                .settings
                .wallpaper_repositories
                .iter()
                .any(|source| source.enabled && source.url == item.repository)
            {
                return Err("壁纸来源仓库已关闭或移除。".into());
            }
            item
        };
        crate::online::validate_wallpaper(&item)?;
        if !item.compatible() {
            return Err(format!("请先升级壁纸盒子到 {}。", item.min_app_version));
        }
        if host
            .downloads
            .snapshot()
            .iter()
            .any(|task| task.id == module_id)
        {
            return Err("这张壁纸已有下载任务，请先完成或移除任务。".into());
        }
        let id = item.id.clone();
        let size = item.size;
        host.downloads.enqueue(
            id,
            crate::online::InstallRequest {
                item,
                selected_version: version.is_some(),
            },
            size,
        )?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn download_action(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
    action: String,
) -> Result<View, String> {
    manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        match action.as_str() {
            "cancel" => host.downloads.cancel(&module_id)?,
            "retry" => host.downloads.retry(&module_id)?,
            _ => return Err("未知下载操作。".into()),
        }
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
        if host
            .downloads
            .snapshot()
            .iter()
            .any(|task| task.id == module_id && task.phase != crate::download_queue::Phase::Failed)
        {
            return Err("请先取消这张壁纸的下载，再切换版本。".into());
        }
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
