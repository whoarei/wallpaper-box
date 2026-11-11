//! Shared proxy policy for native release requests. Never change process-wide
//! environment variables: an in-flight request keeps its original configuration.
use reqwest::{
    blocking::{Client, ClientBuilder},
    redirect::Policy,
    Proxy, Url,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    #[default]
    System,
    Manual,
    Direct,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProxySettings {
    #[serde(default)]
    pub mode: ProxyMode,
    #[serde(default)]
    pub url: String,
}

impl ProxySettings {
    pub fn normalized(mut self) -> Result<Self, String> {
        if self.mode != ProxyMode::Manual {
            self.url.clear();
            return Ok(self);
        }
        let address = self.url.trim();
        if address.is_empty() || address.len() > 2048 || address.chars().any(char::is_whitespace) {
            return Err("请输入完整的代理地址，例如 http://127.0.0.1:7890。".into());
        }
        let url = Url::parse(address).map_err(|_| "代理地址格式无效。")?;
        if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h") {
            return Err("代理仅支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H。".into());
        }
        if url.host_str().is_none() || url.port_or_known_default().is_none_or(|port| port == 0) {
            return Err("代理地址需要有效的主机和端口。".into());
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("暂不支持带用户名或密码的代理地址，请使用本机代理端口。".into());
        }
        if !matches!(url.path(), "" | "/") || url.query().is_some() || url.fragment().is_some() {
            return Err("代理地址不能包含路径、查询参数或片段。".into());
        }
        self.url = url.to_string();
        Ok(self)
    }
}

fn configure(builder: ClientBuilder, settings: &ProxySettings) -> Result<ClientBuilder, String> {
    let settings = settings.clone().normalized()?;
    Ok(match settings.mode {
        // reqwest reads proxy environment variables first, then the Windows
        // system proxy. The system-proxy Cargo feature must stay enabled.
        ProxyMode::System => builder,
        ProxyMode::Direct => builder.no_proxy(),
        ProxyMode::Manual => builder
            .no_proxy()
            .proxy(Proxy::all(&settings.url).map_err(|_| "无法配置代理，请检查地址和端口。")?),
    })
}

pub fn github_client(settings: &ProxySettings) -> Result<Client, String> {
    release_client(settings, "github.com")
}

fn release_redirects(host: &str) -> Result<Policy, String> {
    let gitee = match host {
        "gitee.com" => true,
        "github.com" => false,
        _ => return Err("不支持的壁纸仓库平台。".into()),
    };
    Ok(Policy::custom(move |attempt| {
        let url = attempt.url();
        let allowed = if gitee {
            matches!(url.host_str(), Some("gitee.com" | "foruda.gitee.com"))
        } else {
            matches!(
                url.host_str(),
                Some(
                    "github.com"
                        | "api.github.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                        | "github-releases.githubusercontent.com"
                )
            )
        };
        if attempt.previous().len() > 6
            || !allowed
            || url.scheme() != "https"
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            attempt.error("Unexpected release download redirect")
        } else {
            attempt.follow()
        }
    }))
}

pub fn release_client(settings: &ProxySettings, host: &str) -> Result<Client, String> {
    configure(Client::builder(), settings)?
        .https_only(true)
        .http1_only()
        .user_agent(format!("WallpaperBox/{}", crate::catalog::APP_VERSION))
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(180))
        .redirect(release_redirects(host)?)
        .build()
        .map_err(|_| "无法初始化网络连接，请检查代理设置。".into())
}

pub fn async_release_client(
    settings: &ProxySettings,
    host: &str,
) -> Result<reqwest::Client, String> {
    let settings = settings.clone().normalized()?;
    let builder = reqwest::Client::builder();
    let builder = match settings.mode {
        ProxyMode::System => builder,
        ProxyMode::Direct => builder.no_proxy(),
        ProxyMode::Manual => builder
            .no_proxy()
            .proxy(Proxy::all(&settings.url).map_err(|_| "无法配置代理，请检查地址和端口。")?),
    };
    builder
        .https_only(true)
        .http1_only()
        .user_agent(format!("WallpaperBox/{}", crate::catalog::APP_VERSION))
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(180))
        .redirect(release_redirects(host)?)
        .build()
        .map_err(|_| "无法初始化网络连接，请检查代理设置。".into())
}

