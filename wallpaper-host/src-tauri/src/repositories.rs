//! Public wallpaper release repositories and their persisted enable switches.
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const GITEE: &str = "https://gitee.com/xishuaiya/wallpapers";
pub const GITHUB: &str = "https://github.com/whoarei/wallpapers";
pub const MAX_REPOSITORIES: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Repository {
    pub url: String,
    pub enabled: bool,
}

pub fn defaults() -> Vec<Repository> {
    vec![
        Repository {
            url: GITEE.into(),
            enabled: true,
        },
        Repository {
            url: GITHUB.into(),
            enabled: false,
        },
    ]
}

pub fn normalize(repositories: Vec<Repository>) -> Result<Vec<Repository>, String> {
    if repositories.len() > MAX_REPOSITORIES {
        return Err(format!("最多可以配置 {MAX_REPOSITORIES} 个壁纸仓库。"));
    }
    let mut seen = HashSet::new();
    repositories
        .into_iter()
        .map(|mut repository| {
            repository.url = Address::parse(&repository.url)?.url;
            if !seen.insert(repository.url.clone()) {
                return Err("壁纸仓库地址重复，请保留一项。".into());
            }
            Ok(repository)
        })
        .collect()
}

#[derive(Clone, Debug)]
pub struct Address {
    pub url: String,
    pub host: String,
    owner: String,
    name: String,
}

impl Address {
    pub fn parse(address: &str) -> Result<Self, String> {
        let address = address.trim();
        if address.len() > 512 || address.chars().any(char::is_whitespace) {
            return Err("请输入完整的 GitHub 或 Gitee 仓库 HTTPS 地址。".into());
        }
        let url = Url::parse(address).map_err(|_| "壁纸仓库地址格式无效。")?;
        if url.scheme() != "https"
            || !matches!(url.host_str(), Some("github.com" | "gitee.com"))
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(
                "请使用公开的 GitHub 或 Gitee 仓库 HTTPS 地址，不要填写账号、参数或端口。".into(),
            );
        }
        let path = url.path().trim_end_matches('/');
        let path = path.strip_suffix(".git").unwrap_or(path);
        let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
        if parts.len() != 2
            || parts.iter().any(|part| {
                part.is_empty()
                    || part.len() > 100
                    || part.starts_with('.')
                    || part.ends_with('.')
                    || !part
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
            })
        {
            return Err("仓库地址应为 https://gitee.com/所有者/仓库名，可带 .git 后缀。".into());
        }
        let host = url.host_str().unwrap().to_string();
        let owner = parts[0].to_ascii_lowercase();
        let name = parts[1].to_ascii_lowercase();
        Ok(Self {
            url: format!("https://{host}/{owner}/{name}"),
            host,
            owner,
            name,
        })
    }

    pub fn latest_api(&self) -> String {
        let base = if self.host == "github.com" {
            "https://api.github.com/repos"
        } else {
            "https://gitee.com/api/v5/repos"
        };
        format!("{base}/{}/{}/releases/latest", self.owner, self.name)
    }

    pub fn validate_asset(
        &self,
        address: &str,
        filename: &str,
        version: Option<&str>,
    ) -> Result<(), String> {
        if address.len() > 2048 {
            return Err("壁纸资源地址过长。".into());
        }
        let url = Url::parse(address).map_err(|_| "壁纸资源地址无效。")?;
        if url.scheme() != "https"
            || url.host_str() != Some(self.host.as_str())
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("壁纸资源必须来自所选仓库的 HTTPS Release。".into());
        }
        let parts: Vec<_> = url.path_segments().ok_or("壁纸资源路径无效。")?.collect();
        if parts.len() != 6
            || !parts[0].eq_ignore_ascii_case(&self.owner)
            || !parts[1].eq_ignore_ascii_case(&self.name)
            || parts[2..4] != ["releases", "download"]
            || parts[5] != filename
        {
            return Err("壁纸资源不属于所选仓库。".into());
        }
        let release_version = parts[4]
            .strip_prefix("library-v")
            .ok_or("壁纸库标签无效。")?;
        semver::Version::parse(release_version).map_err(|_| "壁纸库标签版本无效。")?;
        if version.is_some_and(|version| version != release_version) {
            return Err("壁纸资源不属于当前清单的 Release。".into());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub draft: bool,
    pub assets: Vec<Asset>,
}
#[derive(Debug, Deserialize)]
pub struct Asset {
    pub name: String,
    pub browser_download_url: String,
}
impl Release {
    pub fn version(&self) -> Result<&str, String> {
        let version = self
            .tag_name
            .strip_prefix("library-v")
            .ok_or("最新 Release 不是壁纸库发行版。")?;
        let parsed = semver::Version::parse(version).map_err(|_| "壁纸库 Release 版本无效。")?;
        if self.prerelease || self.draft || !parsed.pre.is_empty() {
            return Err("壁纸库需要公开的稳定版 Release。".into());
        }
        Ok(version)
    }

