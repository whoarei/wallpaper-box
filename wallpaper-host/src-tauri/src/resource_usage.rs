use serde::Serialize;
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

pub const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone, Default, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Sampling,
    Ready,
    Unavailable,
}

#[derive(Clone, Default, Debug, Serialize)]
pub struct Usage {
    pub status: Status,
    pub cpu_percent: Option<f64>,
    pub memory_bytes: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct ProcessGroup {
    pub browser_pid: u32,
    pub pids: Vec<u32>,
}

// A shared browser/GPU process cannot be assigned accurately to one wallpaper.
// Fail closed rather than charge another screen, manager or preview to it.
pub fn exclusive_group<'a>(
    label: &str,
    groups: &'a BTreeMap<String, Result<ProcessGroup, ()>>,
) -> Option<&'a ProcessGroup> {
    if groups.values().any(Result::is_err) {
        return None;
    }
    let group = groups.get(label)?.as_ref().ok()?;
    let shared = groups.iter().any(|(other_label, other)| {
        other_label != label
            && other
                .as_ref()
                .is_ok_and(|other| other.pids.iter().any(|pid| group.pids.contains(pid)))
    });
    (!shared).then_some(group)
}

#[derive(Clone, Debug)]
struct Counters {
    cpu_100ns: u64,
    memory_bytes: u64,
}

#[cfg(any(windows, test))]
fn private_page_bytes(blocks: &[usize], page_size: u32) -> u64 {
    let count = blocks
        .iter()
        .filter(|block| **block & (1 << 8) == 0)
        .count();
    count as u64 * u64::from(page_size)
}

#[derive(Clone, Debug)]
pub struct Measurement {
    at: Instant,
    wall_time_100ns: u64,
    browser: (u32, u64),
    // Creation time disambiguates recycled Windows process IDs.
    processes: BTreeMap<(u32, u64), Counters>,
    processor_count: u32,
}

fn cpu_percent(previous: &Measurement, current: &Measurement) -> Option<f64> {
    if previous.browser != current.browser
        || previous.processor_count != current.processor_count
        || current.processor_count == 0
    {
        return None;
    }
    let elapsed = current
        .at
        .checked_duration_since(previous.at)?
        .as_secs_f64();
    if elapsed <= 0.0 {
        return None;
    }
    let mut delta = 0u64;
    for (identity, counters) in &current.processes {
        let ticks = if let Some(old) = previous.processes.get(identity) {
            counters.cpu_100ns.checked_sub(old.cpu_100ns)?
        } else if identity.1 >= previous.wall_time_100ns {
            // A child born during this interval has no earlier baseline.
            counters.cpu_100ns
        } else {
            0
        };
        delta = delta.checked_add(ticks)?;
    }
    Some(
        (delta as f64 / 10_000_000.0 / elapsed / current.processor_count as f64 * 100.0)
            .clamp(0.0, 100.0),
    )
}

struct Entry {
    previous: Option<Measurement>,
    usage: Usage,
}

#[derive(Default)]
pub struct Monitor {
    last_poll: Option<Instant>,
    last_attempt: Option<Instant>,
    ticket: u64,
    entries: BTreeMap<u64, Entry>,
}

impl Monitor {
    pub fn reset(&mut self) {
        self.last_poll = None;
        self.last_attempt = None;
        self.entries.clear();
        self.ticket = self.ticket.wrapping_add(1);
    }

    pub fn begin(&mut self, now: Instant) -> Option<u64> {
        // Polling stops while the manager is hidden. Reopening after a gap
        // starts a fresh baseline, instead of averaging the hidden period.
        if self
            .last_poll
            .is_some_and(|last| now.duration_since(last) > SAMPLE_INTERVAL)
        {
            self.reset();
        }
        self.last_poll = Some(now);
        if self
            .last_attempt
            .is_some_and(|last| now.duration_since(last) < SAMPLE_INTERVAL)
        {
            return None;
        }
        self.last_attempt = Some(now);
        self.ticket = self.ticket.wrapping_add(1);
        Some(self.ticket)
    }

