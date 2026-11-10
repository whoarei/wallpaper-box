use std::{path::Path, process::Command};

/// Reuse an already-running catalog. Starting the packaged service is an
/// explicit user action and must never replace a healthy external module folder.
pub fn start(resource_dir: &Path) -> Result<(), String> {
    if crate::catalog::fetch().is_ok() {
        return Ok(());
    }
    let compose = resource_dir.join("display-service").join("compose.yaml");
    if !compose.is_file() {
        return Err("未找到随程序附带的展示服务。请完整安装或解压便携包。".into());
    }
    let mut command = Command::new("docker");
    command.arg("compose").arg("-f").arg(&compose).args([
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        "90",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    let output = command.output().map_err(|e| {
        format!("无法运行 Docker。请先安装并启动 Docker Desktop（使用 Linux 容器）。{e}")
    })?;
    if !output.status.success() {
        let details = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let tail: String = details
            .chars()
            .rev()
            .take(1200)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return Err(format!(
            "展示服务启动失败，请确认 Docker Desktop 已启动。\n{tail}"
        ));
    }
    crate::catalog::fetch().map(|_| ())
}
