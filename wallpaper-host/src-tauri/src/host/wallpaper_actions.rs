//! Bounded asynchronous action discovery, with requests pinned to a document.
use super::*;
use crate::wallpaper_protocol::{ActionResult, ActionSnapshot, PauseState, Request, TIMEOUT};
use std::sync::mpsc;

static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);
#[derive(Clone)]
struct Target {
    monitor_id: String,
    label: String,
    generation: u64,
    epoch: u64,
}
fn current<'a>(data: &'a mut Data, target: &Target) -> Option<&'a mut Running> {
    data.running.get_mut(&target.monitor_id).filter(|running| {
        running.generation == target.generation && running.protocol.epoch == target.epoch
    })
}
fn state(data: &Data, monitor_id: &str) -> PauseState {
    PauseState::new(
        data.settings
            .assignments
            .get(monitor_id)
            .is_some_and(|selection| selection.paused),
        data.running
            .get(monitor_id)
            .is_some_and(|running| running.auto_paused),
        false,
    )
}
fn evaluate(app: &AppHandle, label: &str, script: String) -> Result<String, String> {
    let window = app.get_webview_window(label).ok_or("壁纸窗口已关闭。")?;
    let (send, receive) = mpsc::sync_channel(1);
    window
        .eval_with_callback(script, move |reply| {
            let _ = send.try_send(reply);
        })
        .map_err(|_| "未能向壁纸发送请求。")?;
    receive
        .recv_timeout(TIMEOUT)
        .map_err(|_| "壁纸暂未响应。".into())
}

/// Do not block the WebView's load callback on an operation that may itself be
/// waiting for the UI thread. The poller reconciles state if this try-lock loses.
pub(super) fn sync_state(app: &AppHandle, label: &str) {
    let Some(host) = app.try_state::<Host>() else {
        return;
    };
    let Ok(_operation) = host.operations.try_lock() else {
        return;
    };
    let pause = {
        let data = host.data.lock().unwrap();
        data.running
            .iter()
            .find(|(_, running)| running.label == label)
            .map(|(id, _)| state(&data, id))
    };
    if let (Some(pause), Some(window)) = (pause, app.get_webview_window(label)) {
        super::wallpaper_settings::sync(app, label);
        let _ = window.eval(pause.script());
    }
}
pub(super) fn loading(app: &AppHandle, label: &str) {
    let Some(host) = app.try_state::<Host>() else {
        return;
    };
    let mut data = host.data.lock().unwrap();
    if let Some(running) = data
        .running
        .values_mut()
        .find(|running| running.label == label)
    {
        running.protocol.invalidate();
    }
}

