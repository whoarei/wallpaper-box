use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub const ORIGIN: &str = "http://wallpaper.localhost";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct LocalizedMetadata {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub description: String,
}

pub fn valid_locales(locales: &BTreeMap<String, LocalizedMetadata>) -> bool {
    locales.len() <= 16
        && locales.iter().all(|(locale, metadata)| {
            !locale.is_empty()
                && locale.len() <= 64
                && locale
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && metadata.name.chars().count() <= 80
                && metadata.subtitle.chars().count() <= 80
                && metadata.description.chars().count() <= 300
        })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub subtitle: String,
    pub description: String,
    pub locales: BTreeMap<String, LocalizedMetadata>,
    pub href: String,
    pub cover: Option<String>,
    pub tags: Vec<String>,
    pub version: String,
    pub source: String,
    pub rollback_available: bool,
    pub settings: Option<SettingsPage>,
    pub settings_token: String,
    #[serde(skip)]
    pub root: PathBuf,
    #[serde(skip)]
    pub order: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SettingsPage {
    pub entry: String,
}

impl Module {
    pub fn localized_name(&self, locale: &str) -> &str {
        self.locales
            .get(locale)
            .map(|metadata| metadata.name.as_str())
            .filter(|name| !name.is_empty())
            .unwrap_or(&self.name)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    #[serde(default = "web_kind", rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub locales: BTreeMap<String, LocalizedMetadata>,
    #[serde(default = "default_entry")]
    pub entry: String,
    #[serde(default)]
    pub settings: Option<SettingsPage>,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default = "minimum_version")]
    pub min_app_version: String,
    #[serde(default = "default_order")]
    pub order: i64,
    #[serde(default = "enabled")]
    pub enabled: bool,
}
fn schema_version() -> u32 {
    1
}
fn web_kind() -> String {
    "web".into()
}
fn default_entry() -> String {
    "index.html".into()
}
fn default_version() -> String {
    "1.0.0".into()
}
fn minimum_version() -> String {
    "0.2.0".into()
}
fn default_order() -> i64 {
    100
}
fn enabled() -> bool {
    true
}
impl Default for Metadata {
    fn default() -> Self {
        serde_json::from_str("{}").expect("valid default metadata")
    }
}

#[derive(Clone, Debug)]
pub struct Library {
    pub builtin: PathBuf,
    pub user: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Active {
    pub current: String,
    pub previous: Option<String>,
}

fn reserved_name(component: &str) -> bool {
    let stem = component
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !reserved_name(id)
}

/// Validate a single, already percent-decoded relative resource path. Avoid
/// Windows aliases and ADS, as well as a second URL decoding opportunity.
pub fn valid_relative(value: &str) -> bool {
    if value.is_empty()
        || value.starts_with('/')
        || value.contains(['\\', ':', '%', '\0', '<', '>', '"', '|', '?', '*'])
    {
        return false;
    }
    value.split('/').all(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.ends_with(['.', ' '])
            && !part.chars().any(char::is_control)
            && !reserved_name(part)
    })
}

fn is_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

pub fn inside_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !valid_relative(relative) {
        return Err("资源路径无效。".into());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "壁纸目录不存在。".to_string())?;
    let file = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "资源文件不存在。".to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("资源超出壁纸目录。".into());
    }
    Ok(file)
}

pub fn metadata(root: &Path) -> Result<Metadata, String> {
    let descriptor = root.join("module.json");
    let meta: Metadata = if descriptor.exists() {
        let file = inside_file(root, "module.json")?;
        if fs::metadata(&file).map_err(|e| e.to_string())?.len() > 65_536 {
            return Err("module.json 超过 64 KiB。".into());
        }
        serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|error| format!("module.json 格式错误：{error}"))?
    } else {
        Metadata::default()
    };
    if meta.schema_version != 1 || meta.kind != "web" {
        return Err("不支持的壁纸类型或规范版本。".into());
    }
    if !valid_locales(&meta.locales) {
        return Err("壁纸翻译元数据无效。".into());
    }
    if !meta.entry.to_ascii_lowercase().ends_with(".html") {
        return Err("壁纸入口必须是 HTML。".into());
    }
    let playback_entry = inside_file(root, &meta.entry)?;
    if let Some(page) = &meta.settings {
        if !page.entry.to_ascii_lowercase().ends_with(".html")
            || inside_file(root, &page.entry)? == playback_entry
        {
            return Err("壁纸设置入口必须是独立的 HTML 页面。".into());
        }
    }
    if meta.id.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err("壁纸 ID 无效。".into());
    }
    let required = semver::Version::parse(&meta.min_app_version)
        .map_err(|_| "最低程序版本无效。".to_string())?;
    if required > semver::Version::parse(APP_VERSION).expect("valid application version") {
        return Err(format!(
            "该壁纸需要壁纸盒子 {} 或更新版本。",
            meta.min_app_version
        ));
    }
    semver::Version::parse(&meta.version).map_err(|_| "壁纸版本无效。".to_string())?;
    Ok(meta)
}

