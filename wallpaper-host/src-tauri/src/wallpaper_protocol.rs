//! Data contract shared by native discovery, manager commands and tray actions.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, time::Duration};

pub const TIMEOUT: Duration = Duration::from_secs(2);
const MAX_BYTES: usize = 8192;
const MAX_ENVELOPE_BYTES: usize = MAX_BYTES + 512;

pub fn initialization_script(desktop: bool, locale: &str) -> String {
    format!(
        "({})({});",
        include_str!("../wallpaper-mode.js"),
        serde_json::json!({"mode": if desktop { "desktop" } else { "preview" }, "locale": locale})
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PauseReason {
    None,
    Manual,
    Occluded,
    System,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseState {
    pub paused: bool,
    pub pause_reason: PauseReason,
}
impl PauseState {
    pub fn new(manual: bool, occluded: bool, system: bool) -> Self {
        let pause_reason = if manual {
            PauseReason::Manual
        } else if system {
            PauseReason::System
        } else if occluded {
            PauseReason::Occluded
        } else {
            PauseReason::None
        };
        Self {
            paused: pause_reason != PauseReason::None,
            pause_reason,
        }
    }
    pub fn script(self) -> String {
        format!(
            "window.__SCREEN_GARDEN_SET_PAUSED?.({});",
            serde_json::to_string(&self).unwrap()
        )
    }
}

pub fn valid_token(value: &str) -> bool {
    !value.is_empty() && value.encode_utf16().count() <= 128
}
pub fn valid_action_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
fn valid_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty()
        && value.encode_utf16().count() <= maximum
        && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_reason: Option<String>,
    #[serde(default)]
    pub allow_when_occluded: bool,
}
impl Action {
    pub fn allowed(&self, state: PauseState) -> bool {
        self.enabled
            && (!state.paused
                || (state.pause_reason == PauseReason::Occluded && self.allow_when_occluded))
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionSnapshot {
    pub instance_id: String,
    pub actions: Vec<Action>,
    #[serde(default)]
    pub error: Option<String>,
}
impl ActionSnapshot {
    pub fn parse(raw: &str) -> Result<Self, String> {
        if raw.len() > MAX_ENVELOPE_BYTES {
            return Err("壁纸操作列表过大。".into());
        }
        let snapshot: Self = serde_json::from_str(raw).map_err(|_| "壁纸操作列表格式无效。")?;
        if !valid_token(&snapshot.instance_id)
            || snapshot.actions.len() > 16
            || serde_json::to_vec(&snapshot.actions)
                .map_err(|_| "壁纸操作列表无效。")?
                .len()
                > MAX_BYTES
            || snapshot.error.as_ref().is_some_and(|e| !valid_text(e, 512))
        {
            return Err("壁纸操作列表无效。".into());
        }
        let mut ids = BTreeSet::new();
        for action in &snapshot.actions {
            if !valid_action_id(&action.id)
                || !ids.insert(action.id.clone())
                || !valid_text(&action.label, 32)
                || action
                    .disabled_reason
                    .as_ref()
                    .is_some_and(|reason| !valid_text(reason, 120))
            {
                return Err("壁纸操作描述无效。".into());
            }
        }
        Ok(snapshot)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request<'a> {
    pub protocol_version: u8,
    pub instance_id: &'a str,
    pub request_id: &'a str,
    pub action_id: &'a str,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub ok: bool,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}
impl ActionResult {
    pub fn failure(request_id: &str, code: &str, message: &str) -> Self {
        Self {
            ok: false,
            request_id: request_id.into(),
            code: Some(code.into()),
            message: Some(message.into()),
            data: None,
        }
    }
    pub fn unknown(request_id: &str) -> Self {
        Self::failure(
            request_id,
            "RESULT_UNKNOWN",
            "未能确认操作结果，请先查看壁纸，避免重复操作。",
        )
    }
    pub fn parse(raw: &str, instance_id: &str, request_id: &str) -> Result<Self, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Envelope {
            instance_id: String,
            result: ActionResult,
        }
        if raw.len() > MAX_ENVELOPE_BYTES {
            return Err("操作回执过大。".into());
        }
        let reply: Envelope = serde_json::from_str(raw).map_err(|_| "操作回执格式无效。")?;
        let result = reply.result;
        if reply.instance_id != instance_id
            || result.request_id != request_id
            || serde_json::to_vec(&result)
                .map_err(|_| "操作回执无效。")?
                .len()
                > MAX_BYTES
        {
            return Err("操作回执不属于当前请求。".into());
        }
        if !result.ok
            && (!result.code.as_deref().is_some_and(|code| {
                matches!(
                    code,
                    "NOT_READY"
                        | "UNSUPPORTED"
                        | "UNKNOWN_ACTION"
                        | "DISABLED"
                        | "PAUSED"
                        | "INVALID_REQUEST"
                        | "STALE_INSTANCE"
                        | "BUSY"
                        | "FAILED"
                        | "RESULT_UNKNOWN"
                )
            }) || !result
                .message
                .as_deref()
                .is_some_and(|message| valid_text(message, 512)))
        {
            return Err("操作回执状态无效。".into());
        }
        Ok(result)
    }
}

/// Async callbacks may finish after navigation or a different request has begun.
#[derive(Clone, Debug, Default)]
pub struct Session {
    pub epoch: u64,
    pub instance_id: Option<String>,
    pub actions: Vec<Action>,
    pub error: Option<String>,
    pub query_pending: bool,
    pub request_id: Option<String>,
}
impl Session {
    pub fn invalidate(&mut self) {
        self.epoch = self.epoch.wrapping_add(1);
        self.instance_id = None;
        self.actions.clear();
        self.error = None;
        self.query_pending = false;
        self.request_id = None;
    }
    pub fn matches(&self, epoch: u64, instance_id: &str) -> bool {
        self.epoch == epoch && self.instance_id.as_deref() == Some(instance_id)
    }
    pub fn finish(&mut self, epoch: u64, instance_id: &str, request_id: &str) -> bool {
        if !self.matches(epoch, instance_id) || self.request_id.as_deref() != Some(request_id) {
            return false;
        }
        self.request_id = None;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pause_priority_and_explicit_occlusion_opt_in() {
        assert_eq!(
            PauseState::new(true, true, true).pause_reason,
            PauseReason::Manual
        );
        assert_eq!(
            PauseState::new(false, true, true).pause_reason,
            PauseReason::System
        );
        let mut action = Action {
            id: "feed".into(),
            label: "投喂".into(),
            enabled: true,
            disabled_reason: None,
            allow_when_occluded: false,
        };
        assert!(!action.allowed(PauseState::new(false, true, false)));
        action.allow_when_occluded = true;
        assert!(action.allowed(PauseState::new(false, true, false)));
        assert!(!action.allowed(PauseState::new(true, true, false)));
    }
    #[test]
    fn old_callbacks_cannot_clear_a_new_documents_pending_action() {
        let mut session = Session {
            instance_id: Some("first".into()),
            request_id: Some("r1".into()),
            ..Default::default()
        };
        session.invalidate();
        session.instance_id = Some("second".into());
        session.request_id = Some("r2".into());
        assert!(!session.finish(0, "first", "r1"));
        assert_eq!(session.request_id.as_deref(), Some("r2"));
        assert!(session.finish(1, "second", "r2"));
    }
    #[test]
    fn descriptors_use_utf16_limits_and_reject_duplicate_ids() {
        let raw = serde_json::json!({"instanceId":"page","actions":[
            {"id":"burst","label":"🌟".repeat(16),"enabled":true}
        ]});
        assert!(ActionSnapshot::parse(&raw.to_string()).is_ok());
        let mut invalid = raw.clone();
        invalid["actions"][0]["label"] = serde_json::json!("🌟".repeat(17));
        assert!(ActionSnapshot::parse(&invalid.to_string()).is_err());
        invalid = raw.clone();
        invalid["actions"]
            .as_array_mut()
            .unwrap()
            .push(raw["actions"][0].clone());
        assert!(ActionSnapshot::parse(&invalid.to_string()).is_err());
    }
    #[test]
    fn mismatched_or_malformed_results_are_never_acknowledged() {
        let reply =
            r#"{"instanceId":"page","result":{"ok":true,"requestId":"r1","data":{"total":1}}}"#;
        assert!(ActionResult::parse(reply, "page", "r1").unwrap().ok);
        assert!(ActionResult::parse(reply, "other", "r1").is_err());
        assert!(ActionResult::parse(reply, "page", "r2").is_err());
        assert!(ActionResult::parse(
            r#"{"instanceId":"page","result":{"ok":false,"requestId":"r1"}}"#,
            "page",
            "r1"
        )
        .is_err());
    }
}
