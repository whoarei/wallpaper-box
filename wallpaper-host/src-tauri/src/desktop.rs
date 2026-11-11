use serde::Serialize;
use std::{
    ffi::c_void,
    mem::size_of,
    ptr::{null, null_mut},
};
use windows_sys::core::BOOL;
use windows_sys::Win32::{
    Foundation::{GetLastError, SetLastError, HWND, LPARAM, POINT, RECT},
    Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, MapWindowPoints, HDC, HMONITOR, MONITORINFO,
        MONITORINFOEXW,
    },
    UI::{
        HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
        WindowsAndMessaging::*,
    },
};

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Display {
    pub id: String,
    pub name: String,
    pub primary: bool,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Attachment {
    pub hwnd: i64,
    pub parent: i64,
    pub parent_class: String,
    pub method: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub attached: bool,
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn from_wide(value: &[u16]) -> String {
    String::from_utf16_lossy(&value[..value.iter().position(|c| *c == 0).unwrap_or(value.len())])
}

pub fn displays() -> Vec<Display> {
    unsafe extern "system" fn collect(
        handle: HMONITOR,
        _: HDC,
        _: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let output = &mut *(data as *mut Vec<Display>);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(handle, &mut info as *mut _ as *mut MONITORINFO) != 0 {
            let rect = info.monitorInfo.rcMonitor;
            let mut dx = 96;
            let mut dy = 96;
            let _ = GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
            let id = from_wide(&info.szDevice);
            let primary = info.monitorInfo.dwFlags & 1 != 0;
            output.push(Display {
                name: format!(
                    "{}{}",
                    id.trim_start_matches("\\\\.\\"),
                    if primary { " · 主显示器" } else { "" }
                ),
                id,
                primary,
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
                scale: dx as f64 / 96.0,
            });
        }
        1
    }
    let mut output: Vec<Display> = Vec::new();
    unsafe {
        EnumDisplayMonitors(
            null_mut(),
            null(),
            Some(collect),
            &mut output as *mut _ as LPARAM,
        );
    }
    output.sort_by_key(|d| (!d.primary, d.x, d.y));
    output
}

pub fn window_class(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    unsafe {
        let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}

struct Shell {
    progman: HWND,
    worker: HWND,
    icons: HWND,
    raised: bool,
}

fn shell() -> Result<Shell, String> {
    unsafe extern "system" fn find_icons(top: HWND, data: LPARAM) -> BOOL {
        let output = &mut *(data as *mut (HWND, HWND));
        let icons = FindWindowExW(top, null_mut(), wide("SHELLDLL_DefView").as_ptr(), null());
        if !icons.is_null() {
            output.0 = icons;
            output.1 = FindWindowExW(null_mut(), top, wide("WorkerW").as_ptr(), null());
            return 0;
        }
        1
    }
    unsafe {
        let progman = FindWindowW(wide("Progman").as_ptr(), null());
        if progman.is_null() {
            return Err("Windows 桌面尚未就绪，未找到 Progman。".into());
        }
        let mut result = 0usize;
        SendMessageTimeoutW(progman, 0x052C, 0xD, 1, SMTO_NORMAL, 1000, &mut result);
        let mut found: (HWND, HWND) = (null_mut(), null_mut());
        EnumWindows(Some(find_icons), &mut found as *mut _ as LPARAM);
        let nested = FindWindowExW(progman, null_mut(), wide("WorkerW").as_ptr(), null());
        let worker = if !nested.is_null() { nested } else { found.1 };
        if worker.is_null() || found.0.is_null() {
            return Err("未找到 Windows 壁纸层，请稍后重试。".into());
        }
        let raised = !nested.is_null()
            || GetWindowLongPtrW(progman, GWL_EXSTYLE) as u32 & WS_EX_NOREDIRECTIONBITMAP != 0;
        Ok(Shell {
            progman,
            worker,
            icons: found.0,
            raised,
        })
    }
}

/// Attach only our own wallpaper HWND. Explorer's icon window is never reparented.
pub fn attach(handle: isize, display: &Display) -> Result<Attachment, String> {
    let shell = shell()?;
    unsafe {
        let hwnd = handle as HWND;
        let parent = if shell.raised {
            shell.progman
        } else {
            shell.worker
        };
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let style = (style
            & !(WS_POPUP
                | WS_CAPTION
                | WS_THICKFRAME
                | WS_SYSMENU
                | WS_MINIMIZEBOX
                | WS_MAXIMIZEBOX))
            | WS_CHILD
            | WS_CLIPSIBLINGS
            | WS_CLIPCHILDREN;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style as isize);
        let mut ex = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & !WS_EX_APPWINDOW)
            | WS_EX_TOOLWINDOW
            | WS_EX_NOACTIVATE;
        if shell.raised {
            ex |= WS_EX_LAYERED;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);
        if shell.raised && SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA) == 0 {
            return Err(format!("设置壁纸透明合成失败：{}", GetLastError()));
        }
        SetLastError(0);
        let previous = SetParent(hwnd, parent);
        if previous.is_null() && GetLastError() != 0 {
            return Err(format!("挂载桌面失败：Windows 错误 {}", GetLastError()));
        }
        let mut point = POINT {
            x: display.x,
            y: display.y,
        };
        MapWindowPoints(null_mut(), parent, &mut point, 1);
        let after = if shell.raised {
            shell.icons
        } else {
            HWND_BOTTOM
        };
        if SetWindowPos(
            hwnd,
            after,
            point.x,
            point.y,
            display.width,
            display.height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        ) == 0
        {
            return Err(format!("设置壁纸位置失败：{}", GetLastError()));
        }
        if shell.raised {
            SetWindowPos(
                shell.worker,
                HWND_BOTTOM,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
        let mut proof = inspect(handle);
        proof.method = if shell.raised {
            "Progman layered child"
        } else {
            "WorkerW child"
        }
        .into();
        if !proof.attached {
            return Err("壁纸窗口未能确认挂载到桌面。".into());
        }
        Ok(proof)
    }
}

pub fn inspect(handle: isize) -> Attachment {
    unsafe {
        let hwnd = handle as HWND;
        let parent = GetParent(hwnd);
        let class = window_class(parent);
        let mut rect: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut rect);
        Attachment {
            hwnd: handle as i64,
            parent: parent as i64,
            parent_class: class.clone(),
            method: String::new(),
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            attached: IsWindow(hwnd) != 0
                && IsWindow(parent) != 0
                && (class == "Progman" || class == "WorkerW"),
        }
    }
}

pub fn covering_window(display: &Display, ignore: &[isize]) -> Option<String> {
    struct Check<'a> {
        display: &'a Display,
        ignore: &'a [isize],
        covered: Option<String>,
    }
    unsafe extern "system" fn check(hwnd: HWND, data: LPARAM) -> BOOL {
        let state = &mut *(data as *mut Check<'_>);
        if state.ignore.contains(&(hwnd as isize))
            || IsWindowVisible(hwnd) == 0
            || IsIconic(hwnd) != 0
        {
            return 1;
        }
        let mut cloaked = 0u32;
        windows_sys::Win32::Graphics::Dwm::DwmGetWindowAttribute(
            hwnd,
            14,
            &mut cloaked as *mut _ as *mut c_void,
            size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return 1;
        }
        let class = window_class(hwnd);
        // NVIDIA's invisible CEF overlay can report a fullscreen rectangle even
        // while the desktop is visible. Utility overlays are not application coverage.
        if class == "CEF-OSC-WIDGET"
            || GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW != 0
        {
            return 1;
        }
        if ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"].contains(&class.as_str()) {
            return 1;
        }
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return 1;
        }
        let d = state.display;
        let width = (rect.right.min(d.x + d.width) - rect.left.max(d.x)).max(0) as i64;
        let height = (rect.bottom.min(d.y + d.height) - rect.top.max(d.y)).max(0) as i64;
        if width * height * 100 >= d.width as i64 * d.height as i64 * 95 {
            // EnumWindows is in Z order. Show Desktop raises the desktop above
            // otherwise-visible application windows; those windows cannot cover it.
            if class == "Progman" || class == "WorkerW" {
                return 0;
            }
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            if ex & WS_EX_TRANSPARENT != 0 {
                return 1;
            }
            let mut title = [0u16; 256];
            GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
            state.covered = Some(format!("{}: {}", class, from_wide(&title)));
            return 0;
        }
        1
    }
    let mut state = Check {
        display,
        ignore,
        covered: None,
    };
    unsafe {
        EnumWindows(Some(check), &mut state as *mut _ as LPARAM);
    }
    state.covered
}

