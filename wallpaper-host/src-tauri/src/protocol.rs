use crate::catalog::{self, Module};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
};
use tauri::http::{Request, Response, StatusCode};

const MAX_BODY: u64 = 64 * 1024 * 1024;
const MAX_RANGE_BODY: u64 = 8 * 1024 * 1024;
const CONTENT_POLICY: &str = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";
const SETTINGS_ANCESTORS: &str =
    "frame-ancestors tauri://localhost http://tauri.localhost https://tauri.localhost";

fn initialize_html(bytes: Vec<u8>, script: &str) -> Vec<u8> {
    let mut html = String::from_utf8_lossy(&bytes).into_owned();
    let lower = html.to_ascii_lowercase();
    let head = lower.match_indices("<head").find_map(|(start, _)| {
        let next = lower.as_bytes().get(start + 5)?;
        if *next != b'>' && !next.is_ascii_whitespace() {
            return None;
        }
        lower[start..].find('>').map(|end| start + end + 1)
    });
    // Keep a leading doctype so documents without an explicit head retain standards mode.
    let offset = head
        .or_else(|| {
            lower
                .find("<!doctype")
                .and_then(|i| lower[i..].find('>').map(|end| i + end + 1))
        })
        .unwrap_or(0);
    html.insert_str(offset, &format!("<script>{script}</script>"));
    html.into_bytes()
}

fn unavailable(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Cache-Control", "no-store")
        .body(b"Wallpaper resource unavailable".to_vec())
        .expect("valid error response")
}

fn mime(extension: &str) -> &'static str {
    match extension {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "gltf" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "txt" | "glsl" | "vert" | "frag" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn byte_range(value: &str, length: u64) -> Option<(u64, u64)> {
    let range = value.strip_prefix("bytes=")?;
    if length == 0 || range.contains(',') {
        return None;
    }
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = length.saturating_sub(suffix);
        return Some((
            start,
            (length - 1).min(start.saturating_add(MAX_RANGE_BODY - 1)),
        ));
    }
    let start: u64 = start.parse().ok()?;
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>().ok()?.min(length - 1)
    };
    if start >= length || end < start {
        return None;
    }
    Some((start, end.min(start.saturating_add(MAX_RANGE_BODY - 1))))
}

/// A WebView resource interceptor, not an HTTP listener. The caller supplies
/// the wallpaper assigned to the requesting window; only the manager passes None.
pub fn serve(
    modules: &[Module],
    allowed_module: Option<&str>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    serve_with_settings(modules, allowed_module, request, None)
}