pub fn test_connection(settings: &ProxySettings) -> Result<(), String> {
    let response = github_client(settings)?
        .head("https://github.com")
        .timeout(Duration::from_secs(20))
        .send()
        .map_err(|_| "连接 GitHub 失败，请检查代理设置和网络后重试。")?;
    if !response.status().is_success() {
        return Err(format!(
            "连接 GitHub 返回 HTTP {}，请检查代理设置。",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        process::Command,
        thread,
    };

    fn manual(url: &str) -> ProxySettings {
        ProxySettings {
            mode: ProxyMode::Manual,
            url: url.into(),
        }
    }

    #[test]
    fn default_and_saved_settings_round_trip() {
        assert_eq!(
            serde_json::from_str::<ProxySettings>("{}").unwrap(),
            ProxySettings::default()
        );
        assert_eq!(ProxySettings::default().mode, ProxyMode::System);
        for address in [
            "http://127.0.0.1:7890",
            "https://proxy.example:443",
            "socks5://[::1]:1080",
            "socks5h://localhost:1080",
        ] {
            let settings = manual(address).normalized().unwrap();
            let saved = serde_json::to_vec(&settings).unwrap();
            assert_eq!(
                serde_json::from_slice::<ProxySettings>(&saved).unwrap(),
                settings
            );
            assert!(github_client(&settings).is_ok());
        }
        for mode in [ProxyMode::System, ProxyMode::Direct] {
            assert!(ProxySettings {
                mode,
                url: "old invalid address".into()
            }
            .normalized()
            .unwrap()
            .url
            .is_empty());
        }
    }

    #[test]
    fn invalid_manual_settings_are_rejected_without_echoing_input() {
        for address in [
            "",
            "127.0.0.1:7890",
            "ftp://localhost:21",
            "http://",
            "http://localhost:0",
            "socks5://localhost",
            "http://localhost:99999",
            "http://localhost:7890/path",
            "http://localhost:7890?q=x",
            "http://localhost:7890#fragment",
            "http://user:secret@localhost:7890",
            "http://local\nhost:7890",
        ] {
            let error = manual(address).normalized().unwrap_err();
            assert!(!error.contains("secret"));
        }
    }

    fn read_headers(stream: &mut std::net::TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") && bytes.len() < 8192 {
            let mut byte = [0];
            if stream.read(&mut byte).unwrap() == 0 {
                break;
            }
            bytes.push(byte[0]);
        }
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn manual_http_proxy_receives_connect_and_failure_does_not_fall_back() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let settings = manual(&format!("http://{}", listener.local_addr().unwrap()));
        let request = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let headers = read_headers(&mut stream);
            stream
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
            headers
        });
        assert!(github_client(&settings)
            .unwrap()
            .get("https://github.com/test")
            .send()
            .is_err());
        assert!(request
            .join()
            .unwrap()
            .starts_with("CONNECT github.com:443 HTTP/1.1\r\n"));
    }

    #[test]
    fn asynchronous_downloads_use_the_manual_proxy() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let settings = manual(&format!("http://{}", listener.local_addr().unwrap()));
        let request = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let headers = read_headers(&mut stream);
            stream
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
            headers
        });
        let result = tauri::async_runtime::block_on(async {
            let client = async_release_client(&settings, "gitee.com").unwrap();
            client.get("https://gitee.com/test").send().await
        });
        assert!(result.is_err());
        assert!(request
            .join()
            .unwrap()
            .starts_with("CONNECT gitee.com:443 HTTP/1.1\r\n"));
    }

    #[test]
    fn socks5_resolves_locally_and_socks5h_sends_the_domain_to_the_proxy() {
        for scheme in ["socks5", "socks5h"] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let settings = manual(&format!("{scheme}://{}", listener.local_addr().unwrap()));
            let greeting = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut header = [0; 2];
                stream.read_exact(&mut header).unwrap();
                let mut methods = vec![0; header[1] as usize];
                stream.read_exact(&mut methods).unwrap();
                assert_eq!(header[0], 5);
                assert!(methods.contains(&0));
                stream.write_all(&[5, 0]).unwrap();
                let mut connect = [0; 4];
                stream.read_exact(&mut connect).unwrap();
                assert_eq!(&connect[..3], &[5, 1, 0]);
                let length = match connect[3] {
                    1 => 4,
                    4 => 16,
                    3 => {
                        let mut length = [0];
                        stream.read_exact(&mut length).unwrap();
                        length[0] as usize
                    }
                    other => panic!("Unexpected SOCKS address type {other}"),
                };
                let mut destination = vec![0; length];
                stream.read_exact(&mut destination).unwrap();
                let mut port = [0; 2];
                stream.read_exact(&mut port).unwrap();
                assert_eq!(u16::from_be_bytes(port), 443);
                stream.write_all(&[5, 1, 0, 1, 0, 0, 0, 0, 0, 0]).unwrap();
                (connect[3], destination)
            });
            assert!(github_client(&settings)
                .unwrap()
                .get("https://localhost/test")
                .send()
                .is_err());
            let (address_type, destination) = greeting.join().unwrap();
            if scheme == "socks5h" {
                assert_eq!(address_type, 3);
                assert_eq!(destination, b"localhost");
            } else {
                assert!(matches!(address_type, 1 | 4));
            }
        }
    }

    #[test]
    fn system_uses_environment_and_direct_bypasses_it() {
        let origin = TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}/resource", origin.local_addr().unwrap());
        let proxy_address = format!("http://{}", proxy.local_addr().unwrap());
        let servers: Vec<_> = [(origin, "origin"), (proxy, "proxy")]
            .into_iter()
            .map(|(listener, body)| {
                thread::spawn(move || {
                    let (mut stream, _) = listener.accept().unwrap();
                    read_headers(&mut stream);
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .unwrap();
                })
            })
            .collect();
        // Isolate environment variables so parallel tests cannot change policy.
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "network::tests::environment_probe", "--ignored"])
            .env("WALLPAPER_TEST_ORIGIN", address)
            .env_remove("http_proxy")
            .env_remove("HTTPS_PROXY")
            .env_remove("https_proxy")
            .env_remove("ALL_PROXY")
            .env_remove("all_proxy")
            .env_remove("no_proxy")
            .env_remove("REQUEST_METHOD")
            // Windows environment names are case-insensitive: remove inherited
            // aliases before setting overrides, or env_remove erases them too.
            .env("HTTP_PROXY", proxy_address)
            // A nonempty explicit bypass list also isolates this test from the
            // machine's Windows registry proxy exclusions for loopback hosts.
            .env("NO_PROXY", "wallpaper-box-test.invalid")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        for server in servers {
            server.join().unwrap();
        }
    }

    #[test]
    #[ignore = "runs in an isolated child process"]
    fn environment_probe() {
        let address = std::env::var("WALLPAPER_TEST_ORIGIN").unwrap();
        for (mode, expected) in [(ProxyMode::System, "proxy"), (ProxyMode::Direct, "origin")] {
            let client = configure(
                Client::builder().timeout(Duration::from_secs(5)),
                &ProxySettings {
                    mode,
                    url: String::new(),
                },
            )
            .unwrap()
            .build()
            .unwrap();
            assert_eq!(
                client.get(&address).send().unwrap().text().unwrap(),
                expected
            );
        }
    }

    #[test]
    fn github_client_keeps_https_required() {
        assert!(github_client(&ProxySettings::default())
            .unwrap()
            .get("http://github.com")
            .send()
            .is_err());
    }
}
