use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const SERVICE: &str = "http://127.0.0.1:8088";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Module {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub description: String,
    pub href: String,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
struct Catalog {
    modules: Vec<Module>,
}

pub fn valid_module(module: &Module) -> bool {
    let id = &module.id;
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && module.href.starts_with(&format!("/{id}/"))
        && !module.href.contains("..")
        && !module.href.contains('\\')
        && !module.href.contains('%')
}

pub fn fetch() -> Result<Vec<Module>, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(4))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let data: Catalog = client
        .get(format!("{SERVICE}/api/modules"))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| "无法连接展示服务，请确认 Docker 展示服务正在运行。".to_string())?
        .json()
        .map_err(|e| format!("模块目录格式无效：{e}"))?;
    Ok(data.modules.into_iter().filter(valid_module).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn module(id: &str, href: &str) -> Module {
        Module {
            id: id.into(),
            name: id.into(),
            subtitle: String::new(),
            description: String::new(),
            href: href.into(),
            cover: None,
            tags: vec![],
        }
    }
    #[test]
    fn only_local_module_routes_are_allowed() {
        assert!(valid_module(&module("aquarium", "/aquarium/")));
        assert!(valid_module(&module(
            "pinewind-town",
            "/pinewind-town/view.html"
        )));
        assert!(!valid_module(&module("aquarium", "https://example.com/")));
        assert!(!valid_module(&module("aquarium", "/aquarium/../api/")));
        assert!(!valid_module(&module("aquarium", "/aquarium/%2e%2e/")));
        assert!(!valid_module(&module("../bad", "/bad/")));
    }
}
