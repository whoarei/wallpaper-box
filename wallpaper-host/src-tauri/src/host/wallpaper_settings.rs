use super::*;
use crate::wallpaper_settings::Snapshot;
use tauri::WebviewWindow;

#[derive(Serialize)]
pub struct Saved {
    snapshot: Snapshot,
    running: usize,
    pending: bool,
}

fn check_page(data: &Data, module_id: &str, page_token: &str) -> Result<(), String> {
    let module = data
        .modules
        .iter()
        .find(|m| m.id == module_id)
        .ok_or("该壁纸已移除，请重新选择。")?;
    let page = module
        .settings
        .as_ref()
        .ok_or("这张壁纸没有自定义设置页。")?;
    if module.settings_token != page_token
        || catalog::inside_file(&module.root, &page.entry).is_err()
    {
        return Err("壁纸已更新，请重新打开设置页。".into());
    }
    Ok(())
}

pub(super) fn sync(app: &AppHandle, window_label: &str) -> bool {
    let host = app.state::<Host>();
    let script = {
        let data = host.data.lock().unwrap();
        let Some(id) = data.resource_scopes.get(window_label) else {
            return false;
        };
        data.settings
            .wallpaper_settings
            .get(id)
            .cloned()
            .unwrap_or_default()
            .script(id)
    };
    app.get_webview_window(window_label)
        .is_some_and(|window| window.eval(script).is_ok())
}

#[tauri::command]
pub async fn get_wallpaper_settings(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
    page_token: String,
) -> Result<Snapshot, String> {
    super::commands::manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let data = host.data.lock().unwrap();
        check_page(&data, &module_id, &page_token)?;
        Ok(data
            .settings
            .wallpaper_settings
            .get(&module_id)
            .cloned()
            .unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_wallpaper_settings(
    app: AppHandle,
    window: WebviewWindow,
    module_id: String,
    page_token: String,
    expected_revision: u64,
    settings: serde_json::Value,
) -> Result<Saved, String> {
    super::commands::manager(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let _operation = host.operations.lock().unwrap();
        let (snapshot, targets, running) = {
            let mut data = host.data.lock().unwrap();
            check_page(&data, &module_id, &page_token)?;
            let snapshot = data
                .settings
                .wallpaper_settings
                .get(&module_id)
                .cloned()
                .unwrap_or_default()
                .updated(expected_revision, settings)?;
            let mut next = data.settings.clone();
            next.wallpaper_settings
                .insert(module_id.clone(), snapshot.clone());
            catalog::atomic_json(&host.dir.join("settings.json"), &next)
                .map_err(|_| "壁纸配置保存失败，请检查设置目录是否可写。")?;
            data.settings = next;
            let targets: Vec<_> = data
                .resource_scopes
                .iter()
                .filter(|(_, id)| **id == module_id)
                .map(|(label, _)| label.clone())
                .collect();
            let running = data
                .running
                .values()
                .filter(|r| targets.contains(&r.label))
                .count();
            (snapshot, targets, running)
        };
        let mut pending = false;
        for target in targets {
            pending |= !sync(&app, &target);
        }
        let _ = app.emit("host-updated", ());
        Ok(Saved {
            snapshot,
            running,
            pending,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
