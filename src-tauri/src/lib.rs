use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
use tauri_plugin_sql::{Migration, MigrationKind};

// Store the sidecar child process for cleanup on exit
#[cfg(not(debug_assertions))]
struct ApiSidecar(Mutex<Option<CommandChild>>);

/// Load .env file and return key-value pairs.
/// Supports lines like: KEY=value or KEY="value"
/// Ignores comments (#) and blank lines.
fn load_dotenv(path: &std::path::Path) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    if let Ok(content) = std::fs::read_to_string(path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(eq_pos) = trimmed.find('=') {
                let key = trimmed[..eq_pos].trim().to_string();
                let mut value = trimmed[eq_pos + 1..].trim().to_string();
                // Strip surrounding quotes
                if (value.starts_with('"') && value.ends_with('"'))
                    || (value.starts_with('\'') && value.ends_with('\''))
                {
                    value = value[1..value.len() - 1].to_string();
                }
                if !key.is_empty() && !value.is_empty() {
                    pairs.push((key, value));
                }
            }
        }
    }
    pairs
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ============================================================================
// Sandbox Detection and App Directory Resolution
// ============================================================================

/// Detect if running in macOS App Store sandbox
/// Uses multiple strategies to identify sandbox environment
#[cfg(not(debug_assertions))]
fn is_running_in_sandbox() -> bool {
    // Strategy 1: Check HOME environment for container path
    if let Ok(home) = std::env::var("HOME") {
        if home.contains("/Library/Containers/") || home.contains("/AppTranslocation/") {
            return true;
        }
    }
    
    // Strategy 2: Check for Tauri-specific markers
    if std::env::var("TAURI_PLATFORM").is_ok() {
        return true;
    }
    
    false
}

/// Get the app data directory considering sandbox environment
/// In MAS: returns home directory (which is already ~/Library/Containers/{app-id}/Data/)
/// Otherwise: returns the standard ~/.sage/ path
#[cfg(not(debug_assertions))]
fn get_app_data_dir() -> String {
    use std::env;
    
    // 1. Check for explicit override (for testing or special deployments)
    if let Ok(override_dir) = env::var("SAGE_APP_DIR") {
        return override_dir;
    }
    
    // 2. Detect sandbox and use home directory directly
    if is_running_in_sandbox() {
        if let Ok(home) = env::var("HOME") {
            return home;
        }
    }
    
    // 3. Default to ~/.sage
    if let Ok(home) = env::var("HOME") {
        return format!("{}/.sage", home);
    }
    
    "./.sage".to_string()
}

