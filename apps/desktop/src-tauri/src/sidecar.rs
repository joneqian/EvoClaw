use serde::{Deserialize, Serialize};
use std::sync::Mutex;
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

/// 获取 Sidecar 连接信息
#[tauri::command]
pub fn get_sidecar_info() -> Result<SidecarInfo, String> {
    let info = SIDECAR_INFO.lock().map_err(|e| e.to_string())?;
    match info.as_ref() {
        Some(info) => Ok(info.clone()),
        None => Err("Sidecar 未启动".to_string()),
    }
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
    let shell = app.shell();

    // 确定 sidecar 脚本路径
    // 打包后: Resources/_up_/_up_/_up_/packages/core/dist/server.mjs
    // 开发时: 通过 CARGO_MANIFEST_DIR 定位项目根目录
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
    app.manage(SidecarChild(Mutex::new(Some(child_pid))));

    // 在后台线程读取 stdout，解析首行 JSON
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        let mut first_line_parsed = false;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    let trimmed = line_str.trim();

                    if !first_line_parsed && !trimmed.is_empty() {
                        // 尝试解析首行 JSON
                        match serde_json::from_str::<SidecarOutput>(trimmed) {
                            Ok(output) => {
                                set_sidecar_info(output.port, output.token);
                                first_line_parsed = true;
                                println!("[sidecar] 已启动 port={}", output.port);
                                // 通知前端
                                let _ = app_handle.emit("sidecar-ready", &get_sidecar_info().ok());
                            }
                            Err(e) => {
                                eprintln!("[sidecar] 解析启动信息失败: {} (line: {})", e, trimmed);
                            }
                        }
                    } else {
                        // 后续 stdout 仅打印日志
                        if !trimmed.is_empty() {
                            println!("[sidecar:stdout] {}", trimmed);
                        }
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
    if let Some(state) = app.try_state::<SidecarChild>() {
        if let Ok(mut pid_lock) = state.0.lock() {
            if let Some(_pid) = pid_lock.take() {
                clear_sidecar_info();
                // 子进程会在主进程退出时自动清理（Tauri shell plugin 管理）
                println!("[sidecar] 已标记关闭");
            }
        }
    }
}
