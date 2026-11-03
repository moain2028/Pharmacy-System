//! PharmaCore desktop shell: waits for the local API service (installed as a Windows service by the
//! installer), then shows the web UI in a native window. Tray menu: open app, backup now, open data
//! folder, open logs, quit. No business logic lives here — everything is in the API.
use std::{thread, time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const API_URL: &str = "http://127.0.0.1:3100";

fn data_dir() -> std::path::PathBuf {
    if cfg!(windows) {
        std::env::var("ProgramData").map(|p| std::path::PathBuf::from(p).join("PharmaCore")).unwrap_or_else(|_| std::path::PathBuf::from("C:\\ProgramData\\PharmaCore"))
    } else {
        dirs_fallback()
    }
}
fn dirs_fallback() -> std::path::PathBuf {
    std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join(".pharmacore")).unwrap_or_else(|_| std::path::PathBuf::from("/var/lib/pharmacore"))
}

/// Polls /api/v1/health until the API answers (service start-up after boot can take a few seconds).
fn wait_for_api(max_secs: u64) -> bool {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(2)).build().expect("http client");
    for _ in 0..max_secs {
        if client.get(format!("{API_URL}/api/v1/health")).send().map(|r| r.status().is_success()).unwrap_or(false) { return true; }
        thread::sleep(Duration::from_secs(1));
    }
    false
}

#[tauri::command]
fn api_url() -> String { API_URL.to_string() }

#[tauri::command]
fn backup_now(token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(120)).build().map_err(|e| e.to_string())?;
    client.post(format!("{API_URL}/api/v1/backup")).bearer_auth(token).json(&serde_json::json!({ "note": "tray" })).send().map_err(|e| e.to_string())?
        .json::<serde_json::Value>().map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![api_url, backup_now])
        .setup(|app| {
            // Splash while the service comes up; then navigate the main window to the SPA.
            let ready = wait_for_api(60);
            let url = if ready { format!("{API_URL}/") } else { format!("{API_URL}/?offline=1") };
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().expect("url")))
                .title("PharmaCore").inner_size(1280.0, 800.0).min_inner_size(1024.0, 640.0).maximized(true).build()?;
            if !ready {
                let _ = win.eval("document.body.innerHTML='<div style=\"font-family:sans-serif;direction:rtl;padding:40px;text-align:center\"><h2>تعذّر الاتصال بخدمة PharmaCore</h2><p>تأكد أن خدمتي PharmaCorePG و PharmaCoreAPI تعملان، ثم أعد فتح البرنامج.</p></div>'");
            }
            let open = MenuItem::with_id(app, "open", "فتح البرنامج / Open", true, None::<&str>)?;
            let data = MenuItem::with_id(app, "data", "مجلد البيانات / Data folder", true, None::<&str>)?;
            let logs = MenuItem::with_id(app, "logs", "السجلات / Logs", true, None::<&str>)?;
            let docs = MenuItem::with_id(app, "docs", "توثيق API / API docs", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "إغلاق / Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &data, &logs, &docs, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("icon").clone())
                .menu(&menu)
                .tooltip("PharmaCore")
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
                    "data" => { let _ = app.opener().open_path(data_dir().to_string_lossy().to_string(), None::<&str>); }
                    "logs" => { let _ = app.opener().open_path(data_dir().join("logs").to_string_lossy().to_string(), None::<&str>); }
                    "docs" => { let _ = app.opener().open_url(format!("{API_URL}/api/docs"), None::<&str>); }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|w, e| {
            // Closing the window hides to tray (POS machines keep the app resident); Quit is in the tray menu.
            if let tauri::WindowEvent::CloseRequested { api, .. } = e { let _ = w.hide(); api.prevent_close(); }
        })
        .run(tauri::generate_context!())
        .expect("error while running PharmaCore");
}
