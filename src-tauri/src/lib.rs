pub mod commands;
pub mod db;
pub mod import;
pub mod reader;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::Manager;

pub struct AppState {
    db: Mutex<Connection>,
    readers: Mutex<HashMap<i64, Arc<Mutex<reader::Reader>>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(data_dir.join("books"))?;
            let conn = db::open(&data_dir.join("readverse.db"))
                .map_err(|message| std::io::Error::other(message))?;
            app.manage(AppState {
                db: Mutex::new(conn),
                readers: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
            commands::import_book,
            commands::delete_book,
            commands::get_progress,
            commands::save_progress,
            commands::read_page,
            commands::read_previous_page,
            commands::get_page_number,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
