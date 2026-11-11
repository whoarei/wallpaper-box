//! Bounded, generation-safe task state. Networking and installation live outside its lock.
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Instant,
};

pub const MAX_CONCURRENT: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Queued,
    Downloading,
    Cancelling,
    Verifying,
    WaitingInstall,
    Installing,
    Failed,
}
impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Downloading => "downloading",
            Self::Cancelling => "cancelling",
            Self::Verifying => "verifying",
            Self::WaitingInstall => "waiting_install",
            Self::Installing => "installing",
            Self::Failed => "failed",
        }
    }
}

#[derive(Default)]
pub struct Cancellation {
    cancelled: AtomicBool,
    abort: Mutex<Option<Box<dyn Fn() + Send>>>,
}
impl Cancellation {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
    pub fn on_abort(&self, abort: impl Fn() + Send + 'static) {
        let mut slot = self.abort.lock().unwrap();
        if self.is_cancelled() {
            drop(slot);
            abort();
        } else {
            *slot = Some(Box::new(abort));
        }
    }
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        let abort = self.abort.lock().unwrap().take();
        if let Some(abort) = abort {
            abort();
        }
    }
}

#[derive(Clone)]
pub struct Lease<T> {
    pub id: String,
    pub item: T,
    pub cancel: Arc<Cancellation>,
    generation: u64,
}

#[derive(Clone)]
pub struct Snapshot<T> {
    pub id: String,
    pub item: T,
    pub phase: Phase,
    pub received: u64,
    pub total: u64,
    pub speed: u64,
    pub error: Option<String>,
    pub queue_position: Option<usize>,
}