fn query(app: AppHandle, target: Target) {
    sync_state(&app, &target.label);
    let result = evaluate(
        &app,
        &target.label,
        "document.readyState === 'loading' ? null : window.__SCREEN_GARDEN_GET_ACTIONS?.()".into(),
    );
    let result = result.and_then(|raw| {
        if raw == "null" {
            Ok(None)
        } else {
            ActionSnapshot::parse(&raw).map(Some)
        }
    });
    let Some(host) = app.try_state::<Host>() else {
        return;
    };
    if host.exiting.load(Ordering::Acquire) {
        return;
    }
    let changed = {
        let mut data = host.data.lock().unwrap();
        let Some(running) = current(&mut data, &target) else {
            return;
        };
        let session = &mut running.protocol;
        session.query_pending = false;
        let old = (
            session.instance_id.clone(),
            session.actions.clone(),
            session.error.clone(),
        );
        match result {
            Ok(Some(snapshot)) => {
                if session
                    .instance_id
                    .as_ref()
                    .is_some_and(|id| id != &snapshot.instance_id)
                {
                    // A page-initiated navigation also changes identity, even if
                    // its native load notification raced the first query.
                    session.invalidate();
                }
                session.instance_id = Some(snapshot.instance_id);
                session.actions = snapshot.actions;
                session.error = snapshot.error;
            }
            Ok(None) => (),
            Err(message) => {
                session.actions.clear();
                session.error = Some(message);
            }
        }
        old != (
            session.instance_id.clone(),
            session.actions.clone(),
            session.error.clone(),
        )
    };
    if changed {
        rebuild_tray(&app);
        let _ = app.emit("host-updated", ());
    }
}
fn poll(app: &AppHandle) {
    let host = app.state::<Host>();
    let targets: Vec<_> = {
        let mut data = host.data.lock().unwrap();
        data.running
            .iter_mut()
            .filter_map(|(id, running)| {
                if running.protocol.query_pending {
                    return None;
                }
                running.protocol.query_pending = true;
                Some(Target {
                    monitor_id: id.clone(),
                    label: running.label.clone(),
                    generation: running.generation,
                    epoch: running.protocol.epoch,
                })
            })
            .collect()
    };
    // At most one query per live document. A hung renderer cannot stall desktop
    // maintenance, another monitor, or the manager's ordinary state snapshots.
    for target in targets {
        let app = app.clone();
        std::thread::spawn(move || query(app, target));
    }
}
pub(super) fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        while !app.state::<Host>().exiting.load(Ordering::Acquire) {
            poll(&app);
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

pub(super) fn invoke(
    app: &AppHandle,
    monitor_id: &str,
    instance_id: &str,
    action_id: &str,
) -> ActionResult {
    let request_id = format!("action-{}", NEXT_REQUEST.fetch_add(1, Ordering::Relaxed));
    let fail = |code, message| ActionResult::failure(&request_id, code, message);
    if !crate::wallpaper_protocol::valid_token(instance_id)
        || !crate::wallpaper_protocol::valid_action_id(action_id)
    {
        return fail("INVALID_REQUEST", "壁纸操作请求无效。");
    }
    let host = app.state::<Host>();
    let Ok(operation) = host.operations.try_lock() else {
        return fail("BUSY", "正在处理壁纸操作，请稍后再试。");
    };
    if host.exiting.load(Ordering::Acquire) {
        return fail("STALE_INSTANCE", "壁纸盒子正在退出。");
    }
    if !desktop::displays()
        .iter()
        .any(|display| display.id == monitor_id)
    {
        return fail("STALE_INSTANCE", "这个显示器已经断开连接。");
    }
    let (target, pause) = {
        let mut data = host.data.lock().unwrap();
        let pause = state(&data, monitor_id);
        let Some(running) = data.running.get_mut(monitor_id) else {
            return fail("STALE_INSTANCE", "这个屏幕的壁纸已经关闭。");
        };
        if !desktop::inspect(running.proof.hwnd as isize).attached {
            return fail("STALE_INSTANCE", "壁纸窗口暂不可用，请稍后再试。");
        }
        let session = &mut running.protocol;
        if session.instance_id.as_deref() != Some(instance_id) {
            return fail("STALE_INSTANCE", "壁纸已经切换或重新加载。");
        }
        if session.request_id.is_some() {
            return fail("BUSY", "正在处理这张壁纸的上一个操作。");
        }
        let Some(action) = session.actions.iter().find(|action| action.id == action_id) else {
            return fail("UNKNOWN_ACTION", "这张壁纸没有这个操作。");
        };
        if pause.paused
            && (!action.allow_when_occluded
                || pause.pause_reason != crate::wallpaper_protocol::PauseReason::Occluded)
        {
            return fail("PAUSED", "壁纸已暂停，请先继续播放。");
        }
        // The document re-reads descriptors immediately before execution, so a
        // stale disabled/enabled UI cannot authorize a forbidden operation.
        session.request_id = Some(request_id.clone());
        (
            Target {
                monitor_id: monitor_id.into(),
                label: running.label.clone(),
                generation: running.generation,
                epoch: session.epoch,
            },
            pause,
        )
    };
    let request = Request {
        protocol_version: 1,
        instance_id,
        request_id: &request_id,
        action_id,
    };
    let script = format!(
        "{}window.__SCREEN_GARDEN_INVOKE_ACTION?.({});",
        pause.script(),
        serde_json::to_string(&request).unwrap()
    );
    let (send, receive) = mpsc::sync_channel(1);
    let dispatched = app.get_webview_window(&target.label).ok_or(());
    let dispatched = dispatched.and_then(|window| {
        window
            .eval_with_callback(script, move |reply| {
                let _ = send.try_send(reply);
            })
            .map_err(|_| ())
    });
    drop(operation); // Never hold the global mutation lock while awaiting a page.
    rebuild_tray(app);
    let _ = app.emit("host-updated", ());
    let result = if dispatched.is_err() {
        fail("FAILED", "未能向壁纸发送操作。")
    } else {
        receive
            .recv_timeout(TIMEOUT)
            .ok()
            .and_then(|reply| ActionResult::parse(&reply, instance_id, &request_id).ok())
            .unwrap_or_else(|| ActionResult::unknown(&request_id))
    };
    let valid = {
        let mut data = host.data.lock().unwrap();
        current(&mut data, &target).is_some_and(|running| {
            running
                .protocol
                .finish(target.epoch, instance_id, &request_id)
        })
    };
    if !valid
        || app.get_webview_window(&target.label).is_none()
        || !desktop::displays()
            .iter()
            .any(|display| display.id == monitor_id)
    {
        return fail("STALE_INSTANCE", "壁纸已经切换或重新加载，请查看当前画面。");
    }
    log(
        app,
        &format!(
            "Wallpaper action {action_id} on {monitor_id}: {}",
            serde_json::to_string(&result).unwrap()
        ),
    );
    rebuild_tray(app);
    let _ = app.emit("host-updated", ());
    poll(app);
    result
}

pub(super) fn tray_invoke(app: &AppHandle, value: &str) -> Result<(), String> {
    let (instance_id, action_id) = value.split_once(':').ok_or("壁纸操作已失效。")?;
    let monitor_id = app
        .state::<Host>()
        .data
        .lock()
        .unwrap()
        .running
        .iter()
        .find(|(_, running)| running.protocol.instance_id.as_deref() == Some(instance_id))
        .map(|(id, _)| id.clone())
        .ok_or("壁纸操作已失效，请重新打开菜单。")?;
    let result = invoke(app, &monitor_id, instance_id, action_id);
    if result.ok {
        Ok(())
    } else {
        Err(result.message.unwrap_or_else(|| "壁纸操作未完成。".into()))
    }
}
