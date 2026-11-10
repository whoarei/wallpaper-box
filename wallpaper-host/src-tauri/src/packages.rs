//! Bounded, staged installation of static wallpaper packages.
use crate::catalog::{self, Library};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_PACKAGE_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_UNPACKED_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 4096;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn linked(metadata: &fs::Metadata) -> bool {
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

pub struct Stage {
    pub path: PathBuf,
    parent: PathBuf,
    moved: bool,
}

impl Stage {
    pub fn create(parent: &Path) -> Result<Self, String> {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        if linked(&fs::symlink_metadata(parent).map_err(|e| e.to_string())?) {
            return Err("临时目录不能使用链接。".into());
        }
        let parent = parent.canonicalize().map_err(|e| e.to_string())?;
        for _ in 0..20 {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = parent.join(format!(
                "stage-{}-{nanos}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&path) {
                Ok(()) => {
                    return Ok(Self {
                        path,
                        parent,
                        moved: false,
                    })
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("无法创建壁纸临时目录。".into())
    }

    pub fn move_root(&mut self, source: &Path, destination: &Path) -> Result<(), String> {
        let source = source.canonicalize().map_err(|e| e.to_string())?;
        let stage = self.path.canonicalize().map_err(|e| e.to_string())?;
        if !source.starts_with(&stage) || destination.exists() {
            return Err("不能覆盖已存在的壁纸目录。".into());
        }
        fs::rename(&source, destination).map_err(|e| format!("保存壁纸目录失败：{e}"))?;
        if source == stage {
            self.moved = true;
        }
        Ok(())
    }
}

impl Drop for Stage {
    fn drop(&mut self) {
        if self.moved {
            return;
        }
        // Only this instance's newly-created direct child is eligible for cleanup.
        if self.path.parent() != Some(self.parent.as_path())
            || !self
                .path
                .file_name()
                .is_some_and(|s| s.to_string_lossy().starts_with("stage-"))
        {
            return;
        }
        if let Ok(meta) = fs::symlink_metadata(&self.path) {
            if !linked(&meta) && self.path.canonicalize().ok().as_ref() == Some(&self.path) {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn package_path(name: &str) -> bool {
    name.len() <= 1024 && name.split('/').count() <= 32 && catalog::valid_relative(name)
}

fn static_file(name: &str) -> bool {
    !matches!(
        Path::new(name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "exe"
            | "dll"
            | "msi"
            | "com"
            | "bat"
            | "cmd"
            | "ps1"
            | "vbs"
            | "scr"
            | "pif"
            | "lnk"
            | "reg"
    )
}

/// Extract into a fresh private stage, never into the live version directory.
pub fn extract_zip(bytes: &[u8], destination: &Path) -> Result<u64, String> {
    if bytes.len() as u64 > MAX_PACKAGE_BYTES {
        return Err("壁纸包超过 128 MiB。".into());
    }
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("ZIP 文件无效：{e}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err("壁纸包文件数量过多。".into());
    }
    let mut names = HashSet::new();
    let mut nodes = HashMap::new();
    let mut declared_total = 0u64;
    // Validate all entries before creating a single extracted file.
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|e| format!("ZIP 条目损坏：{e}"))?;
        let name = file
            .name()
            .map_err(|e| format!("ZIP 文件名无效：{e}"))?
            .into_owned();
        let relative = name.trim_end_matches('/');
        let kind = file.unix_mode().map(|m| m & 0o170000).unwrap_or(0);
        if !package_path(relative)
            || file.enclosed_name().is_none()
            || file.is_symlink()
            || file.encrypted()
            || !matches!(kind, 0 | 0o100000 | 0o040000)
            || !names.insert(relative.to_lowercase())
        {
            return Err(format!("壁纸包包含不安全或重复的文件路径：{name}"));
        }
        if !file.is_dir() && !static_file(relative) {
            return Err("壁纸包只能包含网页和静态资源。".into());
        }
        let parts: Vec<_> = relative.split('/').collect();
        for count in 1..=parts.len() {
            let node = parts[..count].join("/").to_lowercase();
            let is_file = count == parts.len() && !file.is_dir();
            if nodes
                .insert(node, is_file)
                .is_some_and(|old| old != is_file)
            {
                return Err("壁纸包包含文件与目录冲突。".into());
            }
            if nodes.len() > MAX_ENTRIES {
                return Err("壁纸包目录与文件总数过多。".into());
            }
        }
        if file.size() > MAX_FILE_BYTES {
            return Err("壁纸包中的单个文件超过 64 MiB。".into());
        }
        declared_total = declared_total
            .checked_add(file.size())
            .ok_or("壁纸包大小无效。")?;
        if declared_total > MAX_UNPACKED_BYTES {
            return Err("壁纸包解压后超过 512 MiB。".into());
        }
    }
    let root = destination.canonicalize().map_err(|e| e.to_string())?;
    let mut actual_total = 0u64;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = file.name().map_err(|e| e.to_string())?.into_owned();
        let target = root.join(name.trim_end_matches('/'));
        if file.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        let parent = target.parent().ok_or("壁纸包路径无效。")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        if !parent
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&root)
        {
            return Err("解压路径越界。".into());
        }
        let expected = file.size();
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| format!("无法解压文件：{e}"))?;
        let copied = std::io::copy(&mut (&mut file).take(MAX_FILE_BYTES + 1), &mut output)
            .map_err(|e| format!("ZIP 解压失败：{e}"))?;
        if copied != expected || copied > MAX_FILE_BYTES {
            return Err("壁纸包文件大小不一致。".into());
        }
        output.flush().map_err(|e| e.to_string())?;
        actual_total = actual_total.checked_add(copied).ok_or("解压大小无效。")?;
        if actual_total > MAX_UNPACKED_BYTES {
            return Err("壁纸包解压后过大。".into());
        }
    }
    Ok(actual_total)
}

fn tree_files(root: &Path) -> Result<BTreeMap<String, (u64, String)>, String> {
    fn walk(
        root: &Path,
        folder: &Path,
        result: &mut BTreeMap<String, (u64, String)>,
        total: &mut u64,
        entries: &mut usize,
    ) -> Result<(), String> {
        for item in fs::read_dir(folder).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            *entries += 1;
            if *entries > MAX_ENTRIES {
                return Err("壁纸文件数量过多。".into());
            }
            let kind = item.file_type().map_err(|e| e.to_string())?;
            let relative = item
                .path()
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if linked(&fs::symlink_metadata(item.path()).map_err(|e| e.to_string())?)
                || !package_path(&relative)
            {
                return Err(format!("不支持的壁纸文件路径：{relative}"));
            }
            let canonical = item.path().canonicalize().map_err(|e| e.to_string())?;
            if !canonical.starts_with(root) {
                return Err("壁纸文件超出所选目录。".into());
            }
            if kind.is_dir() {
                walk(root, &canonical, result, total, entries)?;
            } else if kind.is_file() {
                if !static_file(&relative) {
                    return Err("壁纸目录只能包含网页和静态资源。".into());
                }
                let mut file = File::open(&canonical).map_err(|e| e.to_string())?;
                let size = file.metadata().map_err(|e| e.to_string())?.len();
                *total = total.checked_add(size).ok_or("壁纸大小无效。")?;
                if size > MAX_FILE_BYTES || *total > MAX_UNPACKED_BYTES {
                    return Err("壁纸目录体积过大。".into());
                }
                let mut sha = Sha256::new();
                let mut buffer = [0u8; 65536];
                let mut read = 0u64;
                loop {
                    let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
                    if count == 0 {
                        break;
                    }
                    read += count as u64;
                    if read > MAX_FILE_BYTES {
                        return Err("壁纸文件在读取过程中变大。".into());
                    }
                    sha.update(&buffer[..count]);
                }
                if read != size {
                    return Err("壁纸文件在读取过程中发生变化。".into());
                }
                if result
                    .insert(
                        relative.to_lowercase(),
                        (size, format!("{:x}", sha.finalize())),
                    )
                    .is_some()
                {
                    return Err("壁纸目录存在大小写重复文件。".into());
                }
            } else {
                return Err("壁纸目录存在不支持的文件类型。".into());
            }
        }
        Ok(())
    }
    if linked(&fs::symlink_metadata(root).map_err(|e| e.to_string())?) {
        return Err("壁纸目录不能使用链接。".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut result = BTreeMap::new();
    walk(&root, &root, &mut result, &mut 0, &mut 0)?;
    Ok(result)
}

pub fn identical_trees(first: &Path, second: &Path) -> Result<bool, String> {
    Ok(tree_files(first)? == tree_files(second)?)
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fn copy(
        root: &Path,
        source: &Path,
        destination: &Path,
        entries: &mut usize,
        total: &mut u64,
    ) -> Result<(), String> {
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let kind = item.file_type().map_err(|e| e.to_string())?;
            *entries += 1;
            if *entries > MAX_ENTRIES {
                return Err("导入文件数量过多。".into());
            }
            if linked(&fs::symlink_metadata(item.path()).map_err(|e| e.to_string())?) {
                return Err("不能导入符号链接。".into());
            }
            let relative = item
                .path()
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_path_buf();
            let relative_text = relative.to_string_lossy().replace('\\', "/");
            if !package_path(&relative_text)
                || !item
                    .path()
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(root)
            {
                return Err("导入路径无效或越界。".into());
            }
            let target = destination.join(&relative);
            if kind.is_dir() {
                fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                copy(root, &item.path(), destination, entries, total)?;
            } else if kind.is_file() {
                let parent = target.parent().ok_or("导入路径无效。")?;
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                let mut input = File::open(item.path()).map_err(|e| e.to_string())?;
                let mut output = OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&target)
                    .map_err(|e| e.to_string())?;
                let copied = std::io::copy(&mut (&mut input).take(MAX_FILE_BYTES + 1), &mut output)
                    .map_err(|e| e.to_string())?;
                *total = total.checked_add(copied).ok_or("导入大小无效。")?;
                if copied > MAX_FILE_BYTES || *total > MAX_UNPACKED_BYTES {
                    return Err("导入文件超过大小限制。".into());
                }
            } else {
                return Err("不能导入此文件类型。".into());
            }
        }
        Ok(())
    }
    let before = tree_files(source)?;
    copy(source, source, destination, &mut 0, &mut 0)?;
    if before != tree_files(destination)? {
        return Err("导入过程中壁纸文件发生变化，请重试。".into());
    }
    Ok(())
}

fn import_root(stage: &Path) -> Result<PathBuf, String> {
    if catalog::metadata(stage).is_ok() {
        return Ok(stage.to_path_buf());
    }
    let entries: Vec<_> = fs::read_dir(stage)
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    if entries.len() == 1 && entries[0].file_type().map_err(|e| e.to_string())?.is_dir() {
        let folder = entries[0].path();
        catalog::metadata(&folder)?;
        return Ok(folder);
    }
    Err("导入包应在根目录包含 index.html 或有效 module.json。".into())
}

fn slug(value: &str) -> String {
    let mut id = String::new();
    for byte in value.to_ascii_lowercase().bytes() {
        if byte.is_ascii_alphanumeric() {
            id.push(byte as char);
        } else if !id.ends_with('-') {
            id.push('-');
        }
        if id.len() >= 54 {
            break;
        }
    }
    let id = id.trim_matches('-');
    if id.is_empty() {
        "wallpaper".into()
    } else {
        id.into()
    }
}

pub fn import_path(library: &Library, source: &Path) -> Result<String, String> {
    if linked(&fs::symlink_metadata(source).map_err(|e| e.to_string())?) {
        return Err("请选择真实壁纸文件夹或 ZIP，不能导入链接。".into());
    }
    let source = source
        .canonicalize()
        .map_err(|e| format!("无法读取导入路径：{e}"))?;
    let mut stage = Stage::create(&library.user.join(".imports"))?;
    if stage.path.starts_with(&source) {
        return Err("不能导入包含壁纸数据目录的上级目录。".into());
    }
    if source.is_dir() {
        catalog::metadata(&source)?;
        copy_tree(&source, &stage.path)?;
    } else if source
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("zip"))
    {
        let mut archive = File::open(&source).map_err(|e| e.to_string())?;
        if archive.metadata().map_err(|e| e.to_string())?.len() > MAX_PACKAGE_BYTES {
            return Err("ZIP 文件超过 128 MiB。".into());
        }
        let mut bytes = Vec::new();
        (&mut archive)
            .take(MAX_PACKAGE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        extract_zip(&bytes, &stage.path)?;
    } else {
        return Err("请选择壁纸文件夹或 ZIP 文件。".into());
    }
    let root = import_root(&stage.path)?;
    let meta = catalog::metadata(&root)?;
    let original = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("wallpaper");
    let base = meta
        .id
        .filter(|id| catalog::valid_id(id))
        .unwrap_or_else(|| slug(original));
    if linked(&fs::symlink_metadata(library.user.join("local")).map_err(|e| e.to_string())?) {
        return Err("自定义壁纸目录不能使用链接。".into());
    }
    let local = library
        .user
        .join("local")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !local.starts_with(library.user.canonicalize().map_err(|e| e.to_string())?) {
        return Err("自定义壁纸目录越界。".into());
    }
    for index in 1..10000 {
        let id = if index == 1 {
            base.clone()
        } else {
            format!("{}-{index}", &base[..base.len().min(54)])
        };
        let destination = local.join(&id);
        if destination.exists() {
            continue;
        }
        stage.move_root(&root, &destination)?;
        return Ok(format!("local:{id}"));
    }
    Err("同名壁纸数量过多，请重新命名后导入。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    pub fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in files {
            zip.start_file(
                *name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn archives_cannot_escape_the_stage_or_use_windows_aliases() {
        for bad in [
            "../escape.txt",
            "C:/escape.txt",
            "a\\escape.txt",
            "NUL.txt",
            "a/../escape",
            "index.html:stream",
            "run.cmd",
        ] {
            let temp = tempfile::tempdir().unwrap();
            let bytes = archive(&[("index.html", b"ok"), (bad, b"bad")]);
            assert!(extract_zip(&bytes, temp.path()).is_err(), "{bad}");
            assert!(
                !temp.path().join("index.html").exists(),
                "Validation should happen before any writes"
            );
        }
    }

    #[test]
    fn case_duplicates_and_symlinks_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        assert!(extract_zip(
            &archive(&[("index.html", b"a"), ("INDEX.html", b"b")]),
            temp.path()
        )
        .is_err());
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.add_symlink("link", "../../outside", SimpleFileOptions::default())
            .unwrap();
        assert!(extract_zip(&zip.finish().unwrap().into_inner(), temp.path()).is_err());
    }

    #[test]
    fn implicit_directory_expansion_is_bounded_before_writes() {
        let temp = tempfile::tempdir().unwrap();
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for index in 0..130 {
            let mut parts = vec![format!("branch-{index}")];
            parts.extend((0..30).map(|n| format!("d{n}")));
            parts.push("file.txt".into());
            writer
                .start_file(parts.join("/"), SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"x").unwrap();
        }
        assert!(extract_zip(&writer.finish().unwrap().into_inner(), temp.path()).is_err());
        assert!(fs::read_dir(temp.path()).unwrap().next().is_none());
    }

    #[test]
    fn local_zip_import_keeps_existing_custom_and_builtin_files() {
        let temp = tempfile::tempdir().unwrap();
        let builtin = temp.path().join("builtin");
        fs::create_dir_all(builtin.join("scene")).unwrap();
        fs::write(builtin.join("scene/index.html"), "Builtin").unwrap();
        let library = Library::prepare(builtin.clone(), temp.path().join("user")).unwrap();
        let archive_path = temp.path().join("scene.zip");
        fs::write(&archive_path, archive(&[("scene/index.html", b"Local")])).unwrap();
        assert_eq!(import_path(&library, &archive_path).unwrap(), "local:scene");
        assert_eq!(
            import_path(&library, &archive_path).unwrap(),
            "local:scene-2"
        );
        assert_eq!(
            fs::read_to_string(builtin.join("scene/index.html")).unwrap(),
            "Builtin"
        );
        assert_eq!(
            fs::read_to_string(library.user.join("local/scene/index.html")).unwrap(),
            "Local"
        );
        assert!(fs::read_dir(library.user.join(".imports"))
            .unwrap()
            .next()
            .is_none());
    }
}