pub fn desktop_handles() -> serde_json::Value {
    match shell() {
        Ok(s) => {
            serde_json::json!({"progman":s.progman as i64,"worker":s.worker as i64,"icons":s.icons as i64,"raised":s.raised})
        }
        Err(error) => serde_json::json!({"error":error}),
    }
}

#[allow(dead_code)]
fn _pointer_type(_: *mut c_void) {}

/// A user-invoked desktop preview: includes the actual compositor output and icons.
pub fn capture(display: &Display, output: &std::path::Path) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Gdi::*;
    let (width, height) = (display.width, display.height);
    unsafe {
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err("无法获取桌面图像。".into());
        }
        let memory = CreateCompatibleDC(screen);
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        if memory.is_null() || bitmap.is_null() {
            if !memory.is_null() {
                DeleteDC(memory);
            }
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            ReleaseDC(null_mut(), screen);
            return Err("无法创建桌面预览。".into());
        }
        let previous = SelectObject(memory, bitmap);
        let copied = BitBlt(
            memory,
            0,
            0,
            width,
            height,
            screen,
            display.x,
            display.y,
            SRCCOPY | CAPTUREBLT,
        );
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = width;
        info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        SelectObject(memory, previous);
        let lines = if copied != 0 {
            GetDIBits(
                memory,
                bitmap,
                0,
                height as u32,
                pixels.as_mut_ptr() as *mut c_void,
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        DeleteObject(bitmap);
        DeleteDC(memory);
        ReleaseDC(null_mut(), screen);
        if lines == 0 {
            return Err("读取桌面预览失败。".into());
        }
        let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
        for pixel in pixels.chunks_exact(4) {
            rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
        }
        let file = std::fs::File::create(output).map_err(|e| e.to_string())?;
        let mut encoder =
            png::Encoder::new(std::io::BufWriter::new(file), width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .map_err(|e| e.to_string())?
            .write_image_data(&rgb)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn show_desktop() -> Result<(), String> {
    use windows::Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{IShellDispatch4, Shell},
    };
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<()> {
            let shell: IShellDispatch4 = CoCreateInstance(&Shell, None, CLSCTX_INPROC_SERVER)?;
            shell.ToggleDesktop()
        })();
        if initialized.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| format!("无法显示桌面：{e}"))
    }
}