pub fn serve_with_settings(
    modules: &[Module],
    allowed_module: Option<&str>,
    request: Request<Vec<u8>>,
    settings: Option<&crate::wallpaper_settings::Snapshot>,
) -> Response<Vec<u8>> {
    if request.method() != "GET" && request.method() != "HEAD" {
        return Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("Allow", "GET, HEAD")
            .body(Vec::new())
            .expect("valid method response");
    }
    // Wry can expose either its native custom scheme or the WebView2 local
    // host equivalent. Reject similarly prefixed third-party hostnames.
    if let Some(host) = request.uri().host() {
        let accepted = host.eq_ignore_ascii_case("wallpaper.localhost")
            || (request.uri().scheme_str() == Some("wallpaper")
                && host.eq_ignore_ascii_case("localhost"));
        if !accepted || request.uri().port_u16().is_some() {
            return unavailable(StatusCode::NOT_FOUND);
        }
    }
    let decoded = match percent_encoding::percent_decode_str(request.uri().path()).decode_utf8() {
        Ok(decoded) => decoded,
        Err(_) => return unavailable(StatusCode::BAD_REQUEST),
    };
    let settings_asset: Option<(&[u8], &str)> = match decoded.as_ref() {
        "/__wallpaper_host__/settings.js" => Some((
            include_bytes!("../wallpaper-settings.js"),
            "application/javascript; charset=utf-8",
        )),
        "/__wallpaper_host__/settings.css" => Some((
            include_bytes!("../wallpaper-settings.css"),
            "text/css; charset=utf-8",
        )),
        _ => None,
    };
    if let Some((bytes, content_type)) = settings_asset {
        return Response::builder()
            .header("Content-Type", content_type)
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Length", bytes.len().to_string())
            .body(if request.method() == "HEAD" {
                Vec::new()
            } else {
                bytes.to_vec()
            })
            .expect("valid settings asset response");
    }
    let Some(path) = decoded.strip_prefix('/') else {
        return unavailable(StatusCode::NOT_FOUND);
    };
    let Some((id, relative)) = path.split_once('/') else {
        return unavailable(StatusCode::NOT_FOUND);
    };
    if allowed_module.is_some_and(|allowed| allowed != id) {
        return unavailable(StatusCode::FORBIDDEN);
    }
    let Some(module) = modules.iter().find(|module| module.id == id) else {
        return unavailable(StatusCode::NOT_FOUND);
    };
    let target = match catalog::inside_file(&module.root, relative) {
        Ok(target) => target,
        Err(_) => return unavailable(StatusCode::NOT_FOUND),
    };
    let mut file = match File::open(&target) {
        Ok(file) => file,
        Err(_) => return unavailable(StatusCode::NOT_FOUND),
    };
    let length = match file.metadata() {
        Ok(metadata) => metadata.len(),
        Err(_) => return unavailable(StatusCode::NOT_FOUND),
    };
    let extension = target
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let settings_page = module
        .settings
        .as_ref()
        .is_some_and(|page| page.entry == relative);
    let policy = if settings_page {
        CONTENT_POLICY.replace("frame-ancestors 'none'", SETTINGS_ANCESTORS)
    } else {
        CONTENT_POLICY.to_string()
    };
    let mut builder = Response::builder()
        .header("Content-Type", mime(&extension))
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Accept-Ranges", "bytes")
        .header("Content-Security-Policy", policy);
    if let Some(settings) = settings.filter(|_| matches!(extension.as_str(), "html" | "htm")) {
        if length > MAX_BODY {
            return unavailable(StatusCode::PAYLOAD_TOO_LARGE);
        }
        let mut bytes = Vec::new();
        if file.take(MAX_BODY + 1).read_to_end(&mut bytes).is_err() || bytes.len() as u64 != length
        {
            return unavailable(StatusCode::NOT_FOUND);
        }
        let bytes = initialize_html(bytes, &settings.script(id));
        return builder
            .header("Content-Length", bytes.len().to_string())
            .body(if request.method() == "HEAD" {
                Vec::new()
            } else {
                bytes
            })
            .expect("valid initialized HTML response");
    }
    let (start, end) = if let Some(range) = request.headers().get("Range") {
        let Some((start, end)) = range
            .to_str()
            .ok()
            .and_then(|value| byte_range(value, length))
        else {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header("Content-Range", format!("bytes */{length}"))
                .body(Vec::new())
                .expect("valid range response");
        };
        builder = builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header("Content-Range", format!("bytes {start}-{end}/{length}"));
        (start, end)
    } else {
        (0, length.saturating_sub(1))
    };
    let size = if length == 0 { 0 } else { end - start + 1 };
    if size > MAX_BODY && request.method() != "HEAD" {
        return unavailable(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let mut bytes = Vec::new();
    if request.method() != "HEAD" {
        if file.seek(SeekFrom::Start(start)).is_err()
            || file.take(size).read_to_end(&mut bytes).is_err()
        {
            return unavailable(StatusCode::NOT_FOUND);
        }
        if bytes.len() as u64 != size {
            return unavailable(StatusCode::NOT_FOUND);
        }
    }
    builder
        .header("Content-Length", size.to_string())
        .body(bytes)
        .expect("valid resource response")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::Path};

    fn modules(root: &Path) -> Vec<Module> {
        let builtin = root.join("builtin");
        fs::create_dir_all(builtin.join("scene/assets")).unwrap();
        fs::write(builtin.join("scene/index.html"), "abcdef").unwrap();
        fs::write(builtin.join("scene/assets/fish 1.png"), b"image").unwrap();
        let library = catalog::Library::prepare(builtin, root.join("user")).unwrap();
        library.discover().0
    }

    #[test]
    fn only_declared_settings_pages_can_be_framed_and_initial_config_precedes_scene_scripts() {
        let temporary = tempfile::tempdir().unwrap();
        let mut modules = modules(temporary.path());
        let module = &mut modules[0];
        fs::write(
            module.root.join("settings.html"),
            "<!doctype html><html><HEAD><script>readConfig()</script></HEAD></html>",
        )
        .unwrap();
        module.settings = Some(catalog::SettingsPage {
            entry: "settings.html".into(),
        });
        let snapshot = crate::wallpaper_settings::Snapshot::default()
            .updated(
                0,
                serde_json::json!({"text":"</script><script>bad()</script>"}),
            )
            .unwrap();
        let request = || {
            Request::builder()
                .uri("/scene/settings.html")
                .body(Vec::new())
                .unwrap()
        };
        let response = serve_with_settings(&modules, Some("scene"), request(), Some(&snapshot));
        let html = String::from_utf8(response.body().clone()).unwrap();
        assert!(
            html.find("__SCREEN_GARDEN_SET_SETTINGS").unwrap() < html.find("readConfig()").unwrap()
        );
        assert!(!html.contains("<script>bad()"));
        assert_eq!(
            response.headers()["Content-Length"],
            response.body().len().to_string()
        );
        let policy = response.headers()["Content-Security-Policy"]
            .to_str()
            .unwrap();
        assert!(policy.contains(SETTINGS_ANCESTORS));
        assert!(!policy.contains("frame-ancestors *"));
        assert!(serve(
            &modules,
            None,
            Request::builder()
                .uri("/scene/index.html")
                .body(Vec::new())
                .unwrap()
        )
        .headers()["Content-Security-Policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
        assert_eq!(
            serve(&modules, Some("other"), request()).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            serve(
                &modules,
                None,
                Request::builder()
                    .uri("/__wallpaper_host__/settings.js")
                    .body(Vec::new())
                    .unwrap()
            )
            .headers()["Content-Type"],
            "application/javascript; charset=utf-8"
        );
    }

    #[test]
    fn shared_settings_styles_are_available_without_relaxing_resource_rules() {
        let request = |uri: &str, method: &str| {
            Request::builder()
                .uri(uri)
                .method(method)
                .body(Vec::new())
                .unwrap()
        };
        let uri = "/__wallpaper_host__/settings.css";
        let response = serve(&[], None, request(uri, "GET"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()["Content-Type"],
            "text/css; charset=utf-8"
        );
        assert_eq!(response.headers()["X-Content-Type-Options"], "nosniff");
        assert_eq!(response.headers()["Cache-Control"], "no-store");
        assert_eq!(response.body(), include_bytes!("../wallpaper-settings.css"));
        let head = serve(&[], Some("scene"), request(uri, "HEAD"));
        assert!(head.body().is_empty());
        assert_eq!(
            head.headers()["Content-Length"],
            response.body().len().to_string()
        );
        assert_eq!(
            serve(&[], None, request(uri, "POST")).status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        assert_eq!(
            serve(
                &[],
                None,
                request(
                    "http://wallpaper.attacker.example/__wallpaper_host__/settings.css",
                    "GET"
                )
            )
            .status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn ordinary_head_and_single_byte_ranges_are_correct() {
        let temporary = tempfile::tempdir().unwrap();
        let modules = modules(temporary.path());
        let request = Request::builder()
            .uri("http://wallpaper.localhost/scene/index.html")
            .header("Range", "bytes=1-3")
            .body(Vec::new())
            .unwrap();
        let response = serve(&modules, Some("scene"), request);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()["Content-Range"], "bytes 1-3/6");
        assert_eq!(response.body(), b"bcd");
        let response = serve(
            &modules,
            Some("scene"),
            Request::builder()
                .uri("/scene/index.html")
                .method("HEAD")
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["Content-Length"], "6");
        assert!(response.body().is_empty());
        let response = serve(
            &modules,
            Some("scene"),
            Request::builder()
                .uri("/scene/index.html")
                .header("Range", "bytes=-2")
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(response.body(), b"ef");
        let response = serve(
            &modules,
            Some("scene"),
            Request::builder()
                .uri("/scene/index.html")
                .header("Range", "bytes=6-")
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }

    #[test]
    fn traversal_cross_wallpaper_and_hostname_spoofing_are_denied() {
        let temporary = tempfile::tempdir().unwrap();
        let modules = modules(temporary.path());
        for uri in [
            "/scene/%2e%2e/index.html",
            "/scene/%252e%252e/index.html",
            "/scene/assets%5csecret",
            "http://wallpaper.attacker.example/scene/index.html",
        ] {
            assert_eq!(
                serve(
                    &modules,
                    Some("scene"),
                    Request::builder().uri(uri).body(Vec::new()).unwrap()
                )
                .status(),
                StatusCode::NOT_FOUND,
                "{uri}"
            );
        }
        assert_eq!(
            serve(
                &modules,
                Some("another"),
                Request::builder()
                    .uri("/scene/index.html")
                    .body(Vec::new())
                    .unwrap()
            )
            .status(),
            StatusCode::FORBIDDEN
        );
        let response = serve(
            &modules,
            Some("scene"),
            Request::builder()
                .uri("/scene/assets/fish%201.png")
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(response.body(), b"image");
        assert_eq!(response.headers()["Content-Type"], "image/png");
    }

    #[test]
    fn non_read_methods_cannot_mutate_resources() {
        let temporary = tempfile::tempdir().unwrap();
        let modules = modules(temporary.path());
        let response = serve(
            &modules,
            Some("scene"),
            Request::builder()
                .uri("/scene/index.html")
                .method("POST")
                .body(b"replace".to_vec())
                .unwrap(),
        );
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(
            fs::read_to_string(modules[0].root.join("index.html")).unwrap(),
            "abcdef"
        );
    }
}
