//! Observe clicks without consuming Windows input. The hook only tracks a
//! gesture and enqueues bounded packets; Explorer/UIA work runs on a worker.
use std::{
    cell::RefCell,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
        Arc,
    },
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{GetLastError, HWND, LPARAM, LRESULT, POINT, WPARAM},
    System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT},
        WindowsAndMessaging::*,
    },
};

const MAX_CLICK_MS: u32 = 1000;
const MAX_QUEUE_DELAY: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Surface {
    pub generation: u64,
    pub hwnd: isize,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}
impl Surface {
    pub fn position(self, point: Point) -> Option<(f64, f64)> {
        if self.width <= 0 || self.height <= 0 {
            return None;
        }
        let x = i64::from(point.x) - i64::from(self.x);
        let y = i64::from(point.y) - i64::from(self.y);
        if x < 0 || y < 0 || x >= i64::from(self.width) || y >= i64::from(self.height) {
            return None;
        }
        Some((x as f64 / self.width as f64, y as f64 / self.height as f64))
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Click {
    pub surface: Surface,
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Copy, Debug)]
enum Event {
    Down(u64, Point),
    Click(u64, Point),
    Cancel,
}
#[derive(Clone, Copy)]
struct Packet {
    event: Event,
    hit: isize,
    at: Instant,
}
struct Press {
    sequence: u64,
    point: Point,
    time: u32,
    dragged: bool,
}
struct Gesture {
    sequence: u64,
    press: Option<Press>,
    drag_x: i32,
    drag_y: i32,
}
impl Gesture {
    fn new(drag_x: i32, drag_y: i32) -> Self {
        Self {
            sequence: 0,
            press: None,
            drag_x: drag_x.max(2),
            drag_y: drag_y.max(2),
        }
    }
    fn moved(&self, a: Point, b: Point) -> bool {
        (i64::from(a.x) - i64::from(b.x)).abs() >= i64::from(self.drag_x)
            || (i64::from(a.y) - i64::from(b.y)).abs() >= i64::from(self.drag_y)
    }
    fn sample(&mut self, message: u32, point: Point, time: u32, modified: bool) -> Option<Event> {
        match message {
            WM_LBUTTONDOWN if !modified => {
                self.sequence = self.sequence.wrapping_add(1);
                self.press = Some(Press {
                    sequence: self.sequence,
                    point,
                    time,
                    dragged: false,
                });
                Some(Event::Down(self.sequence, point))
            }
            WM_MOUSEMOVE => {
                let moved = self
                    .press
                    .as_ref()
                    .is_some_and(|p| self.moved(p.point, point));
                if moved {
                    if let Some(p) = self.press.as_mut() {
                        p.dragged = true;
                    }
                }
                None
            }
            WM_LBUTTONUP => {
                let p = self.press.take()?;
                if modified
                    || p.dragged
                    || self.moved(p.point, point)
                    || time.wrapping_sub(p.time) > MAX_CLICK_MS
                {
                    Some(Event::Cancel)
                } else {
                    Some(Event::Click(p.sequence, point))
                }
            }
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN | WM_MOUSEWHEEL => {
                self.press = None;
                Some(Event::Cancel)
            }
            _ => None,
        }
    }
}
struct HookState {
    gesture: Gesture,
    sender: SyncSender<Packet>,
}
thread_local! { static HOOK_STATE: RefCell<Option<HookState>> = const { RefCell::new(None) }; }

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && lparam != 0 {
        HOOK_STATE.with(|cell| {
            let Ok(mut state) = cell.try_borrow_mut() else {
                return;
            };
            let Some(state) = state.as_mut() else {
                return;
            };
            let message = wparam as u32;
            let mouse = &*(lparam as *const MSLLHOOKSTRUCT);
            let point = Point {
                x: mouse.pt.x,
                y: mouse.pt.y,
            };
            // Inspect only modifier state at button events; no keyboard hook.
            let modified = message != WM_MOUSEMOVE
                && [VK_CONTROL, VK_SHIFT, VK_MENU]
                    .iter()
                    .any(|key| GetAsyncKeyState(i32::from(*key)) < 0);
            if let Some(event) = state.gesture.sample(message, point, mouse.time, modified) {
                // This thread owns no windows, so hit testing cannot synchronously
                // call one of our own window procedures. UIA stays off the hook.
                let hit = if matches!(event, Event::Down(..) | Event::Click(..)) {
                    WindowFromPhysicalPoint(mouse.pt) as isize
                } else {
                    0
                };
                let _ = state.sender.try_send(Packet {
                    event,
                    hit,
                    at: Instant::now(),
                });
            }
        });
    }
    // Never suppress, replace or synthesize Windows input.
    CallNextHookEx(null_mut(), code, wparam, lparam)
}

