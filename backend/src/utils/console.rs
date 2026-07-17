/// Prepare the Windows console for UTF-8 output so tracing logs do not show as mojibake.
#[cfg(windows)]
pub fn init() {
    use std::ffi::c_void;

    unsafe extern "system" {
        fn SetConsoleOutputCP(wCodePageID: u32) -> i32;
        fn SetConsoleCP(wCodePageID: u32) -> i32;
        fn GetStdHandle(nStdHandle: u32) -> *mut c_void;
        fn GetConsoleMode(h: *mut c_void, mode: *mut u32) -> i32;
        fn SetConsoleMode(h: *mut c_void, mode: u32) -> i32;
    }

    const CP_UTF8: u32 = 65001;
    const STD_OUTPUT_HANDLE: u32 = 0xFFFF_FFF5;
    const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;

    unsafe {
        SetConsoleOutputCP(CP_UTF8);
        SetConsoleCP(CP_UTF8);

        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if !handle.is_null() {
            let mut mode = 0u32;
            if GetConsoleMode(handle, &mut mode) != 0 {
                let _ = SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
            }
        }
    }
}

#[cfg(not(windows))]
pub fn init() {}

pub fn tracing_use_ansi() -> bool {
    if std::env::var_os("NO_COLOR").is_some() {
        return false;
    }
    if std::env::var_os("FORCE_COLOR").is_some() {
        return true;
    }

    #[cfg(windows)]
    {
        // Windows Terminal / VS Code / Cursor integrated terminal
        if std::env::var_os("WT_SESSION").is_some() || std::env::var_os("TERM_PROGRAM").is_some() {
            return std::io::IsTerminal::is_terminal(&std::io::stdout());
        }
        // Classic cmd.exe: prefer plain text to avoid escape-sequence garbage
        return false;
    }

    #[cfg(not(windows))]
    {
        std::io::IsTerminal::is_terminal(&std::io::stdout())
    }
}
