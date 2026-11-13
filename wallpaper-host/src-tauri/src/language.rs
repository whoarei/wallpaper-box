use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Language {
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en")]
    English,
}

impl Language {
    pub fn locale(self) -> &'static str {
        match self {
            Self::Chinese => "zh-CN",
            Self::English => "en",
            Self::System => system_locale(),
        }
    }
}

fn system_locale() -> &'static str {
    #[cfg(windows)]
    {
        // Use the Windows UI language, independently of date/number formats.
        let language = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
        if language & 0x03ff == 0x04 {
            return "zh-CN";
        }
    }
    #[cfg(not(windows))]
    if std::env::var("LANG").is_ok_and(|value| value.starts_with("zh")) {
        return "zh-CN";
    }
    "en"
}

pub fn text<'a>(locale: &str, chinese: &'a str, english: &'a str) -> &'a str {
    if locale == "zh-CN" {
        chinese
    } else {
        english
    }
}

pub fn script(locale: &str) -> String {
    format!(
        "window.__SCREEN_GARDEN_SET_LOCALE?.({});",
        serde_json::to_string(locale).unwrap()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_are_stable_and_invalid_values_are_rejected() {
        assert_eq!(Language::default(), Language::System);
        assert_eq!(Language::Chinese.locale(), "zh-CN");
        assert_eq!(Language::English.locale(), "en");
        assert_eq!(
            serde_json::to_string(&Language::System).unwrap(),
            "\"system\""
        );
        assert!(serde_json::from_str::<Language>("\"fr\"").is_err());
        assert_eq!(script("en"), "window.__SCREEN_GARDEN_SET_LOCALE?.(\"en\");");
    }
}