/// Kill any existing process on the API port before starting sidecar
#[cfg(not(debug_assertions))]
fn kill_existing_api_process(port: u16) {
    // In sandbox, lsof/kill may be restricted — rely on child.kill() only
    if is_running_in_sandbox() {
        println!("[API] Skipping port kill in sandbox (using child.kill() only)");
        return;
    }

    use std::process::Command;

    println!("[API] Checking for existing process on port {}...", port);

    // On macOS/Linux, use lsof to find and kill process on port
    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
        {
            let pids = String::from_utf8_lossy(&output.stdout);
            for pid in pids.lines() {
                if let Ok(pid_num) = pid.trim().parse::<i32>() {
                    println!("[API] Killing existing process on port {}: PID {}", port, pid_num);
                    let _ = Command::new("kill")
                        .args(["-9", &pid_num.to_string()])
                        .output();
                }
            }
        }
    }

    // On Windows, use netstat and taskkill
    #[cfg(windows)]
    {
        if let Ok(output) = Command::new("netstat")
            .args(["-ano", "-p", "TCP"])
            .output()
        {
            let output_str = String::from_utf8_lossy(&output.stdout);
            for line in output_str.lines() {
                if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
                    if let Some(pid) = line.split_whitespace().last() {
                        println!("[API] Killing existing process on port {}: PID {}", port, pid);
                        let _ = Command::new("taskkill")
                            .args(["/F", "/PID", pid])
                            .output();
                    }
                }
            }
        }
    }

    // Give the OS a moment to release the port
    std::thread::sleep(std::time::Duration::from_millis(500));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Database migrations
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_tasks_and_messages_tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY NOT NULL,
                    prompt TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'running',
                    cost REAL,
                    duration INTEGER,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    content TEXT,
                    tool_name TEXT,
                    tool_input TEXT,
                    subtype TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_tool_result_fields",
            sql: r#"
                ALTER TABLE messages ADD COLUMN tool_output TEXT;
                ALTER TABLE messages ADD COLUMN tool_use_id TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_files_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    path TEXT NOT NULL,
                    preview TEXT,
                    thumbnail TEXT,
                    is_favorite INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_files_task_id ON files(task_id);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_settings_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_sessions_table_and_update_tasks",
            sql: r#"
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY NOT NULL,
                    prompt TEXT NOT NULL,
                    task_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                ALTER TABLE tasks ADD COLUMN session_id TEXT;
                ALTER TABLE tasks ADD COLUMN task_index INTEGER DEFAULT 1;

                CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_attachments_to_messages",
            sql: r#"
                ALTER TABLE messages ADD COLUMN attachments TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_favorite_to_tasks",
            sql: r#"
                ALTER TABLE tasks ADD COLUMN favorite INTEGER DEFAULT 0;
            "#,
            kind: MigrationKind::Up,
        },
    ];

    #[cfg(not(debug_assertions))]
    let api_sidecar = ApiSidecar(Mutex::new(None));

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:sage.db", migrations)
                .build(),
        );

    // Manage the sidecar state in production
    #[cfg(not(debug_assertions))]
    {
        builder = builder.manage(api_sidecar);
    }

    builder
        .setup(|app| {
            // In development mode (tauri dev), skip sidecar and use external API server
            // Run `pnpm dev:api` separately for hot-reload support
            // In production, spawn the bundled API sidecar
            #[cfg(not(debug_assertions))]
            {
                const API_PORT: u16 = 2026;

                // Kill any existing process on the API port
                kill_existing_api_process(API_PORT);

                // Detect and log sandbox environment
                let in_sandbox = is_running_in_sandbox();
                let app_data_dir = get_app_data_dir();

                if in_sandbox {
                    println!("[API] Running in sandbox environment");
                    println!("[API] App data directory: {}", app_data_dir);
                }

                // Load API keys from .env file in the app's config directory
                // macOS: ~/Library/Application Support/ai.sage.desktop/.env
                let mut sidecar_command = app.shell().sidecar("sage-api")
                    .unwrap()
                    .env("PORT", API_PORT.to_string())
                    .env("NODE_ENV", "production");

                // Pass app data directory to sidecar so it can adapt paths
                if in_sandbox {
                    sidecar_command = sidecar_command.env("SAGE_APP_DIR", &app_data_dir);
                }

                // Resolve the bundled fallback (.app/Contents/Resources/resources/defaults/.env).
                // Computed once so we can both add it to the search list and detect when we
                // load from it (so we can mirror it to the user-editable location).
                let bundled_env_path: Option<std::path::PathBuf> = app
                    .path()
                    .resource_dir()
                    .ok()
                    .map(|p| p.join("resources").join("defaults").join(".env"));

                // Try loading .env in priority order. User-editable locations come first
                // so a user override always wins over the bundled defaults.
                let env_paths: Vec<std::path::PathBuf> = vec![
                    // 1. App config directory (sandbox-aware, OS-recommended)
                    app.path().app_config_dir().ok().map(|p| p.join(".env")),

                    // 2. App data directory (for sandbox or custom deployments)
                    if !app_data_dir.is_empty() && app_data_dir != "./.sage" {
                        Some(std::path::PathBuf::from(format!("{}/.env", app_data_dir)))
                    } else {
                        None
                    },

                    // 3. Home .sage directory (default user-editable location)
                    dirs::home_dir().map(|p| p.join(".sage").join(".env")),

                    // 4. System-wide .env (skip in sandbox — inaccessible)
                    if !in_sandbox {
                        dirs::home_dir().map(|p| p.join(".env"))
                    } else {
                        None
                    },

                    // 5. Bundled fallback shipped inside the .app. Guarantees fresh installs
                    //    work without manual setup. Mirrored to (3) on first hit so subsequent
                    //    launches use the standard path and the user can edit it.
                    bundled_env_path.clone(),
                ]
                .into_iter()
                .flatten()
                .collect();

                println!("[API] Searching for .env files (in order):");
                for (idx, env_path) in env_paths.iter().enumerate() {
                    println!("[API]   {}. {}", idx + 1, env_path.display());
                }

                for env_path in &env_paths {
                    if env_path.exists() {
                        println!("[API] Loading .env from: {}", env_path.display());
                        let pairs = load_dotenv(env_path);
                        for (key, value) in &pairs {
                            sidecar_command = sidecar_command.env(key, value);
                            println!("[API] Injected env: {}", key);
                        }

                        // If we fell through to the bundled fallback, mirror it to the
                        // user-editable location so the user has a local copy they can
                        // edit and so future launches don't depend on the bundle.
                        let loaded_from_bundle = bundled_env_path
                            .as_ref()
                            .map(|p| p == env_path)
                            .unwrap_or(false);
                        if loaded_from_bundle {
                            let target = if in_sandbox && !app_data_dir.is_empty() {
                                Some(std::path::PathBuf::from(&app_data_dir).join(".env"))
                            } else {
                                dirs::home_dir().map(|p| p.join(".sage").join(".env"))
                            };
                            if let Some(target_path) = target {
                                if !target_path.exists() {
                                    if let Some(parent) = target_path.parent() {
                                        if let Err(e) = std::fs::create_dir_all(parent) {
                                            eprintln!(
                                                "[API] Failed to create {}: {}",
                                                parent.display(),
                                                e
                                            );
                                        }
                                    }
                                    match std::fs::copy(env_path, &target_path) {
                                        Ok(_) => println!(
                                            "[API] Mirrored bundled .env → {}",
                                            target_path.display()
                                        ),
                                        Err(e) => eprintln!(
                                            "[API] Failed to mirror bundled .env to {}: {}",
                                            target_path.display(),
                                            e
                                        ),
                                    }
                                }
                            }
                        }
                        break; // Use first .env found
                    }
                }

                let (mut rx, child) = sidecar_command.spawn().expect("Failed to spawn API sidecar");

                // Store the child process for cleanup on exit
                if let Some(state) = app.try_state::<ApiSidecar>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(child);
                    }
                }

                // Log sidecar output
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                println!("[API] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                eprintln!("[API Error] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Error(error) => {
                                eprintln!("[API Spawn Error] {}", error);
                            }
                            CommandEvent::Terminated(status) => {
                                println!("[API] Process terminated with status: {:?}", status);
                                break;
                            }
                            _ => {}
                        }
                    }
                });
            }

            #[cfg(debug_assertions)]
            {
                println!("[Tauri Dev] API sidecar disabled. Run `pnpm dev:api` for the API server on port 2026.");
            }

            // Deep link: the frontend uses @tauri-apps/plugin-deep-link's
            // onOpenUrl + getCurrent to handle OAuth callbacks. The Rust side
            // only needs to register the plugin (done above in the builder).

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // macOS: Cmd+W hides the window instead of quitting the app.
                // Clicking the dock icon re-shows it.
                #[cfg(target_os = "macos")]
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    label,
                    ..
                } => {
                    // Prevent the window from being destroyed
                    api.prevent_close();
                    // Hide the window instead
                    if let Some(window) = app_handle.get_webview_window(&label) {
                        let _ = window.hide();
                    }
                }
                // macOS: Re-show window when dock icon is clicked
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                // Handle app exit to cleanup sidecar
                tauri::RunEvent::Exit => {
                    #[cfg(not(debug_assertions))]
                    {
                        if is_running_in_sandbox() {
                            println!("[App] Cleaning up in sandbox environment...");
                        } else {
                            println!("[App] Cleaning up API sidecar...");
                        }
                        if let Some(state) = app_handle.try_state::<ApiSidecar>() {
                            if let Ok(mut guard) = state.0.lock() {
                                if let Some(child) = guard.take() {
                                    let child: CommandChild = child;
                                    println!("[App] Killing API sidecar process...");
                                    let _ = child.kill();
                                }
                            }
                        }
                        // Fallback: kill by port (only outside sandbox)
                        if !is_running_in_sandbox() {
                            kill_existing_api_process(2026);
                        }
                    }
                    #[cfg(debug_assertions)]
                    {
                        let _ = app_handle;
                    }
                }
                _ => {}
            }
        });
}