struct Task<T> {
    lease: Lease<T>,
    phase: Phase,
    received: u64,
    total: u64,
    speed: u64,
    error: Option<String>,
    leased: bool,
    sample: (Instant, u64),
}
struct State<T> {
    tasks: BTreeMap<String, Task<T>>,
    waiting: VecDeque<String>,
    next_generation: u64,
    running: usize,
    stopped: bool,
}
pub struct Queue<T> {
    state: Mutex<State<T>>,
    changed: Condvar,
}
impl<T: Clone> Default for Queue<T> {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                tasks: BTreeMap::new(),
                waiting: VecDeque::new(),
                next_generation: 0,
                running: 0,
                stopped: false,
            }),
            changed: Condvar::new(),
        }
    }
}
impl<T: Clone> Queue<T> {
    pub fn enqueue(&self, id: String, item: T, total: u64) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.stopped {
            return Err("程序正在退出。".into());
        }
        if state.tasks.contains_key(&id) {
            return Ok(()); // Retry is explicit, and pins the original requested version.
        }
        state.next_generation += 1;
        let lease = Lease {
            id: id.clone(),
            item,
            generation: state.next_generation,
            cancel: Arc::default(),
        };
        state.tasks.insert(
            id.clone(),
            Task {
                lease,
                phase: Phase::Queued,
                received: 0,
                total,
                speed: 0,
                error: None,
                leased: false,
                sample: (Instant::now(), 0),
            },
        );
        state.waiting.push_back(id);
        self.changed.notify_all();
        Ok(())
    }

    pub fn retry(&self, id: &str) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.stopped {
            return Err("程序正在退出。".into());
        }
        if state.tasks.get(id).is_none_or(|t| t.phase != Phase::Failed) {
            return Err("该下载任务无需重试。".into());
        }
        state.next_generation += 1;
        let generation = state.next_generation;
        let task = state.tasks.get_mut(id).unwrap();
        task.lease.generation = generation;
        task.lease.cancel = Arc::default();
        task.phase = Phase::Queued;
        task.received = 0;
        task.speed = 0;
        task.error = None;
        task.sample = (Instant::now(), 0);
        state.waiting.push_back(id.into());
        self.changed.notify_all();
        Ok(())
    }

    fn reserve(state: &mut State<T>) -> Option<Lease<T>> {
        if state.stopped || state.running >= MAX_CONCURRENT {
            return None;
        }
        let id = state.waiting.pop_front()?;
        let task = state.tasks.get_mut(&id).unwrap();
        task.phase = Phase::Downloading;
        task.leased = true;
        task.sample = (Instant::now(), 0);
        state.running += 1;
        Some(task.lease.clone())
    }
    pub fn next(&self) -> Option<Lease<T>> {
        let mut state = self.state.lock().unwrap();
        loop {
            if state.stopped {
                return None;
            }
            if let Some(lease) = Self::reserve(&mut state) {
                return Some(lease);
            }
            state = self.changed.wait(state).unwrap();
        }
    }
    #[cfg(test)]
    fn try_next(&self) -> Option<Lease<T>> {
        Self::reserve(&mut self.state.lock().unwrap())
    }
    fn matching<'a>(state: &'a mut State<T>, lease: &Lease<T>) -> Option<&'a mut Task<T>> {
        state
            .tasks
            .get_mut(&lease.id)
            .filter(|t| t.leased && t.lease.generation == lease.generation)
    }
    pub fn progress(&self, lease: &Lease<T>, received: u64) {
        let mut state = self.state.lock().unwrap();
        if let Some(task) = Self::matching(&mut state, lease) {
            if task.phase != Phase::Downloading {
                return;
            }
            if received < task.received {
                task.sample = (Instant::now(), received);
                task.speed = 0;
            }
            task.received = received.min(task.total);
            let elapsed = task.sample.0.elapsed().as_secs_f64();
            if elapsed >= 0.4 {
                task.speed = ((received.saturating_sub(task.sample.1)) as f64 / elapsed) as u64;
                task.sample = (Instant::now(), received);
            }
        }
    }
    pub fn phase(&self, lease: &Lease<T>, phase: Phase) -> bool {
        let mut state = self.state.lock().unwrap();
        if state.stopped {
            return false;
        }
        let Some(task) = Self::matching(&mut state, lease) else {
            return false;
        };
        if task.lease.cancel.is_cancelled()
            || matches!(task.phase, Phase::Installing | Phase::Cancelling)
        {
            return false;
        }
        task.phase = phase;
        task.speed = 0;
        true
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let token = {
            let mut state = self.state.lock().unwrap();
            let Some(task) = state.tasks.get_mut(id) else {
                return Ok(());
            };
            if task.phase == Phase::Installing {
                return Err("正在安装壁纸，请稍后再试。".into());
            }
            let token = task.lease.cancel.clone();
            if task.leased {
                task.phase = Phase::Cancelling;
                task.speed = 0;
            } else {
                state.tasks.remove(id);
                state.waiting.retain(|key| key != id);
            }
            token
        };
        token.cancel();
        self.changed.notify_all();
        Ok(())
    }
    pub fn finish(&self, lease: &Lease<T>, error: Option<String>) {
        let mut state = self.state.lock().unwrap();
        let Some(task) = Self::matching(&mut state, lease) else {
            return;
        };
        if let Some(error) =
            error.filter(|_| !lease.cancel.is_cancelled() && task.phase != Phase::Cancelling)
        {
            task.phase = Phase::Failed;
            task.error = Some(error);
            task.speed = 0;
            task.leased = false;
        } else {
            state.tasks.remove(&lease.id);
        }
        state.running -= 1;
        self.changed.notify_all();
    }
    pub fn snapshot(&self) -> Vec<Snapshot<T>> {
        let state = self.state.lock().unwrap();
        state
            .tasks
            .values()
            .map(|t| Snapshot {
                id: t.lease.id.clone(),
                item: t.lease.item.clone(),
                phase: t.phase,
                received: t.received,
                total: t.total,
                speed: t.speed,
                error: t.error.clone(),
                queue_position: state
                    .waiting
                    .iter()
                    .position(|id| id == &t.lease.id)
                    .map(|p| p + 1),
            })
            .collect()
    }
    pub fn close(&self) {
        let tokens = {
            let mut state = self.state.lock().unwrap();
            state.stopped = true;
            state
                .tasks
                .values()
                .map(|t| t.lease.cancel.clone())
                .collect::<Vec<_>>()
        };
        for token in tokens {
            token.cancel();
        }
        self.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue(count: usize) -> Queue<usize> {
        let queue = Queue::default();
        for id in 0..count {
            queue.enqueue(id.to_string(), id, 100).unwrap();
        }
        queue
    }
    #[test]
    fn five_leases_and_fifo_backfill_never_exceed_the_limit() {
        let queue = queue(8);
        let leases: Vec<_> = (0..5).map(|_| queue.try_next().unwrap()).collect();
        assert!(queue.try_next().is_none());
        assert_eq!(
            queue
                .snapshot()
                .iter()
                .find(|t| t.id == "5")
                .unwrap()
                .queue_position,
            Some(1)
        );
        queue.finish(&leases[2], None);
        assert_eq!(queue.try_next().unwrap().id, "5");
        assert!(queue.try_next().is_none());
    }
    #[test]
    fn cancellation_waits_for_the_real_worker_and_cancels_late_registration() {
        let queue = queue(6);
        let leases: Vec<_> = (0..5).map(|_| queue.try_next().unwrap()).collect();
        queue.cancel("0").unwrap();
        let aborted = Arc::new(AtomicBool::new(false));
        let seen = aborted.clone();
        leases[0].cancel.on_abort(move || {
            seen.store(true, Ordering::SeqCst);
        });
        assert!(aborted.load(Ordering::SeqCst));
        assert!(queue.try_next().is_none());
        queue.finish(&leases[0], Some("aborted".into()));
        assert_eq!(queue.try_next().unwrap().id, "5");
        assert!(!queue.snapshot().iter().any(|t| t.id == "0"));
    }
    #[test]
    fn queued_removal_and_duplicate_requests_do_not_change_fifo_or_active_versions() {
        let queue = queue(3);
        queue.enqueue("0".into(), 99, 900).unwrap();
        queue.cancel("1").unwrap();
        let first = queue.try_next().unwrap();
        assert_eq!(first.item, 0);
        assert_eq!(queue.try_next().unwrap().id, "2");
    }
    #[test]
    fn failure_is_local_and_retry_pins_item_while_stale_callbacks_are_ignored() {
        let queue = queue(2);
        let old = queue.try_next().unwrap();
        queue.progress(&old, 30);
        queue.finish(&old, Some("network".into()));
        queue.enqueue("0".into(), 99, 900).unwrap();
        queue.retry("0").unwrap();
        assert_eq!(queue.try_next().unwrap().id, "1");
        let retry = queue.try_next().unwrap();
        assert_eq!(retry.item, 0);
        queue.progress(&old, 90);
        queue.finish(&old, None);
        let task = queue.snapshot().into_iter().find(|t| t.id == "0").unwrap();
        assert_eq!(task.received, 0);
        assert_eq!(task.phase, Phase::Downloading);
        queue.finish(&retry, None);
    }
    #[test]
    fn installation_cannot_be_cancelled_and_does_not_report_completion_early() {
        let queue = queue(1);
        let lease = queue.try_next().unwrap();
        queue.progress(&lease, 100);
        assert!(queue.phase(&lease, Phase::Verifying));
        assert!(queue.phase(&lease, Phase::WaitingInstall));
        assert!(queue.phase(&lease, Phase::Installing));
        assert!(queue.cancel("0").is_err());
        assert_eq!(queue.snapshot()[0].phase, Phase::Installing);
        queue.finish(&lease, None);
        assert!(queue.snapshot().is_empty());
    }
    #[test]
    fn worker_threads_wake_for_work_and_shutdown_without_leaking_permits() {
        let queue = Arc::new(queue(0));
        let worker_queue = queue.clone();
        let (send, recv) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            while let Some(lease) = worker_queue.next() {
                worker_queue.finish(&lease, None);
                send.send(lease.id).unwrap();
            }
        });
        queue.enqueue("ready".into(), 1, 100).unwrap();
        assert_eq!(
            recv.recv_timeout(std::time::Duration::from_secs(2))
                .unwrap(),
            "ready"
        );
        queue.close();
        worker.join().unwrap();
        assert!(queue.enqueue("late".into(), 2, 100).is_err());
    }
}
