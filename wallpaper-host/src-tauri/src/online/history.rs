//! Version choices are resolved from release catalogs, never supplied as URLs by IPC.
use super::*;
use std::collections::BTreeMap;

const PAGE_SIZE: usize = 10;
const MAX_PAGE: u32 = 100;
const MAX_CHOICES: usize = 2048;
type Key = (String, String, String);

#[derive(Default)]
pub struct Cache {
    revision: u64,
    choices: BTreeMap<Key, RemoteWallpaper>,
}

impl Cache {
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn clear(&mut self) {
        self.revision = self.revision.wrapping_add(1);
        self.choices.clear();
    }

    pub fn remember(&mut self, repository: &str, module_id: &str, page: &Page) {
        if self.choices.len() + page.wallpapers.len() > MAX_CHOICES {
            self.choices
                .retain(|(source, id, _), _| source == repository && id == module_id);
        }
        for item in &page.wallpapers {
            self.choices
                .entry((repository.into(), module_id.into(), item.version.clone()))
                .or_insert_with(|| item.clone());
        }
    }

    pub fn select(
        &self,
        repository: &str,
        module_id: &str,
        version: &str,
    ) -> Option<RemoteWallpaper> {
        self.choices
            .get(&(repository.into(), module_id.into(), version.into()))
            .cloned()
    }
}

#[derive(Clone, Serialize)]
pub struct Page {
    pub wallpapers: Vec<RemoteWallpaper>,
    pub next_page: Option<u32>,
    pub warning: Option<String>,
}

pub fn load(item: &RemoteWallpaper, page: u32, proxy: &ProxySettings) -> Result<Page, String> {
    let repository = Address::parse(&item.repository)?;
    load_with(item, page, &|url, maximum| {
        fetch(proxy, &repository, url, maximum, None, &|_, _| {})
    })
}

