use std::path::PathBuf;

pub fn choose(folder: bool, parent: isize) -> Result<Option<PathBuf>, String> {
    // Shell dialogs require an STA. Use a dedicated thread rather than a Tokio
    // worker that may have previously initialized a different COM apartment.
    std::thread::spawn(move || unsafe {
        use windows::Win32::{
            Foundation::HWND,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS,
                SIGDN_FILESYSPATH,
            },
        };
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        let result = (|| -> Result<Option<PathBuf>, String> {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| e.to_string())?;
            let mut options = dialog.GetOptions().map_err(|e| e.to_string())? | FOS_FORCEFILESYSTEM;
            if folder {
                options |= FOS_PICKFOLDERS;
            }
            dialog.SetOptions(options).map_err(|e| e.to_string())?;
            if let Err(error) = dialog.Show(Some(HWND(parent as *mut _))) {
                if error.code().0 as u32 == 0x800704c7 {
                    return Ok(None);
                }
                return Err(error.to_string());
            }
            let item = dialog.GetResult().map_err(|e| e.to_string())?;
            let path = item
                .GetDisplayName(SIGDN_FILESYSPATH)
                .map_err(|e| e.to_string())?;
            let text = path.to_string().map_err(|e| e.to_string());
            CoTaskMemFree(Some(path.0 as *const _));
            Ok(Some(PathBuf::from(text?)))
        })();
        CoUninitialize();
        result
    })
    .join()
    .map_err(|_| "文件选择窗口异常退出。".to_string())?
}
