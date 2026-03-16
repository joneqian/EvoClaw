use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize)]
pub struct SidecarInfo {
    pub port: u16,
    pub token: String,
    pub running: bool,
}

/// stdout 首行 JSON 格式
#[derive(Deserialize)]
struct SidecarOutput {
    port: u16,
    token: String,
}

// Global state for sidecar info
static SIDECAR_INFO: Mutex<Option<SidecarInfo>> = Mutex::new(None);

/// 是否正在关闭（防止退出时自动重启）
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// 最大自动重启次数
const MAX_AUTO_RESTARTS: u32 = 3;
/// 重启间隔（毫秒）
const RESTART_DELAY_MS: u64 = 2000;

/// 自动重启计数
static RESTART_COUNT: Mutex<u32> = Mutex::new(0);

/// 获取 Sidecar 连接信息
#[tauri::command]
pub fn get_sidecar_info() -> Result<SidecarInfo, String> {
    let info = SIDECAR_INFO.lock().map_err(|e| e.to_string())?;
    match info.as_ref() {
        Some(info) => Ok(info.clone()),
        None => Err("Sidecar 未启动".to_string()),
    }
}

/// 前端手动重启 Sidecar
#[tauri::command]
pub async fn restart_sidecar(app: tauri::AppHandle) -> Result<String, String> {
    // 重置自动重启计数
    if let Ok(mut count) = RESTART_COUNT.lock() {
        *count = 0;
    }
    clear_sidecar_info();

    do_spawn_sidecar(&app).map_err(|e| format!("重启 Sidecar 失败: {}", e))?;
    Ok("Sidecar 重启中".to_string())
}

/// 设置 Sidecar 信息（内部使用）
pub fn set_sidecar_info(port: u16, token: String) {
    let mut info = SIDECAR_INFO.lock().unwrap();
    *info = Some(SidecarInfo {
        port,
        token,
        running: true,
    });
}

/// 清除 Sidecar 信息
pub fn clear_sidecar_info() {
    let mut info = SIDECAR_INFO.lock().unwrap();
    *info = None;
}

/// 在 .setup() 中启动 Sidecar
pub fn spawn_sidecar(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    do_spawn_sidecar(app.handle())
}

/// 实际启动逻辑（setup 和 restart 共用）
fn do_spawn_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let shell = app.shell();

    // 确定 sidecar 脚本路径
    let script_path = {
        let mut found = None;

        // 1) 尝试打包后的 resource dir
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir
                .join("_up_/_up_/_up_/packages/core/dist/server.mjs");
            if bundled.exists() {
                found = Some(bundled.to_string_lossy().to_string());
            }
        }

        // 2) 开发模式：用编译时嵌入的项目路径
        if found.is_none() {
            let dev_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/core/dist/server.mjs");
            let p = std::path::Path::new(dev_path);
            if p.exists() {
                found = Some(p.canonicalize().unwrap_or(p.to_path_buf()).to_string_lossy().to_string());
            }
        }

        found.unwrap_or_else(|| "packages/core/dist/server.mjs".to_string())
    };

    let (mut rx, child) = shell
        .command("node")
        .args([&script_path])
        .spawn()
        .map_err(|e| format!("启动 Sidecar 失败: {}", e))?;

    // 保存子进程 PID 用于退出时清理
    let child_pid = child.pid();
    // 只在首次 manage，重启时跳过
    if app.try_state::<SidecarChild>().is_none() {
        app.manage(SidecarChild(Mutex::new(Some(child_pid))));
    } else if let Some(state) = app.try_state::<SidecarChild>() {
        if let Ok(mut pid_lock) = state.0.lock() {
            *pid_lock = Some(child_pid);
        }
    }

    // 在后台线程读取 stdout，解析首行 JSON
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        let mut first_line_parsed = false;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    let trimmed = line_str.trim();

                    if !first_line_parsed && !trimmed.is_empty() {
                        match serde_json::from_str::<SidecarOutput>(trimmed) {
                            Ok(output) => {
                                set_sidecar_info(output.port, output.token);
                                first_line_parsed = true;
                                println!("[sidecar] 已启动 port={}", output.port);
                                // 重启成功，重置计数
                                if let Ok(mut count) = RESTART_COUNT.lock() {
                                    *count = 0;
                                }
                                let _ = app_handle.emit("sidecar-ready", &get_sidecar_info().ok());
                            }
                            Err(e) => {
                                eprintln!("[sidecar] 解析启动信息失败: {} (line: {})", e, trimmed);
                            }
                        }
                    } else if !trimmed.is_empty() {
                        println!("[sidecar:stdout] {}", trimmed);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    let trimmed = line_str.trim();
                    if !trimmed.is_empty() {
                        eprintln!("[sidecar:stderr] {}", trimmed);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[sidecar] 进程退出: {:?}", payload);
                    clear_sidecar_info();

                    // 自动重启（非主动关闭时）
                    if !SHUTTING_DOWN.load(Ordering::SeqCst) {
                        let should_restart = {
                            let mut count = RESTART_COUNT.lock().unwrap_or_else(|e| e.into_inner());
                            if *count < MAX_AUTO_RESTARTS {
                                *count += 1;
                                eprintln!("[sidecar] 自动重启 ({}/{})", *count, MAX_AUTO_RESTARTS);
                                true
                            } else {
                                eprintln!("[sidecar] 已达最大重启次数，停止自动重启");
                                false
                            }
                        };

                        if should_restart {
                            // 用标准库实现异步延迟（避免直接依赖 tokio）
                            let (tx, rx) = std::sync::mpsc::channel();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_millis(RESTART_DELAY_MS));
                                let _ = tx.send(());
                            });
                            let _ = rx.recv();
                            if let Err(e) = do_spawn_sidecar(&app_handle) {
                                eprintln!("[sidecar] 自动重启失败: {}", e);
                                let _ = app_handle.emit("sidecar-error", "Sidecar 重启失败");
                            }
                        } else {
                            let _ = app_handle.emit("sidecar-error", "Sidecar 已停止，请手动重启");
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// 存储子进程 PID，用于退出时清理
pub struct SidecarChild(pub Mutex<Option<u32>>);

/// 关闭 Sidecar 子进程
pub fn shutdown_sidecar(app: &tauri::AppHandle) {
    // 标记正在关闭，防止自动重启
    SHUTTING_DOWN.store(true, Ordering::SeqCst);

    if let Some(state) = app.try_state::<SidecarChild>() {
        if let Ok(mut pid_lock) = state.0.lock() {
            if let Some(_pid) = pid_lock.take() {
                clear_sidecar_info();
                println!("[sidecar] 已标记关闭");
            }
        }
    }
}
