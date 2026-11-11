use super::*;
use crate::download_queue::{Lease, Phase, MAX_CONCURRENT};

fn process(app: &AppHandle, lease: &Lease<crate::online::RemoteWallpaper>) -> Result<(), String> {
    let host = app.state::<Host>();
    let root = host.library.user.join(".downloads");
    let item = lease.item.clone();
    let progress_queue = host.downloads.clone();
    let progress_lease = lease.clone();
    let verify_queue = host.downloads.clone();
    let verify_lease = lease.clone();
    // Aborting this async request interrupts both header waits and body reads.
    // Its private stage is dropped before this worker releases its permit.
    let request = tauri::async_runtime::spawn(async move {
        crate::online::prepare_download(
            &root,
            &item,
            move |received| progress_queue.progress(&progress_lease, received),
            move || {
                verify_queue.phase(&verify_lease, Phase::Verifying);
            },
        )
        .await
    });
    let abort = request.inner().abort_handle();
    lease.cancel.on_abort(move || abort.abort());
    let mut archive = tauri::async_runtime::block_on(request)
        .map_err(|error| format!("下载已停止：{error}"))??;
    if !host.downloads.phase(lease, Phase::WaitingInstall) {
        return Ok(());
    }
    let _installation = host.updates.lock().unwrap();
    if !host.downloads.phase(lease, Phase::Installing) {
        return Ok(());
    }
    // Only the installer holds a full archive in memory, irrespective of the
    // five network workers. Existing version/path checks remain authoritative.
    let bytes = archive.read()?;
    crate::online::install_bytes(&host.library, &lease.item, &bytes)?;
    refresh(app)?;
    commands::reload(app, &lease.id);
    log(
        app,
        &format!("Installed {} {}", lease.id, lease.item.version),
    );
    Ok(())
}

pub(super) fn start(app: &AppHandle) {
    for _ in 0..MAX_CONCURRENT {
        let app = app.clone();
        let queue = app.state::<Host>().downloads.clone();
        std::thread::spawn(move || {
            while let Some(lease) = queue.next() {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    process(&app, &lease)
                }))
                .unwrap_or_else(|_| Err("下载任务意外中断，请重试。".into()));
                queue.finish(&lease, result.err());
                let _ = app.emit("host-updated", ());
            }
        });
    }
}