fn valid_activation(value: &str) -> bool {
    value == "builtin"
        || (valid_relative(value) && !value.contains('/') && semver::Version::parse(value).is_ok())
}

impl Library {
    pub fn prepare(builtin: PathBuf, user: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&user).map_err(|e| e.to_string())?;
        let user = user.canonicalize().map_err(|e| e.to_string())?;
        for subdirectory in ["local", "online", ".downloads", ".imports"] {
            let directory = user.join(subdirectory);
            if fs::symlink_metadata(&directory)
                .is_ok_and(|details| !details.is_dir() || is_reparse(&details))
            {
                return Err("用户壁纸目录不能使用文件或链接。".into());
            }
            fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            if is_reparse(&fs::symlink_metadata(&directory).map_err(|e| e.to_string())?)
                || !directory
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(&user)
            {
                return Err("用户壁纸目录不能使用越界链接。".into());
            }
        }
        Ok(Self { builtin, user })
    }

    pub fn active_path(&self, id: &str) -> PathBuf {
        self.user.join("online").join(id).join("active.json")
    }

    fn online_root(&self) -> Result<PathBuf, String> {
        let directory = self.user.join("online");
        if is_reparse(&fs::symlink_metadata(&directory).map_err(|e| e.to_string())?) {
            return Err("在线壁纸目录不能使用链接。".into());
        }
        let root = directory.canonicalize().map_err(|e| e.to_string())?;
        if !root.starts_with(&self.user) {
            return Err("在线壁纸目录越界。".into());
        }
        Ok(root)
    }

    pub fn active(&self, id: &str) -> Option<Active> {
        if !valid_id(id) {
            return None;
        }
        let online = self.online_root().ok()?;
        let folder = online.join(id).canonicalize().ok()?;
        if !folder.starts_with(&online) {
            return None;
        }
        let file = inside_file(&folder, "active.json").ok()?;
        if fs::metadata(&file).ok()?.len() > 8192 {
            return None;
        }
        let active: Active = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
        if !valid_activation(&active.current)
            || active
                .previous
                .as_deref()
                .is_some_and(|v| !valid_activation(v))
        {
            return None;
        }
        Some(active)
    }

    pub fn set_active(&self, id: &str, active: &Active) -> Result<(), String> {
        if !valid_id(id)
            || !valid_activation(&active.current)
            || active
                .previous
                .as_deref()
                .is_some_and(|value| !valid_activation(value))
        {
            return Err("壁纸 ID 或激活版本无效。".into());
        }
        let online = self.online_root()?;
        let folder = online.join(id);
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        if is_reparse(&fs::symlink_metadata(&folder).map_err(|e| e.to_string())?)
            || !folder
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(&online)
        {
            return Err("版本目录不能指向用户壁纸库之外。".into());
        }
        atomic_json(&folder.join("active.json"), active)
    }

    fn module(&self, folder: &Path, id: &str, source: &str) -> Result<Option<Module>, String> {
        let meta = metadata(folder)?;
        if !meta.enabled {
            return Ok(None);
        }
        if source != "local" && meta.id.as_deref().is_some_and(|value| value != id) {
            return Err("目录名与壁纸 ID 不一致。".into());
        }
        let key = if source == "local" {
            format!("local:{id}")
        } else {
            id.to_string()
        };
        let cover = meta.cover.clone().or_else(|| {
            ["cover.webp", "cover.jpg", "cover.png", "cover.svg"]
                .iter()
                .find(|name| folder.join(name).is_file())
                .map(|name| name.to_string())
        });
        let cover = cover
            .filter(|relative| inside_file(folder, relative).is_ok())
            .map(|relative| format!("/{key}/{relative}"));
        use sha2::{Digest, Sha256};
        let settings_token = format!(
            "{:x}",
            Sha256::digest(
                format!(
                    "{}\n{}\n{}",
                    folder.canonicalize().map_err(|e| e.to_string())?.display(),
                    meta.version,
                    meta.settings
                        .as_ref()
                        .map_or("", |page| page.entry.as_str())
                )
                .as_bytes()
            )
        );
        Ok(Some(Module {
            id: key.clone(),
            name: if meta.name.is_empty() {
                id.into()
            } else {
                meta.name.chars().take(80).collect()
            },
            subtitle: meta.subtitle.chars().take(80).collect(),
            description: meta.description.chars().take(300).collect(),
            locales: meta.locales,
            href: format!("/{key}/{}", meta.entry),
            settings: meta.settings,
            settings_token,
            cover,
            tags: meta
                .tags
                .into_iter()
                .take(8)
                .map(|tag| tag.chars().take(30).collect())
                .collect(),
            version: meta.version,
            source: source.into(),
            rollback_available: source != "local"
                && self.active(id).and_then(|active| active.previous).is_some(),
            root: folder.canonicalize().map_err(|e| e.to_string())?,
            order: meta.order,
        }))
    }

    fn scan(
        &self,
        root: &Path,
        source: &str,
        result: &mut BTreeMap<String, Module>,
        warnings: &mut Vec<String>,
    ) {
        if source != "builtin"
            && fs::symlink_metadata(root).is_ok_and(|details| is_reparse(&details))
        {
            warnings.push("用户壁纸目录不能使用链接。".into());
            return;
        }
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(error) => {
                warnings.push(format!("{}：{error}", root.display()));
                return;
            }
        };
        let Ok(canonical_root) = root.canonicalize() else {
            return;
        };
        if source != "builtin" && !canonical_root.starts_with(&self.user) {
            warnings.push("用户壁纸目录越界。".into());
            return;
        }
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().into_owned();
            if !valid_id(&id) {
                continue;
            }
            let Ok(details) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if !details.is_dir() || is_reparse(&details) {
                continue;
            }
            let Ok(base) = entry.path().canonicalize() else {
                continue;
            };
            if !base.starts_with(&canonical_root) {
                continue;
            }
            let mut expected_version = None;
            let folder = if source == "online" {
                let Some(active) = self.active(&id) else {
                    continue;
                };
                if active.current == "builtin" {
                    continue;
                }
                expected_version = Some(active.current.clone());
                let candidate = base.join(&active.current);
                let details = fs::symlink_metadata(&candidate);
                if !details
                    .as_ref()
                    .is_ok_and(|details| details.is_dir() && !is_reparse(details))
                {
                    warnings.push(format!("{id}：已激活的壁纸版本不存在。"));
                    continue;
                }
                let Ok(candidate) = candidate.canonicalize() else {
                    continue;
                };
                if !candidate.starts_with(&base) {
                    warnings.push(format!("{id}：版本目录越界。"));
                    continue;
                }
                candidate
            } else {
                base
            };
            match self.module(&folder, &id, source) {
                Ok(Some(module)) => {
                    if expected_version
                        .as_deref()
                        .is_some_and(|expected| expected != module.version)
                    {
                        warnings.push(format!("{id}：激活版本与壁纸元数据不一致。"));
                        continue;
                    }
                    result.insert(module.id.clone(), module);
                }
                Ok(None) => {}
                Err(error) => warnings.push(format!("{id}：{error}")),
            }
        }
    }

    pub fn discover(&self) -> (Vec<Module>, Vec<String>) {
        let mut result = BTreeMap::new();
        let mut warnings = Vec::new();
        self.scan(&self.builtin, "builtin", &mut result, &mut warnings);
        self.scan(
            &self.user.join("online"),
            "online",
            &mut result,
            &mut warnings,
        );
        self.scan(
            &self.user.join("local"),
            "local",
            &mut result,
            &mut warnings,
        );
        let mut modules: Vec<_> = result.into_values().collect();
        modules.sort_by(|left, right| left.order.cmp(&right.order).then(left.id.cmp(&right.id)));
        (modules, warnings)
    }

    pub fn rollback(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("壁纸 ID 无效。".into());
        }
        let active = self.active(id).ok_or("没有可回退的版本。")?;
        let previous = active.previous.clone().ok_or("没有可回退的版本。")?;
        let (container, root) = if previous == "builtin" {
            let container = self.builtin.canonicalize().map_err(|e| e.to_string())?;
            let root = container.join(id);
            (container, root)
        } else {
            let container = self
                .online_root()?
                .join(id)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let root = container.join(&previous);
            (container, root)
        };
        if is_reparse(&fs::symlink_metadata(&root).map_err(|e| e.to_string())?)
            || !root
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(&container)
        {
            return Err("回退版本目录越界。".into());
        }
        let meta = metadata(&root)?;
        if meta
            .id
            .as_deref()
            .is_some_and(|metadata_id| metadata_id != id)
            || (previous != "builtin" && meta.version != previous)
        {
            return Err("回退版本的元数据不一致。".into());
        }
        self.set_active(
            id,
            &Active {
                current: previous,
                previous: Some(active.current),
            },
        )
    }
}