fn load_with(
    item: &RemoteWallpaper,
    page: u32,
    fetch: &impl Fn(&str, u64) -> Result<Vec<u8>, String>,
) -> Result<Page, String> {
    if !(1..=MAX_PAGE).contains(&page) {
        return Err("历史版本页码无效。".into());
    }
    let repository = Address::parse(&item.repository)?;
    let bytes = fetch(
        &format!(
            "{}?per_page={PAGE_SIZE}&page={page}",
            repository.releases_api()
        ),
        2 * MAX_CATALOG_BYTES,
    )?;
    let mut releases: Vec<Release> =
        serde_json::from_slice(&bytes).map_err(|_| "无法读取历史 Release，请稍后重试。")?;
    if releases.len() > PAGE_SIZE {
        return Err("历史 Release 列表超出大小限制。".into());
    }
    let next_page = (releases.len() == PAGE_SIZE && page < MAX_PAGE).then_some(page + 1);
    releases.retain(|release| release.version().is_ok());
    releases.sort_by_cached_key(|release| {
        std::cmp::Reverse(semver::Version::parse(release.version().unwrap()).unwrap())
    });
    let prefix = format!("{}-", item.id);
    let mut versions = BTreeMap::new();
    let mut warning = None;
    for release in releases {
        if !release
            .assets
            .iter()
            .any(|asset| asset.name == "catalog.json")
            || !release
                .assets
                .iter()
                .any(|asset| asset.name.starts_with(&prefix) && asset.name.ends_with(".zip"))
        {
            continue;
        }
        let result = (|| -> Result<(), String> {
            let url = release.asset(&repository, "catalog.json")?;
            let bytes = fetch(&url, MAX_CATALOG_BYTES)?;
            let catalog: RemoteCatalog =
                serde_json::from_slice(&bytes).map_err(|_| "历史壁纸清单格式无效。")?;
            let catalog = bind_release(catalog, &repository, &release)?;
            if let Some(version) = catalog
                .wallpapers
                .into_iter()
                .find(|entry| entry.id == item.id)
            {
                // Identical wallpaper versions may recur in several library releases.
                versions
                    .entry(semver::Version::parse(&version.version).unwrap())
                    .or_insert(version);
            }
            Ok(())
        })();
        if result.is_err() {
            warning = Some("部分历史版本未能加载，可以重试。".into());
        }
    }
    Ok(Page {
        wallpapers: versions.into_values().rev().collect(),
        next_page,
        warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn fixture(library_version: &str, version: &str) -> (serde_json::Value, RemoteCatalog) {
        let original = format!(
            "{}/releases/download/library-v{library_version}",
            repositories::GITHUB
        );
        let mirror = format!(
            "{}/releases/download/library-v{library_version}",
            repositories::GITEE
        );
        let filename = format!("scene-{version}.zip");
        let item: RemoteWallpaper = serde_json::from_value(serde_json::json!({
            "id":"scene", "name":"Scene", "version":version, "minAppVersion":"0.2.0",
            "entry":"index.html", "downloadUrl":format!("{original}/{filename}"),
            "sha256":"a".repeat(64), "size":100, "unpackedSize":200
        }))
        .unwrap();
        (
            serde_json::json!({"tag_name":format!("library-v{library_version}"),"assets":[
                {"name":"catalog.json","browser_download_url":format!("{mirror}/catalog.json")},
                {"name":filename,"browser_download_url":format!("{mirror}/{filename}")}
            ]}),
            RemoteCatalog {
                schema_version: 1,
                version: library_version.into(),
                wallpapers: vec![item],
            },
        )
    }

    #[test]
    fn history_is_sorted_deduplicated_and_bound_to_the_selected_mirror() {
        let fixtures = [
            fixture("1.0.0", "1.0.0"),
            fixture("1.2.0", "1.1.0"),
            fixture("1.1.0", "1.0.0"),
        ];
        let mut releases: Vec<_> = fixtures
            .iter()
            .map(|(release, _)| release.clone())
            .collect();
        let (mut draft, _) = fixture("1.3.0", "1.2.0");
        draft["draft"] = true.into();
        releases.push(draft);
        let (mut prerelease, _) = fixture("2.0.0", "2.0.0");
        prerelease["prerelease"] = true.into();
        releases.push(prerelease);
        let mut item = fixtures[0].1.wallpapers[0].clone();
        item.repository = repositories::GITEE.into();
        let requests = RefCell::new(Vec::new());
        let page = load_with(&item, 1, &|url, _| {
            requests.borrow_mut().push(url.to_string());
            if url.contains("/api/v5/") {
                return Ok(serde_json::to_vec(&releases).unwrap());
            }
            let (_, catalog) = fixtures
                .iter()
                .find(|(release, _)| release["assets"][0]["browser_download_url"] == url)
                .expect("only stable mirror catalogs may be fetched");
            Ok(serde_json::to_vec(catalog).unwrap())
        })
        .unwrap();
        assert_eq!(
            page.wallpapers
                .iter()
                .map(|item| item.version.as_str())
                .collect::<Vec<_>>(),
            vec!["1.1.0", "1.0.0"]
        );
        assert!(page
            .wallpapers
            .iter()
            .all(|item| item.repository == repositories::GITEE
                && item.download_url.starts_with(repositories::GITEE)));
        assert!(page.wallpapers[1].download_url.contains("library-v1.1.0"));
        assert_eq!(requests.borrow().len(), 4);
        assert!(page.warning.is_none());
        assert_eq!(page.next_page, None);
    }

    #[test]
    fn invalid_or_unavailable_catalogs_do_not_discard_other_versions() {
        let (good, catalog) = fixture("1.0.0", "1.0.0");
        let (mut bad, _) = fixture("1.1.0", "1.1.0");
        bad["assets"][0]["browser_download_url"] = "https://evil.example/catalog.json".into();
        let mut item = catalog.wallpapers[0].clone();
        item.repository = repositories::GITEE.into();
        let page = load_with(&item, 1, &|url, _| {
            assert!(!url.contains("evil.example"));
            if url.contains("/api/v5/") {
                Ok(serde_json::to_vec(&vec![good.clone(), bad.clone()]).unwrap())
            } else {
                Ok(serde_json::to_vec(&catalog).unwrap())
            }
        })
        .unwrap();
        assert_eq!(page.wallpapers.len(), 1);
        assert!(page.warning.is_some());
        assert!(load_with(&item, 1, &|_, _| Err("离线".into())).is_err());
    }

    #[test]
    fn paging_is_bounded_and_choices_cannot_cross_repositories_or_wallpapers() {
        let (_, catalog) = fixture("1.0.0", "1.0.0");
        let item = &catalog.wallpapers[0];
        for page in [0, MAX_PAGE + 1] {
            assert!(load_with(item, page, &|_, _| panic!(
                "invalid pages cannot make requests"
            ))
            .is_err());
        }
        let empty = serde_json::json!({"tag_name":"library-v1.0.0","assets":[]});
        let full = serde_json::to_vec(&vec![empty.clone(); PAGE_SIZE]).unwrap();
        assert_eq!(
            load_with(item, 1, &|_, _| Ok(full.clone()))
                .unwrap()
                .next_page,
            Some(2)
        );
        assert_eq!(
            load_with(item, MAX_PAGE, &|_, _| Ok(full.clone()))
                .unwrap()
                .next_page,
            None
        );
        let oversized = serde_json::to_vec(&vec![empty; PAGE_SIZE + 1]).unwrap();
        assert!(load_with(item, 1, &|_, _| Ok(oversized.clone())).is_err());
        let mut cache = Cache::default();
        let revision = cache.revision();
        cache.remember(
            repositories::GITHUB,
            "scene",
            &Page {
                wallpapers: vec![item.clone()],
                next_page: None,
                warning: None,
            },
        );
        assert!(cache
            .select(repositories::GITHUB, "scene", "1.0.0")
            .is_some());
        assert!(cache
            .select(repositories::GITEE, "scene", "1.0.0")
            .is_none());
        assert!(cache
            .select(repositories::GITHUB, "another-scene", "1.0.0")
            .is_none());
        assert!(cache
            .select(repositories::GITHUB, "scene", "2.0.0")
            .is_none());
        cache.clear();
        assert_ne!(cache.revision(), revision);
        assert!(cache
            .select(repositories::GITHUB, "scene", "1.0.0")
            .is_none());
    }
}
