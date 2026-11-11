//! Per-user Windows startup. Explicit toggles clear Windows' disabled marker;
//! ordinary launches and upgrades preserve it.
use std::{ffi::OsStr, sync::Mutex};

pub const ARGUMENT: &str = "--autostart";

pub fn background_launch<I, S>(arguments: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    arguments
        .into_iter()
        .skip(1)
        .any(|arg| arg.as_ref() == OsStr::new(ARGUMENT))
}

fn command(executable: &str) -> Result<String, String> {
    if executable.is_empty() || executable.contains('"') || executable.chars().any(char::is_control)
    {
        return Err("无法读取程序路径，未修改开机启动设置。".into());
    }
    let executable = if let Some(path) = executable.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{path}")
    } else {
        executable
            .strip_prefix(r"\\?\")
            .unwrap_or(executable)
            .to_string()
    };
    let command = format!("\"{executable}\" {ARGUMENT}");
    // Windows limits a Run value's command line to 260 characters.
    if command.encode_utf16().count() > 260 {
        return Err("程序路径过长，无法设置随系统启动，请将程序安装到较短的路径。".into());
    }
    Ok(command)
}

trait Store {
    fn command(&self) -> Result<Option<String>, String>;
    fn write(&self, command: &str) -> Result<(), String>;
    fn remove(&self) -> Result<(), String>;
    fn approval(&self) -> Result<Option<Vec<u8>>, String>;
    fn clear_approval(&self) -> Result<(), String>;
}

fn enabled(store: &impl Store, expected: &str) -> Result<bool, String> {
    if !store
        .command()?
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
    {
        return Ok(false);
    }
    // Windows Startup Apps / Task Manager use 3 and 7 for disabled entries.
    Ok(!store
        .approval()?
        .as_deref()
        .and_then(|bytes| bytes.first())
        .is_some_and(|byte| matches!(*byte, 3 | 7)))
}

fn initialize(store: &impl Store, expected: &str, preference: bool) -> Result<(), String> {
    if preference {
        if !store
            .command()?
            .is_some_and(|value| value.eq_ignore_ascii_case(expected))
        {
            store.write(expected)?;
        }
        // Do not re-enable an entry that the user disabled in Windows itself.
        Ok(())
    } else {
        set_enabled(store, expected, false)
    }
}

fn set_enabled(store: &impl Store, expected: &str, enable: bool) -> Result<(), String> {
    if !enable {
        store.remove()?;
        // A leftover approval marker cannot launch an absent Run entry.
        let _ = store.clear_approval();
        return Ok(());
    }
    let previous = store.command()?;
    store.write(expected)?;
    if let Err(error) = store.clear_approval() {
        let rollback = match previous {
            Some(value) => store.write(&value),
            None => store.remove(),
        };
        return Err(if rollback.is_err() {
            format!("{error}；启动项还原失败，请检查 Windows 启动设置。")
        } else {
            error
        });
    }
    Ok(())
}

pub struct Autostart {
    store: platform::Registry,
    command: Result<String, String>,
    operation: Mutex<()>,
}
impl Autostart {
    pub fn new(product_name: &str) -> Self {
        let command = std::env::current_exe()
            .map_err(|_| "无法读取程序路径，未修改开机启动设置。".to_string())
            .and_then(|path| command(&path.to_string_lossy()));
        Self {
            store: platform::Registry::new(product_name),
            command,
            operation: Mutex::new(()),
        }
    }
    pub fn initialize(&self, preference: bool) -> Result<(), String> {
        let _operation = self.operation.lock().unwrap();
        initialize(
            &self.store,
            self.command.as_deref().map_err(|error| error.to_string())?,
            preference,
        )
    }
    pub fn enabled(&self) -> Result<bool, String> {
        let _operation = self.operation.lock().unwrap();
        enabled(
            &self.store,
            self.command.as_deref().map_err(|error| error.to_string())?,
        )
    }
    pub fn set_enabled(&self, enable: bool) -> Result<(), String> {
        let _operation = self.operation.lock().unwrap();
        set_enabled(
            &self.store,
            self.command.as_deref().map_err(|error| error.to_string())?,
            enable,
        )
    }
}

#[cfg(windows)]
mod platform {
    use super::Store;
    use windows_registry::{Key, CURRENT_USER};

