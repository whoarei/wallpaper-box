#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_updates;
mod autostart;
mod catalog;
mod desktop;
mod desktop_input;
mod download_queue;
mod host;
mod network;
mod online;
mod packages;
mod picker;
mod protocol;
mod repositories;
mod resource_usage;

fn main() {
    host::run();
}
