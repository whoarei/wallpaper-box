//! One durable, revisioned JSON configuration per wallpaper on this device.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MAX_BYTES: usize = 32 * 1024;
const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub revision: u64,
    pub settings: Value,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            settings: json!({}),
        }
    }
}
impl Snapshot {
    pub fn updated(&self, expected_revision: u64, settings: Value) -> Result<Self, String> {
        if expected_revision != self.revision {
            return Err("配置已发生变化，请重新加载设置后再保存。".into());
        }
        if !settings.is_object()
            || serde_json::to_vec(&settings)
                .map_err(|_| "壁纸配置无效。")?
                .len()
                > MAX_BYTES
        {
            return Err("壁纸配置必须是 JSON 对象，且不能超过 32 KiB。".into());
        }
        let revision = self
            .revision
            .checked_add(1)
            .filter(|v| *v <= MAX_REVISION)
            .ok_or("壁纸配置版本已达上限。")?;
        Ok(Self { revision, settings })
    }
    pub fn script(&self, module_id: &str) -> String {
        // The same serialized data is also embedded in an HTML script element.
        let payload =
            json!({"moduleId": module_id, "revision": self.revision, "settings": self.settings});
        format!(
            "window.__SCREEN_GARDEN_SET_SETTINGS?.({});",
            payload.to_string().replace('<', "\\u003c")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revisions_prevent_lost_updates_and_round_trip_without_a_running_window() {
        let first = Snapshot::default()
            .updated(0, json!({"lighting": 2}))
            .unwrap();
        let restored: Snapshot =
            serde_json::from_slice(&serde_json::to_vec(&first).unwrap()).unwrap();
        assert_eq!(restored, first);
        assert!(restored.updated(0, json!({})).is_err());
        assert_eq!(restored.updated(1, json!({})).unwrap().revision, 2);
        assert!(first.updated(1, json!([])).is_err());
        assert!(first
            .updated(1, json!({"large":"x".repeat(MAX_BYTES)}))
            .is_err());
        assert!(!first
            .updated(1, json!({"text":"</script>"}))
            .unwrap()
            .script("scene")
            .contains("</script>"));
    }

    #[test]
    fn device_configuration_survives_disk_reload_and_wallpapers_keep_separate_values() {
        use std::collections::BTreeMap;
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("settings.json");
        let saved = BTreeMap::from([
            (
                "aquarium",
                Snapshot::default()
                    .updated(0, json!({"lighting":2}))
                    .unwrap(),
            ),
            (
                "pinewind-town",
                Snapshot::default()
                    .updated(0, json!({"raining":true}))
                    .unwrap(),
            ),
        ]);
        crate::catalog::atomic_json(&path, &saved).unwrap();
        let loaded: BTreeMap<String, Snapshot> =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(loaded["aquarium"].settings, json!({"lighting":2}));
        assert_eq!(loaded["pinewind-town"].settings, json!({"raining":true}));
        assert_eq!(loaded.len(), 2);
    }
}