    pub fn finish(&mut self, ticket: u64, readings: BTreeMap<u64, Result<Measurement, ()>>) {
        if ticket != self.ticket {
            return;
        }
        let mut previous = std::mem::take(&mut self.entries);
        for (generation, reading) in readings {
            let entry = match reading {
                Ok(measurement) => {
                    let cpu = previous
                        .remove(&generation)
                        .and_then(|entry| entry.previous)
                        .and_then(|old| cpu_percent(&old, &measurement));
                    let memory = measurement
                        .processes
                        .values()
                        .try_fold(0u64, |total, counters| {
                            total.checked_add(counters.memory_bytes)
                        });
                    let status = if memory.is_none() {
                        Status::Unavailable
                    } else if cpu.is_some() {
                        Status::Ready
                    } else {
                        Status::Sampling
                    };
                    Entry {
                        previous: Some(measurement),
                        usage: Usage {
                            status,
                            cpu_percent: cpu,
                            memory_bytes: memory,
                        },
                    }
                }
                Err(()) => Entry {
                    previous: None,
                    usage: Usage {
                        status: Status::Unavailable,
                        ..Usage::default()
                    },
                },
            };
            self.entries.insert(generation, entry);
        }
    }

    pub fn usage(&self, generation: u64) -> Usage {
        self.entries
            .get(&generation)
            .map(|entry| entry.usage.clone())
            .unwrap_or_default()
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::mem::size_of;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment, ICoreWebView2Environment8, COREWEBVIEW2_PROCESS_KIND_BROWSER,
    };
    use windows::core::Interface;
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, GetLastError, ERROR_BAD_LENGTH, ERROR_INVALID_PARAMETER, FILETIME, HANDLE,
            STILL_ACTIVE,
        },
        System::{
            ProcessStatus::{
                K32GetProcessMemoryInfo, K32QueryWorkingSet, PROCESS_MEMORY_COUNTERS_EX2,
            },
            SystemInformation::{GetSystemInfo, GetSystemTimeAsFileTime, SYSTEM_INFO},
            Threading::{
                GetActiveProcessorCount, GetExitCodeProcess, GetProcessTimes, OpenProcess,
                PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
            },
        },
    };

    // Called on the WebView thread. Pass only PIDs back to the worker, never COM
    // objects. WebView2's own inventory also includes its GPU/utility processes.
    pub fn process_group(environment: ICoreWebView2Environment) -> Result<ProcessGroup, ()> {
        let read = || -> windows::core::Result<ProcessGroup> {
            let environment = environment.cast::<ICoreWebView2Environment8>()?;
            unsafe {
                let infos = environment.GetProcessInfos()?;
                let mut count = 0;
                infos.Count(&mut count)?;
                let mut group = ProcessGroup {
                    browser_pid: 0,
                    pids: vec![],
                };
                for index in 0..count {
                    let info = infos.GetValueAtIndex(index)?;
                    let mut pid = 0;
                    let mut kind = Default::default();
                    info.ProcessId(&mut pid)?;
                    info.Kind(&mut kind)?;
                    if pid > 0 {
                        group.pids.push(pid as u32);
                        if kind == COREWEBVIEW2_PROCESS_KIND_BROWSER {
                            group.browser_pid = pid as u32;
                        }
                    }
                }
                group.pids.sort_unstable();
                group.pids.dedup();
                Ok(group)
            }
        };
        let group = read().map_err(|_| ())?;
        (group.browser_pid != 0).then_some(group).ok_or(())
    }

    struct ProcessHandle(HANDLE);
    impl Drop for ProcessHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    fn ticks(time: FILETIME) -> u64 {
        (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
    }

    fn exited(handle: HANDLE) -> bool {
        let mut code = 0;
        unsafe { GetExitCodeProcess(handle, &mut code) != 0 && code != STILL_ACTIVE as u32 }
    }

    fn private_working_set(handle: HANDLE) -> Result<u64, ()> {
        unsafe {
            let mut memory = PROCESS_MEMORY_COUNTERS_EX2 {
                cb: size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32,
                ..Default::default()
            };
            if K32GetProcessMemoryInfo(
                handle,
                (&mut memory as *mut PROCESS_MEMORY_COUNTERS_EX2).cast(),
                memory.cb,
            ) != 0
            {
                return Ok(memory.PrivateWorkingSetSize as u64);
            }
            // EX2 requires the September 2023 Windows cumulative update. Older
            // Windows versions expose the same metric through working-set pages.
            // Each pointer-sized block has its Shared flag at bit 8.
            let mut pages = vec![0usize; 16 * 1024];
            loop {
                let bytes = (pages.len() * size_of::<usize>()) as u32;
                if K32QueryWorkingSet(handle, pages.as_mut_ptr().cast(), bytes) != 0 {
                    let count = pages[0];
                    let blocks = pages.get(1..count.checked_add(1).ok_or(())?).ok_or(())?;
                    let mut system = SYSTEM_INFO::default();
                    GetSystemInfo(&mut system);
                    return Ok(private_page_bytes(blocks, system.dwPageSize));
                }
                if GetLastError() != ERROR_BAD_LENGTH || bytes >= 16 * 1024 * 1024 {
                    return Err(());
                }
                pages.resize(pages.len() * 2, 0);
            }
        }
    }

    fn process(pid: u32) -> Result<Option<((u32, u64), Counters)>, ()> {
        unsafe {
            let raw = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            if raw.is_null() {
                return if GetLastError() == ERROR_INVALID_PARAMETER {
                    Ok(None)
                } else {
                    Err(())
                };
            }
            let handle = ProcessHandle(raw);
            let (mut created, mut exit, mut kernel, mut user) = Default::default();
            if GetProcessTimes(handle.0, &mut created, &mut exit, &mut kernel, &mut user) == 0 {
                return if exited(handle.0) { Ok(None) } else { Err(()) };
            }
            if exited(handle.0) {
                return Ok(None);
            }
            let memory_bytes = match private_working_set(handle.0) {
                Ok(bytes) => bytes,
                Err(()) if exited(handle.0) => return Ok(None),
                Err(()) => return Err(()),
            };
            Ok(Some((
                (pid, ticks(created)),
                Counters {
                    cpu_100ns: ticks(kernel).saturating_add(ticks(user)),
                    memory_bytes,
                },
            )))
        }
    }

    pub fn measure(group: &ProcessGroup) -> Result<Measurement, ()> {
        let at = Instant::now();
        let mut wall_time = FILETIME::default();
        unsafe {
            GetSystemTimeAsFileTime(&mut wall_time);
        }
        let mut processes = BTreeMap::new();
        for &pid in &group.pids {
            if let Some((identity, counters)) = process(pid)? {
                processes.insert(identity, counters);
            }
        }
        let browser = processes
            .keys()
            .find(|(pid, _)| *pid == group.browser_pid)
            .copied()
            .ok_or(())?;
        let processor_count = unsafe { GetActiveProcessorCount(0xffff) };
        if processor_count == 0 {
            return Err(());
        }
        Ok(Measurement {
            at,
            wall_time_100ns: ticks(wall_time),
            browser,
            processes,
            processor_count,
        })
    }
}