    pub(super) struct Registry {
        name: String,
        run: String,
        approval: String,
    }
    impl Registry {
        pub(super) fn new(name: &str) -> Self {
            // Tauri's NSIS uninstaller removes the product-name Run entry on
            // uninstall and preserves it in /UPDATE mode.
            Self {
                name: name.into(),
                run: r"Software\Microsoft\Windows\CurrentVersion\Run".into(),
                approval: r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
                    .into(),
            }
        }
        fn open(&self, path: &str, write: bool) -> Result<Option<Key>, String> {
            if write {
                optional(CURRENT_USER.options().read().write().open(path))
            } else {
                optional(CURRENT_USER.open(path))
            }
        }
        fn remove_value(&self, path: &str) -> Result<(), String> {
            if let Some(key) = self.open(path, true)? {
                optional(key.remove_value(&self.name))?;
            }
            Ok(())
        }
    }
    fn optional<T>(result: windows_registry::Result<T>) -> Result<Option<T>, String> {
        match result {
            Ok(value) => Ok(Some(value)),
            Err(error) if matches!(error.code().0 as u32, 0x80070002 | 0x80070003) => Ok(None),
            Err(error) => Err(format!(
                "无法访问 Windows 启动设置（0x{:08X}）。",
                error.code().0 as u32
            )),
        }
    }
    impl Store for Registry {
        fn command(&self) -> Result<Option<String>, String> {
            match self.open(&self.run, false)? {
                Some(key) => optional(key.get_string(&self.name)),
                None => Ok(None),
            }
        }
        fn write(&self, command: &str) -> Result<(), String> {
            CURRENT_USER
                .create(&self.run)
                .and_then(|key| key.set_string(&self.name, command))
                .map_err(|error| format!("无法设置随系统启动（0x{:08X}）。", error.code().0 as u32))
        }
        fn remove(&self) -> Result<(), String> {
            self.remove_value(&self.run)
        }
        fn approval(&self) -> Result<Option<Vec<u8>>, String> {
            match self.open(&self.approval, false)? {
                Some(key) => {
                    Ok(optional(key.get_value(&self.name))?.map(|value| value.as_ref().to_vec()))
                }
                None => Ok(None),
            }
        }
        fn clear_approval(&self) -> Result<(), String> {
            self.remove_value(&self.approval)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn registry_round_trip_uses_only_an_isolated_test_key() {
            let path = format!(
                r"Software\WallpaperBox\AutostartTests\{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            struct Cleanup(String);
            impl Drop for Cleanup {
                fn drop(&mut self) {
                    let _ = CURRENT_USER.remove_tree(&self.0);
                }
            }
            let _cleanup = Cleanup(path.clone());
            let store = Registry {
                name: "test".into(),
                run: format!(r"{path}\Run"),
                approval: format!(r"{path}\Approved"),
            };
            let command =
                super::super::command(r"C:\Program Files\壁纸盒子\wallpaper-box.exe").unwrap();
            super::super::initialize(&store, &command, true).unwrap();
            assert!(super::super::enabled(&store, &command).unwrap());
            CURRENT_USER
                .create(&store.approval)
                .unwrap()
                .set_bytes(&store.name, windows_registry::Type::Bytes, &[3, 0, 0, 0])
                .unwrap();
            assert!(!super::super::enabled(&store, &command).unwrap());
            super::super::initialize(&store, &command, true).unwrap();
            assert!(!super::super::enabled(&store, &command).unwrap());
            super::super::set_enabled(&store, &command, true).unwrap();
            assert!(super::super::enabled(&store, &command).unwrap());
            super::super::set_enabled(&store, &command, false).unwrap();
            assert!(store.command().unwrap().is_none());
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Store;
    pub(super) struct Registry;
    impl Registry {
        pub(super) fn new(_: &str) -> Self {
            Self
        }
    }
    impl Store for Registry {
        fn command(&self) -> Result<Option<String>, String> {
            Err("当前平台不支持随系统启动。".into())
        }
        fn write(&self, _: &str) -> Result<(), String> {
            self.command().map(|_| ())
        }
        fn remove(&self) -> Result<(), String> {
            self.command().map(|_| ())
        }
        fn approval(&self) -> Result<Option<Vec<u8>>, String> {
            self.command().map(|_| None)
        }
        fn clear_approval(&self) -> Result<(), String> {
            self.command().map(|_| ())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    #[derive(Default)]
    struct Memory {
        command: RefCell<Option<String>>,
        approval: RefCell<Option<Vec<u8>>>,
        deny: Cell<bool>,
        deny_approval: Cell<bool>,
    }
    impl Store for Memory {
        fn command(&self) -> Result<Option<String>, String> {
            Ok(self.command.borrow().clone())
        }
        fn write(&self, value: &str) -> Result<(), String> {
            if self.deny.get() {
                return Err("写入被拒绝".into());
            }
            *self.command.borrow_mut() = Some(value.into());
            Ok(())
        }
        fn remove(&self) -> Result<(), String> {
            if self.deny.get() {
                return Err("写入被拒绝".into());
            }
            *self.command.borrow_mut() = None;
            Ok(())
        }
        fn approval(&self) -> Result<Option<Vec<u8>>, String> {
            Ok(self.approval.borrow().clone())
        }
        fn clear_approval(&self) -> Result<(), String> {
            if self.deny_approval.get() {
                return Err("无法更改 Windows 禁用状态".into());
            }
            *self.approval.borrow_mut() = None;
            Ok(())
        }
    }
    #[test]
    fn quoted_paths_and_background_arguments_are_unambiguous() {
        assert_eq!(
            command(r"C:\Program Files\壁纸盒子\wallpaper-box.exe").unwrap(),
            "\"C:\\Program Files\\壁纸盒子\\wallpaper-box.exe\" --autostart"
        );
        assert_eq!(
            command(r"\\?\C:\App\wallpaper-box.exe").unwrap(),
            "\"C:\\App\\wallpaper-box.exe\" --autostart"
        );
        assert_eq!(
            command(r"\\?\UNC\server\share\wallpaper-box.exe").unwrap(),
            "\"\\\\server\\share\\wallpaper-box.exe\" --autostart"
        );
        assert!(command("C:\\App\\bad\"name.exe").is_err());
        assert!(command(&format!("C:\\{}\\app.exe", "路".repeat(260))).is_err());
        assert!(background_launch(["app.exe", "--autostart"]));
        assert!(!background_launch(["app.exe"]));
        assert!(!background_launch(["app.exe", "--autostart=false"]));
    }
    #[test]
    fn default_registration_and_disabled_preferences_survive_restart_and_path_changes() {
        let store = Memory::default();
        initialize(&store, "\"old.exe\" --autostart", true).unwrap();
        assert!(enabled(&store, "\"old.exe\" --autostart").unwrap());
        initialize(&store, "\"new.exe\" --autostart", true).unwrap();
        assert!(enabled(&store, "\"new.exe\" --autostart").unwrap());
        set_enabled(&store, "\"new.exe\" --autostart", false).unwrap();
        initialize(&store, "\"new.exe\" --autostart", false).unwrap();
        assert!(!enabled(&store, "\"new.exe\" --autostart").unwrap());
        assert!(store.command().unwrap().is_none());
    }
    #[test]
    fn windows_disabled_entries_stay_disabled_until_explicitly_enabled() {
        let store = Memory::default();
        initialize(&store, "command", true).unwrap();
        for state in [3, 7] {
            *store.approval.borrow_mut() = Some(vec![state, 0, 0, 0]);
            initialize(&store, "new command", true).unwrap();
            assert!(!enabled(&store, "new command").unwrap());
            set_enabled(&store, "new command", true).unwrap();
            assert!(enabled(&store, "new command").unwrap());
        }
    }
    #[test]
    fn failed_writes_do_not_claim_success_or_remove_an_existing_registration() {
        let store = Memory::default();
        store.deny.set(true);
        assert!(initialize(&store, "command", true).is_err());
        assert!(!enabled(&store, "command").unwrap());
        store.deny.set(false);
        initialize(&store, "command", true).unwrap();
        store.deny.set(true);
        assert!(set_enabled(&store, "command", false).is_err());
        assert!(enabled(&store, "command").unwrap());
    }

    #[test]
    fn failed_reenable_restores_the_previous_command_and_windows_disabled_state() {
        let store = Memory::default();
        initialize(&store, "old command", true).unwrap();
        *store.approval.borrow_mut() = Some(vec![3, 0, 0, 0]);
        store.deny_approval.set(true);
        assert!(set_enabled(&store, "new command", true).is_err());
        assert_eq!(store.command().unwrap().as_deref(), Some("old command"));
        assert!(!enabled(&store, "old command").unwrap());
    }
}
