fn main() {
    let commands = &[
        "get_state",
        "check_app_update",
        "download_app_update",
        "install_app_update",
        "refresh_modules",
        "select_monitor",
        "apply_wallpaper",
        "preview_wallpaper",
        "pause_wallpaper",
        "feed_aquarium",
        "remove_wallpaper",
        "auto_pause",
        "set_proxy",
        "set_wallpaper_repositories",
        "test_proxy",
        "load_online_cover",
        "hide_manager",
        "quit_app",
        "capture_desktop",
        "show_desktop",
        "check_online",
        "install_online",
        "rollback_wallpaper",
        "import_wallpaper",
        "open_wallpaper_folder",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("Tauri build failed");
}