fn lowering_needed(order: &[isize], moving: isize, anchor: isize) -> bool {
    if moving == 0 || anchor == 0 {
        return false;
    }
    match (
        order.iter().position(|&h| h == moving),
        order.iter().position(|&h| h == anchor),
    ) {
        (Some(moving), Some(anchor)) => moving < anchor,
        _ => false,
    }
}

unsafe fn child_order(parent: HWND) -> Vec<isize> {
    let mut order = Vec::new();
    let mut child = GetTopWindow(parent);
    // Explorer may change its child windows while we inspect them. An incomplete
    // or cyclic snapshot must not cause a speculative reorder.
    while !child.is_null() && order.len() < 512 {
        if order.contains(&(child as isize)) {
            return vec![];
        }
        order.push(child as isize);
        child = GetWindow(child, GW_HWNDNEXT);
    }
    if child.is_null() {
        order
    } else {
        vec![]
    }
}

/// Repair relative desktop layering without reordering healthy wallpaper siblings.
/// Multiple wallpaper windows can all be below the icons; they must not each
/// demand the single slot immediately after the icon window every two seconds.
pub fn maintain_z_order(handle: isize) -> u64 {
    unsafe {
        let hwnd = handle as HWND;
        let parent = GetParent(hwnd);
        if window_class(parent) != "Progman" {
            return 0;
        }
        let icons = FindWindowExW(
            parent,
            null_mut(),
            wide("SHELLDLL_DefView").as_ptr(),
            null(),
        );
        let worker = FindWindowExW(parent, null_mut(), wide("WorkerW").as_ptr(), null());
        let mut order = child_order(parent);
        let mut repairs = 0;
        if lowering_needed(&order, handle, icons as isize) {
            if SetWindowPos(
                hwnd,
                icons,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            ) != 0
            {
                repairs += 1;
                order = child_order(parent);
            }
        }
        if lowering_needed(&order, worker as isize, handle) {
            if SetWindowPos(
                worker,
                HWND_BOTTOM,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            ) != 0
            {
                repairs += 1;
            }
        }
        repairs
    }
}

#[cfg(test)]
mod tests {
    use super::lowering_needed;

    const ICONS: isize = 1;
    const PRIMARY: isize = 2;
    const SECONDARY: isize = 3;
    const BACKDROP: isize = 4;

    fn maintain(order: &mut Vec<isize>, wallpaper: isize) -> usize {
        let mut moves = 0;
        if lowering_needed(order, wallpaper, ICONS) {
            order.retain(|&h| h != wallpaper);
            let index = order.iter().position(|&h| h == ICONS).unwrap();
            order.insert(index + 1, wallpaper);
            moves += 1;
        }
        if lowering_needed(order, BACKDROP, wallpaper) {
            order.retain(|&h| h != BACKDROP);
            order.push(BACKDROP);
            moves += 1;
        }
        moves
    }

    #[test]
    fn healthy_dual_monitor_layering_is_a_fixed_point_in_either_wallpaper_order() {
        for mut order in [
            vec![ICONS, PRIMARY, SECONDARY, BACKDROP],
            vec![ICONS, SECONDARY, PRIMARY, BACKDROP],
        ] {
            let original = order.clone();
            for _ in 0..30 {
                assert_eq!(maintain(&mut order, PRIMARY), 0);
                assert_eq!(maintain(&mut order, SECONDARY), 0);
                assert_eq!(order, original);
            }
        }
    }

    #[test]
    fn displaced_layers_are_repaired_once_then_remain_stable() {
        let mut order = vec![PRIMARY, BACKDROP, ICONS, SECONDARY];
        assert_eq!(maintain(&mut order, PRIMARY), 2);
        assert_eq!(order, vec![ICONS, PRIMARY, SECONDARY, BACKDROP]);
        for _ in 0..30 {
            assert_eq!(maintain(&mut order, SECONDARY), 0);
            assert_eq!(maintain(&mut order, PRIMARY), 0);
        }
        assert!(!lowering_needed(&order, 0, ICONS));
        assert!(!lowering_needed(&order, PRIMARY, 0));
        assert!(!lowering_needed(&order, PRIMARY, 999));
        assert!(!lowering_needed(&[], PRIMARY, ICONS));
    }
}