/// Keep the old descriptor intact until a complete replacement is ready. Each
/// writer owns its temporary file; failure only removes that writer's file.
pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let parent = path.parent().ok_or("JSON 文件路径无效。")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let filename = path
        .file_name()
        .ok_or("JSON 文件名无效。")?
        .to_string_lossy();
    let temporary = parent.join(format!(
        ".{filename}.{}.{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translations_are_optional_bounded_and_fall_back_to_the_original_name() {
        let temporary = tempfile::tempdir().unwrap();
        let builtin = temporary.path().join("builtin");
        let folder = scene(&builtin, "scene", "1.0.0");
        fs::write(
            folder.join("module.json"),
            r#"{"id":"scene","name":"原名","locales":{"en":{"name":"English name"}}}"#,
        )
        .unwrap();
        let library = Library::prepare(builtin, temporary.path().join("user")).unwrap();
        let (modules, warnings) = library.discover();
        assert!(warnings.is_empty());
        assert_eq!(modules[0].localized_name("en"), "English name");
        assert_eq!(modules[0].localized_name("zh-CN"), "原名");
        assert_eq!(modules[0].locales["en"].description, "");
        assert!(Metadata::default().locales.is_empty());
        fs::write(
            folder.join("module.json"),
            serde_json::to_vec(&serde_json::json!({
                "id":"scene", "locales":{"en":{"name":"x".repeat(81)}}
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(metadata(&folder).is_err());
    }

    fn scene(root: &Path, id: &str, version: &str) -> PathBuf {
        let folder = root.join(id);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("index.html"), "<canvas></canvas>").unwrap();
        fs::write(
            folder.join("module.json"),
            serde_json::to_vec(&serde_json::json!({"id":id,"version":version})).unwrap(),
        )
        .unwrap();
        folder
    }

    #[test]
    fn optional_settings_pages_are_confined_to_the_package_and_version_bound() {
        let temporary = tempfile::tempdir().unwrap();
        let builtin = temporary.path().join("builtin");
        let folder = scene(&builtin, "scene", "1.0.0");
        assert!(metadata(&folder).unwrap().settings.is_none());
        fs::write(folder.join("settings.html"), "<html></html>").unwrap();
        let library = Library::prepare(builtin, temporary.path().join("user")).unwrap();
        for entry in [
            "../settings.html",
            "index.html",
            "missing.html",
            "settings.js",
            "http://example.com/settings.html",
        ] {
            fs::write(
                folder.join("module.json"),
                serde_json::json!({"settings":{"entry":entry}}).to_string(),
            )
            .unwrap();
            assert!(metadata(&folder).is_err(), "{entry}");
        }
        fs::write(
            folder.join("module.json"),
            r#"{"settings":{"entry":"settings.html"}}"#,
        )
        .unwrap();
        let original = library.discover().0.remove(0);
        assert_eq!(original.settings.unwrap().entry, "settings.html");
        fs::write(
            folder.join("module.json"),
            r#"{"version":"1.0.1","settings":{"entry":"settings.html"}}"#,
        )
        .unwrap();
        assert_ne!(
            original.settings_token,
            library.discover().0.remove(0).settings_token
        );
    }

    #[test]
    fn resource_paths_reject_traversal_and_windows_aliases() {
        for value in [
            "../x",
            "a/../../x",
            "/x",
            "C:/x",
            "a\\b",
            "a:x",
            "a%2f..",
            "NUL.txt",
            "a/COM1",
            "x.",
            "x ",
            "a//x",
        ] {
            assert!(!valid_relative(value), "{value}");
        }
        assert!(valid_relative("assets/fish 1.png"));
        assert!(valid_id("pinewind-town"));
        assert!(!valid_id("CON"));
    }

    #[test]
    fn discovery_is_offline_isolates_bad_modules_and_updates_folders() {
        let temporary = tempfile::tempdir().unwrap();
        let builtin = temporary.path().join("builtin");
        scene(&builtin, "aquarium", "1.0.0");
        let broken = scene(&builtin, "broken", "1.0.0");
        fs::write(broken.join("module.json"), "{").unwrap();
        let library = Library::prepare(builtin, temporary.path().join("user")).unwrap();
        let (modules, warnings) = library.discover();
        assert_eq!(modules.len(), 1);
        assert_eq!(warnings.len(), 1);
        assert_eq!(modules[0].id, "aquarium");
        scene(&library.user.join("local"), "aquarium", "2.0.0");
        let (modules, _) = library.discover();
        assert_eq!(modules.len(), 2);
        assert!(modules.iter().any(|module| module.id == "local:aquarium"));
        assert!(modules
            .iter()
            .any(|module| module.id == "aquarium" && module.version == "1.0.0"));
        fs::remove_file(library.user.join("local/aquarium/index.html")).unwrap();
        assert_eq!(library.discover().0.len(), 1);
    }

    #[test]
    fn activated_versions_override_builtins_and_can_rollback() {
        let temporary = tempfile::tempdir().unwrap();
        let builtin = temporary.path().join("builtin");
        scene(&builtin, "aquarium", "1.0.0");
        let library = Library::prepare(builtin, temporary.path().join("user")).unwrap();
        let installed = library.user.join("online/aquarium/1.1.0");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("index.html"), "Updated").unwrap();
        fs::write(
            installed.join("module.json"),
            r#"{"id":"aquarium","version":"1.1.0"}"#,
        )
        .unwrap();
        library
            .set_active(
                "aquarium",
                &Active {
                    current: "1.1.0".into(),
                    previous: Some("builtin".into()),
                },
            )
            .unwrap();
        assert_eq!(library.discover().0[0].source, "online");
        assert_eq!(library.discover().0[0].version, "1.1.0");
        library.rollback("aquarium").unwrap();
        assert_eq!(library.discover().0[0].source, "builtin");
        library.rollback("aquarium").unwrap();
        assert_eq!(library.discover().0[0].version, "1.1.0");
        assert!(library
            .set_active(
                "aquarium",
                &Active {
                    current: "../outside".into(),
                    previous: None
                }
            )
            .is_err());
    }

    #[test]
    fn future_versions_and_escaped_entries_do_not_hide_valid_wallpapers() {
        let temporary = tempfile::tempdir().unwrap();
        let builtin = temporary.path().join("builtin");
        scene(&builtin, "good", "1.0.0");
        let future = scene(&builtin, "future", "1.0.0");
        fs::write(future.join("module.json"), r#"{"minAppVersion":"999.0.0"}"#).unwrap();
        let escaped = scene(&builtin, "escaped", "1.0.0");
        fs::write(
            escaped.join("module.json"),
            r#"{"entry":"../good/index.html"}"#,
        )
        .unwrap();
        let library = Library::prepare(builtin, temporary.path().join("user")).unwrap();
        let (modules, warnings) = library.discover();
        assert_eq!(modules.len(), 1);
        assert_eq!(modules[0].id, "good");
        assert_eq!(warnings.len(), 2);
    }
}