pub struct Listener {
    thread_id: u32,
    stop: Arc<AtomicBool>,
}
impl Listener {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        unsafe {
            PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
        }
    }
}
impl Drop for Listener {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Only properties and parent relationships are read; no UIA actions are used.
unsafe fn desktop_blank(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    packet: Packet,
    surface: Surface,
) -> Option<isize> {
    use windows::Win32::UI::Accessibility::{UIA_ListControlTypeId, UIA_PaneControlTypeId};
    let point = match packet.event {
        Event::Down(_, p) | Event::Click(_, p) => p,
        Event::Cancel => return None,
    };
    let hit = packet.hit as HWND;
    if hit.is_null()
        || WindowFromPhysicalPoint(POINT {
            x: point.x,
            y: point.y,
        }) != hit
    {
        return None;
    }
    let root = GetAncestor(hit, GA_ROOT);
    let shell = GetShellWindow();
    if shell.is_null() || root.is_null() {
        return None;
    }
    let mut shell_pid = 0;
    let mut root_pid = 0;
    GetWindowThreadProcessId(shell, &mut shell_pid);
    GetWindowThreadProcessId(root, &mut root_pid);
    if shell_pid == 0
        || shell_pid != root_pid
        || !matches!(
            crate::desktop::window_class(root).as_str(),
            "Progman" | "WorkerW"
        )
    {
        return None;
    }
    let own = hit == surface.hwnd as HWND || IsChild(surface.hwnd as HWND, hit) != 0;
    let class = crate::desktop::window_class(hit);
    if !own
        && !matches!(
            class.as_str(),
            "SysListView32" | "SHELLDLL_DefView" | "Progman" | "WorkerW"
        )
    {
        return None;
    }
    let element = automation
        .ElementFromPoint(windows::Win32::Foundation::POINT {
            x: point.x,
            y: point.y,
        })
        .ok()?;
    if own {
        // With hidden desktop icons the wallpaper itself can be the native hit.
        // Require an accessibility ancestor belonging to our wallpaper, rather
        // than accepting a virtual Explorer icon that may be layered above it.
        let walker = automation.RawViewWalker().ok()?;
        let mut current = element;
        let mut ours = false;
        for _ in 0..12 {
            let native = current.CurrentNativeWindowHandle().ok()?.0 as HWND;
            if !native.is_null() {
                ours = native == surface.hwnd as HWND || IsChild(surface.hwnd as HWND, native) != 0;
                break;
            }
            current = walker.GetParentElement(&current).ok()?;
        }
        if !ours {
            return None;
        }
    } else {
        // Virtual ListItem/Text/Image children are icons (including labels).
        // Only the actual desktop container itself qualifies as blank space.
        let kind = element.CurrentControlType().ok()?;
        let native = element.CurrentNativeWindowHandle().ok()?.0 as HWND;
        let expected = if class == "SysListView32" {
            UIA_ListControlTypeId
        } else {
            UIA_PaneControlTypeId
        };
        if kind != expected || native != hit {
            return None;
        }
    }
    if WindowFromPhysicalPoint(POINT {
        x: point.x,
        y: point.y,
    }) != hit
        || packet.at.elapsed() > MAX_QUEUE_DELAY
    {
        return None;
    }
    Some(root as isize)
}

pub fn start(
    surfaces: impl Fn() -> Vec<Surface> + Send + 'static,
    deliver: impl Fn(Click) + Send + 'static,
) -> Result<Listener, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (sender, receiver) = mpsc::sync_channel::<Packet>(32);
    let (ready_send, ready) = mpsc::sync_channel(1);
    let worker_stop = stop.clone();
    std::thread::spawn(move || unsafe {
        use windows::{
            core::Interface,
            Win32::{
                System::Com::{
                    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                    COINIT_MULTITHREADED,
                },
                UI::Accessibility::{CUIAutomation8, IUIAutomation, IUIAutomation2},
            },
        };
        if let Err(e) = CoInitializeEx(None, COINIT_MULTITHREADED).ok() {
            let _ = ready_send.send(Err(e.to_string()));
            return;
        }
        {
            let automation =
                CoCreateInstance::<_, IUIAutomation>(&CUIAutomation8, None, CLSCTX_INPROC_SERVER);
            match automation {
                Err(e) => {
                    let _ = ready_send.send(Err(e.to_string()));
                }
                Ok(automation) => {
                    if let Ok(options) = automation.cast::<IUIAutomation2>() {
                        let _ = options.SetConnectionTimeout(250);
                        let _ = options.SetTransactionTimeout(250);
                    }
                    let _ = ready_send.send(Ok(()));
                    let mut pressed: Option<(u64, Surface, isize, isize)> = None;
                    while !worker_stop.load(Ordering::Acquire) {
                        let packet = match receiver.recv_timeout(Duration::from_millis(100)) {
                            Ok(p) => p,
                            Err(mpsc::RecvTimeoutError::Timeout) => continue,
                            Err(_) => break,
                        };
                        if packet.at.elapsed() > MAX_QUEUE_DELAY {
                            pressed = None;
                            continue;
                        }
                        match packet.event {
                            Event::Down(sequence, point) => {
                                pressed = None;
                                if let Some(surface) =
                                    surfaces().into_iter().find(|s| s.position(point).is_some())
                                {
                                    if let Some(root) = desktop_blank(&automation, packet, surface)
                                    {
                                        pressed = Some((sequence, surface, root, packet.hit));
                                    }
                                }
                            }
                            Event::Click(sequence, point) => {
                                let Some((down, surface, root, down_hit)) = pressed.take() else {
                                    continue;
                                };
                                if down != sequence
                                    || packet.hit != down_hit
                                    || !surfaces().contains(&surface)
                                {
                                    continue;
                                }
                                if desktop_blank(&automation, packet, surface) != Some(root) {
                                    continue;
                                }
                                if let Some((x, y)) = surface.position(point) {
                                    deliver(Click { surface, x, y });
                                }
                            }
                            Event::Cancel => pressed = None,
                        }
                    }
                }
            }
        }
        CoUninitialize();
    });
    match ready.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(())) => (),
        result => {
            stop.store(true, Ordering::Release);
            return Err(format!("桌面点击识别未能启动：{result:?}"));
        }
    }
    let (hook_send, hook_ready) = mpsc::sync_channel(1);
    let hook_stop = stop.clone();
    std::thread::spawn(move || unsafe {
        let mut message: MSG = std::mem::zeroed();
        PeekMessageW(&mut message, null_mut(), 0, 0, PM_NOREMOVE);
        HOOK_STATE.with(|cell| {
            *cell.borrow_mut() = Some(HookState {
                gesture: Gesture::new(
                    (GetSystemMetrics(SM_CXDRAG) + 1) / 2,
                    (GetSystemMetrics(SM_CYDRAG) + 1) / 2,
                ),
                sender,
            })
        });
        let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), GetModuleHandleW(null()), 0);
        if hook.is_null() {
            let _ = hook_send.send(Err(format!("鼠标观察未能启动：{}", GetLastError())));
        } else {
            let _ = hook_send.send(Ok(GetCurrentThreadId()));
            while !hook_stop.load(Ordering::Acquire)
                && GetMessageW(&mut message, null_mut(), 0, 0) > 0
            {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            UnhookWindowsHookEx(hook);
        }
        HOOK_STATE.with(|cell| *cell.borrow_mut() = None);
    });
    match hook_ready.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(thread_id)) => Ok(Listener { thread_id, stop }),
        result => {
            stop.store(true, Ordering::Release);
            Err(format!("桌面点击观察未能启动：{result:?}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ORIGIN: Point = Point { x: -960, y: 300 };
    #[test]
    fn only_short_unmodified_clicks_survive_and_dragging_back_still_cancels() {
        let mut g = Gesture::new(4, 4);
        assert!(matches!(
            g.sample(WM_LBUTTONDOWN, ORIGIN, 10, false),
            Some(Event::Down(1, _))
        ));
        assert!(matches!(
            g.sample(WM_LBUTTONUP, ORIGIN, 100, false),
            Some(Event::Click(1, _))
        ));
        g.sample(WM_LBUTTONDOWN, ORIGIN, 200, false);
        g.sample(WM_MOUSEMOVE, Point { x: -900, ..ORIGIN }, 250, false);
        g.sample(WM_MOUSEMOVE, ORIGIN, 300, false);
        assert!(matches!(
            g.sample(WM_LBUTTONUP, ORIGIN, 350, false),
            Some(Event::Cancel)
        ));
        g.sample(WM_LBUTTONDOWN, ORIGIN, 400, false);
        assert!(matches!(
            g.sample(WM_LBUTTONUP, ORIGIN, 500, true),
            Some(Event::Cancel)
        ));
        g.sample(WM_LBUTTONDOWN, ORIGIN, 600, false);
        assert!(matches!(
            g.sample(WM_LBUTTONUP, ORIGIN, 2000, false),
            Some(Event::Cancel)
        ));
        assert!(matches!(
            g.sample(WM_LBUTTONDOWN, ORIGIN, 2100, true),
            Some(Event::Cancel)
        ));
        assert!(g.sample(WM_LBUTTONUP, ORIGIN, 2150, false).is_none());
    }
    #[test]
    fn secondary_buttons_cancel_and_tick_wrap_does_not_drop_valid_clicks() {
        let mut g = Gesture::new(4, 4);
        g.sample(WM_LBUTTONDOWN, ORIGIN, u32::MAX - 20, false);
        assert!(matches!(
            g.sample(WM_LBUTTONUP, ORIGIN, 10, false),
            Some(Event::Click(..))
        ));
        g.sample(WM_LBUTTONDOWN, ORIGIN, 20, false);
        g.sample(WM_RBUTTONDOWN, ORIGIN, 25, false);
        assert!(g.sample(WM_LBUTTONUP, ORIGIN, 30, false).is_none());
    }
    #[test]
    fn physical_positions_are_normalized_with_negative_origins_and_half_open_edges() {
        let left = Surface {
            generation: 1,
            hwnd: 0,
            x: -1920,
            y: -200,
            width: 1920,
            height: 1080,
        };
        assert_eq!(left.position(ORIGIN), Some((0.5, 500.0 / 1080.0)));
        assert_eq!(left.position(Point { x: -1920, y: -200 }), Some((0.0, 0.0)));
        assert!(left.position(Point { x: 0, y: 300 }).is_none());
        assert!(left.position(Point { x: -1921, y: 300 }).is_none());
        let right = Surface {
            x: 0,
            width: 3840,
            height: 2160,
            y: 0,
            ..left
        };
        assert_eq!(right.position(Point { x: 1920, y: 1080 }), Some((0.5, 0.5)));
    }
}
