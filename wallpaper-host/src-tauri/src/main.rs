#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod desktop;
mod host;
mod online;
mod packages;
mod picker;
mod protocol;

fn main() {
    host::run();
}
