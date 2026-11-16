//! Native liveness is independent of wallpaper actions and manual/automatic pause.
use std::time::{Duration, Instant};

const FAILURE_THRESHOLD: u8 = 3;
const LOAD_GRACE: Duration = Duration::from_secs(10);
const RECOVERY_COOLDOWN: Duration = Duration::from_secs(60);

#[derive(Clone, Debug)]
pub(super) struct Health {
    started: Instant,
    failures: u8,
    last_recovery: Option<Instant>,
}

impl Default for Health {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            failures: 0,
            last_recovery: None,
        }
    }
}

impl Health {
    pub fn unresponsive(&self) -> bool {
        self.failures != 0
    }

    /// A native reply proves liveness even when the page is loading, has no
    /// actions, or returns an invalid action descriptor. None warrant a restart.
    pub fn observe(&mut self, responded: bool) {
        self.failures = if responded {
            0
        } else {
            self.failures.saturating_add(1)
        };
    }

    pub fn begin_recovery(&mut self, now: Instant) -> bool {
        if self.failures < FAILURE_THRESHOLD
            || now.duration_since(self.started) < LOAD_GRACE
            || self
                .last_recovery
                .is_some_and(|last| now.duration_since(last) < RECOVERY_COOLDOWN)
        {
            return false;
        }
        self.last_recovery = Some(now);
        true
    }

    /// Preserve the cooldown across replacement documents and renderer crashes.
    pub fn rebuilt(&mut self, now: Instant) {
        self.started = now;
        self.failures = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slow_start_and_isolated_timeouts_do_not_restart_a_wallpaper() {
        let mut health = Health::default();
        let start = health.started;
        health.observe(false);
        health.observe(false);
        assert!(!health.begin_recovery(start + LOAD_GRACE));
        health.observe(true);
        health.observe(false);
        assert!(!health.begin_recovery(start + LOAD_GRACE));
        health.observe(false);
        health.observe(false);
        assert!(!health.begin_recovery(start + LOAD_GRACE - Duration::from_millis(1)));
        assert!(health.begin_recovery(start + LOAD_GRACE));
    }

    #[test]
    fn repeated_hangs_cannot_bypass_the_cooldown_by_recreating_the_document() {
        let mut health = Health::default();
        let first = health.started + LOAD_GRACE;
        for _ in 0..3 {
            health.observe(false);
        }
        assert!(health.begin_recovery(first));
        health.rebuilt(first);
        for _ in 0..3 {
            health.observe(false);
        }
        assert!(!health.begin_recovery(first + LOAD_GRACE));
        assert!(health.begin_recovery(first + RECOVERY_COOLDOWN));
        health.observe(true);
        assert!(!health.unresponsive());
        assert!(!health.begin_recovery(first + RECOVERY_COOLDOWN * 2));
    }
}