    pub fn asset(&self, repository: &Address, name: &str) -> Result<String, String> {
        let matches: Vec<_> = self
            .assets
            .iter()
            .filter(|asset| asset.name == name)
            .collect();
        if matches.len() != 1 {
            return Err(format!("最新 Release 缺少唯一的附件：{name}"));
        }
        let address = &matches[0].browser_download_url;
        repository.validate_asset(address, name, Some(self.version()?))?;
        Ok(address.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_enable_only_gitee_and_urls_are_normalized() {
        let defaults = defaults();
        assert_eq!(
            defaults
                .iter()
                .filter(|repo| repo.enabled)
                .map(|repo| repo.url.as_str())
                .collect::<Vec<_>>(),
            vec![GITEE]
        );
        let normalized = normalize(vec![Repository {
            url: format!("{GITEE}.git/"),
            enabled: false,
        }])
        .unwrap();
        assert_eq!(normalized[0].url, GITEE);
        assert!(!normalized[0].enabled);
        assert!(normalize(Vec::new()).unwrap().is_empty());
        let mut duplicate = defaults;
        duplicate.push(Repository {
            url: format!("{GITEE}.git"),
            enabled: false,
        });
        assert!(normalize(duplicate).is_err());
    }

    #[test]
    fn repository_addresses_reject_non_repository_and_credential_urls() {
        for url in [
            "",
            "http://gitee.com/a/b",
            "https://gitee.com.evil.test/a/b",
            "https://gitee.com/a/b/releases",
            "https://user:secret@gitee.com/a/b",
            "https://gitee.com/a/b?q=x",
            "https://gitee.com/a/b#x",
            "https://gitee.com:8443/a/b",
            "https://gitee.com/a/%2e%2e",
            "https://gitee.com/a/b.git/path",
        ] {
            assert!(Address::parse(url).is_err(), "{url}");
        }
    }

    #[test]
    fn releases_bind_assets_to_the_selected_repository_and_version() {
        let repo = Address::parse(GITEE).unwrap();
        assert_eq!(
            repo.latest_api(),
            "https://gitee.com/api/v5/repos/xishuaiya/wallpapers/releases/latest"
        );
        let release: Release = serde_json::from_value(serde_json::json!({"tag_name":"library-v1.0.0", "assets":[{"name":"catalog.json", "browser_download_url":format!("{GITEE}/releases/download/library-v1.0.0/catalog.json")}]})).unwrap();
        assert!(release.asset(&repo, "catalog.json").is_ok());
        assert!(release
            .asset(&Address::parse(GITHUB).unwrap(), "catalog.json")
            .is_err());
        assert!(release.asset(&repo, "missing.zip").is_err());
        for url in [
            format!("{GITEE}/releases/download/library-v2.0.0/catalog.json"),
            format!("{GITEE}-other/releases/download/library-v1.0.0/catalog.json"),
            "https://foruda.gitee.com/catalog.json".into(),
        ] {
            assert!(repo
                .validate_asset(&url, "catalog.json", Some("1.0.0"))
                .is_err());
        }
    }
}