#[cfg(windows)]
pub use native::{measure, process_group};

#[cfg(test)]
mod tests {
    use super::*;

    fn measurement(at: Instant, wall_time: u64, processes: &[(u32, u64, u64, u64)]) -> Measurement {
        Measurement {
            at,
            wall_time_100ns: wall_time,
            browser: (processes[0].0, processes[0].1),
            processes: processes
                .iter()
                .map(|&(pid, created, cpu, memory)| {
                    (
                        (pid, created),
                        Counters {
                            cpu_100ns: cpu,
                            memory_bytes: memory,
                        },
                    )
                })
                .collect(),
            processor_count: 4,
        }
    }

    #[test]
    fn samples_no_faster_than_five_seconds_and_resets_after_hidden_gap() {
        let now = Instant::now();
        let mut monitor = Monitor::default();
        let first = monitor.begin(now).unwrap();
        monitor.finish(
            first,
            BTreeMap::from([(7, Ok(measurement(now, 100, &[(1, 1, 0, 128)])))]),
        );
        assert_eq!(monitor.usage(7).memory_bytes, Some(128));
        assert_eq!(monitor.usage(7).cpu_percent, None);
        for second in 1..5 {
            assert!(monitor.begin(now + Duration::from_secs(second)).is_none());
        }
        let second = monitor.begin(now + SAMPLE_INTERVAL).unwrap();
        monitor.finish(
            second,
            BTreeMap::from([(
                7,
                Ok(measurement(
                    now + SAMPLE_INTERVAL,
                    200,
                    &[(1, 1, 10_000_000, 64)],
                )),
            )]),
        );
        assert_eq!(monitor.usage(7).cpu_percent, Some(5.0));
        assert_eq!(monitor.usage(7).memory_bytes, Some(64));
        let resumed = monitor.begin(now + Duration::from_secs(20)).unwrap();
        assert_eq!(monitor.usage(7).status, Status::Sampling);
        monitor.finish(
            resumed,
            BTreeMap::from([(
                7,
                Ok(measurement(
                    now + Duration::from_secs(20),
                    300,
                    &[(1, 1, 200_000_000, 64)],
                )),
            )]),
        );
        assert_eq!(monitor.usage(7).cpu_percent, None);
    }

