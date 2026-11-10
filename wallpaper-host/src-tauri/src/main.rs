#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod content;
mod desktop;
mod host;

fn main() {
    host::run();
}