    #[test]
    fn normalizes_cpu_and_counts_children_born_in_the_interval() {
        let now = Instant::now();
        let before = measurement(
            now,
            100,
            &[(1, 1, 10_000_000, 100), (2, 2, 20_000_000, 200)],
        );
        let after = measurement(
            now + SAMPLE_INTERVAL,
            200,
            &[
                (1, 1, 20_000_000, 100),
                (2, 2, 30_000_000, 200),
                (3, 150, 10_000_000, 50),
            ],
        );
        // Three CPU-seconds over five seconds on four logical processors.
        assert_eq!(cpu_percent(&before, &after), Some(15.0));
    }

    #[test]
    fn recycled_pids_and_browser_restarts_do_not_reuse_old_counters() {
        let now = Instant::now();
        let before = measurement(
            now,
            100,
            &[(1, 1, 50_000_000, 100), (2, 2, 90_000_000, 200)],
        );
        let mut after = measurement(
            now + SAMPLE_INTERVAL,
            200,
            &[(1, 1, 50_000_000, 100), (2, 150, 10_000_000, 50)],
        );
        assert_eq!(cpu_percent(&before, &after), Some(5.0));
        after.browser = (1, 150);
        assert_eq!(cpu_percent(&before, &after), None);
    }

    #[test]
    fn failures_and_replaced_surfaces_never_display_stale_usage() {
        let now = Instant::now();
        let mut monitor = Monitor::default();
        let ticket = monitor.begin(now).unwrap();
        let value = measurement(now, 100, &[(1, 1, 0, 128)]);
        monitor.finish(ticket, BTreeMap::from([(1, Ok(value.clone()))]));
        assert_eq!(monitor.usage(2).memory_bytes, None);
        monitor.finish(ticket, BTreeMap::from([(1, Err(()))]));
        assert_eq!(monitor.usage(1).status, Status::Unavailable);
        assert_eq!(monitor.usage(1).memory_bytes, None);
        monitor.finish(ticket, BTreeMap::from([(2, Ok(value.clone()))]));
        assert_eq!(monitor.usage(1).memory_bytes, None);
        assert_eq!(monitor.usage(2).cpu_percent, None);
        monitor.reset();
        monitor.finish(ticket, BTreeMap::from([(2, Ok(value))]));
        assert_eq!(
            monitor.usage(2).memory_bytes,
            None,
            "hidden-window reset invalidates in-flight results"
        );
    }

    #[test]
    fn rejects_shared_and_incomplete_process_inventories() {
        let group = |root, pids| {
            Ok(ProcessGroup {
                browser_pid: root,
                pids,
            })
        };
        let mut groups = BTreeMap::from([
            ("wallpaper-a".into(), group(1, vec![1, 2, 3])),
            ("wallpaper-b".into(), group(4, vec![4, 5])),
            ("manager".into(), group(6, vec![6, 7])),
        ]);
        assert_eq!(
            exclusive_group("wallpaper-a", &groups).unwrap().browser_pid,
            1
        );
        groups.insert("preview".into(), group(8, vec![8, 3]));
        assert!(exclusive_group("wallpaper-a", &groups).is_none());
        assert!(exclusive_group("wallpaper-b", &groups).is_some());
        groups.insert("preview".into(), Err(()));
        assert!(exclusive_group("wallpaper-b", &groups).is_none());
    }

    #[test]
    fn older_windows_memory_fallback_counts_only_private_resident_pages() {
        // Protection and virtual-page fields must not be mistaken for Shared.
        let private = 0x12345usize << 12 | 4;
        let shared = 0xabcdefusize << 12 | (1 << 8) | (3 << 5) | 4;
        assert_eq!(private_page_bytes(&[private, shared, private], 4096), 8192);
        assert_eq!(private_page_bytes(&[shared], 4096), 0);
    }
}
