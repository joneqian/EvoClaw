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
    // 先杀掉旧的 sidecar 进程
    kill_sidecar_process(&app);
    clear_sidecar_info();
    // 重置关闭标记（shutdown_sidecar 可能设置了）
    SHUTTING_DOWN.store(false, Ordering::SeqCst);

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
    // 启动前先杀掉可能残留的旧进程
    kill_sidecar_process(app);

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

    // 优先使用内嵌的 bun，回退到系统 bun，最终回退到 node
    let runtime_bin = find_bundled_bun(app)
        .or_else(find_bun_binary)
        .or_else(find_node_binary)
        .unwrap_or_else(|| "bun".to_string());
    println!("[sidecar] 使用运行时: {}", runtime_bin);

    let (mut rx, child) = shell
        .command(&runtime_bin)
        .args(["run", &script_path])
        .spawn()
        .map_err(|e| format!("启动 Sidecar 失败 (runtime={}): {}", runtime_bin, e))?;

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
                        // 检查是否为 Sidecar 事件（含 __event 字段的 JSON 行）
                        // 协议：{ "__event": "conversations-changed", ...data }
                        if trimmed.starts_with('{') && trimmed.contains("\"__event\"") {
                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
                                if let Some(event_type) = value.get("__event").and_then(|v| v.as_str()) {
                                    let _ = app_handle.emit(event_type, &value);
                                }
                            }
                        } else {
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

/// 验证运行时二进制能否正常执行（3 秒超时）
fn verify_runtime(path: &str) -> bool {
    let child = std::process::Command::new(path)
        .args(["--version"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    match child {
        Ok(mut child) => {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => return status.success(),
                    Ok(None) => {
                        if std::time::Instant::now() > deadline {
                            let _ = child.kill();
                            eprintln!("[sidecar] verify_runtime 超时，kill 子进程");
                            return false;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(_) => return false,
                }
            }
        }
        Err(_) => false,
    }
}

/// 查找内嵌在 app bundle 里的 bun 二进制
fn find_bundled_bun(app: &tauri::AppHandle) -> Option<String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // 1) 开发模式：优先用源目录下的 bun-bin
    let dev_bun = concat!(env!("CARGO_MANIFEST_DIR"), "/bun-bin/bun");
    candidates.push(std::path::PathBuf::from(dev_bun));

    // 2) 打包后的 resource dir (生产模式)
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("bun-bin/bun"));
    }

    for candidate in &candidates {
        if candidate.exists() {
            let path = candidate.to_string_lossy().to_string();
            if verify_runtime(&path) {
                eprintln!("[sidecar] 使用内嵌 bun: {}", path);
                return Some(path);
            }
            eprintln!("[sidecar] 内嵌 bun 无法执行，跳过: {}", path);
        }
    }
    None
}

/// 查找系统安装的 bun
fn find_bun_binary() -> Option<String> {
    let home = get_home_dir();
    eprintln!("[sidecar] 查找 bun, HOME={}", home);

    // Bun 默认安装路径
    let candidates = [
        format!("{}/.bun/bin/bun", home),
        "/opt/homebrew/bin/bun".to_string(),
        "/usr/local/bin/bun".to_string(),
    ];

    for candidate in &candidates {
        if std::path::Path::new(candidate).exists() {
            eprintln!("[sidecar] 找到 bun: {}", candidate);
            return Some(candidate.clone());
        }
    }

    // 尝试通过 shell 查找
    for shell in ["/bin/zsh", "/bin/bash"] {
        if !std::path::Path::new(shell).exists() {
            continue;
        }
        if let Ok(output) = std::process::Command::new(shell)
            .args(["-lc", "which bun 2>/dev/null"])
            .env("HOME", &home)
            .output()
        {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                eprintln!("[sidecar] shell 查找到 bun: {}", path);
                return Some(path);
            }
        }
    }

    eprintln!("[sidecar] 未找到 bun");
    None
}

/// 获取用户 home 目录（GUI app 里 HOME 可能为空）
fn get_home_dir() -> String {
    // 优先环境变量
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return home;
        }
    }
    // 回退：通过系统调用获取
    if let Ok(output) = std::process::Command::new("/usr/bin/dscl")
        .args([".", "-read", &format!("/Users/{}", std::env::var("USER").unwrap_or_default()), "NFSHomeDirectory"])
        .output()
    {
        let s = String::from_utf8_lossy(&output.stdout);
        if let Some(path) = s.split_whitespace().last() {
            return path.to_string();
        }
    }
    // 最终回退
    "/Users/".to_string() + &std::env::var("USER").unwrap_or_else(|_| "unknown".to_string())
}

/// 查找 node 可执行文件路径
/// macOS GUI app 不继承用户 shell 的 PATH，需要主动搜索常见安装位置
fn find_node_binary() -> Option<String> {
    let home = get_home_dir();
    eprintln!("[sidecar] 查找 node, HOME={}", home);

    // 1) 尝试通过用户默认 shell 获取 node 路径
    for shell in ["/bin/zsh", "/bin/bash"] {
        if !std::path::Path::new(shell).exists() {
            continue;
        }
        // 使用 -ilc 启动交互式登录 shell，确保 nvm/fnm 等初始化脚本被加载
        if let Ok(output) = std::process::Command::new(shell)
            .args(["-ilc", "which node 2>/dev/null || command -v node 2>/dev/null"])
            .env("HOME", &home)
            .output()
        {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            eprintln!("[sidecar] {} -ilc which node => '{}'", shell, path);
            if !path.is_empty() && !path.contains("not found") && std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }

    // 2) nvm：优先读 default alias 指向的版本
    let nvm_base = format!("{}/.nvm", home);
    let nvm_versions = format!("{}/versions/node", nvm_base);

    // 2a) 读 ~/.nvm/alias/default → 得到版本号如 "22" 或 "22.22.1"
    let alias_path = format!("{}/alias/default", nvm_base);
    if let Ok(alias_content) = std::fs::read_to_string(&alias_path) {
        let alias = alias_content.trim();
        eprintln!("[sidecar] nvm default alias: '{}'", alias);
        if !alias.is_empty() {
            // alias 可能是 "22"(主版本) 或 "v22.22.1"(完整版本)，需要匹配
            let prefix = if alias.starts_with('v') { alias.to_string() } else { format!("v{}", alias) };
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut matched: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        name.starts_with(&prefix) && e.path().join("bin/node").exists()
                    })
                    .collect();
                matched.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
                if let Some(ver) = matched.first() {
                    let node_path = ver.path().join("bin/node");
                    eprintln!("[sidecar] nvm default 找到 node: {}", node_path.display());
                    return Some(node_path.to_string_lossy().to_string());
                }
            }
        }
    }

    // 2b) 没有 alias 文件时，扫描所有版本取最新
    if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
        let mut versions: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().join("bin/node").exists())
            .collect();
        versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        if let Some(latest) = versions.first() {
            let node_path = latest.path().join("bin/node");
            eprintln!("[sidecar] nvm 最新版本 node: {}", node_path.display());
            return Some(node_path.to_string_lossy().to_string());
        }
    }

    // 3) 常见固定路径
    let candidates = [
        format!("{}/Library/Application Support/fnm/aliases/default/bin/node", home),
        format!("{}/.local/share/fnm/aliases/default/bin/node", home),
        format!("{}/.volta/bin/node", home),
        "/opt/homebrew/bin/node".to_string(),
        "/usr/local/bin/node".to_string(),
        "/usr/bin/node".to_string(),
    ];

    for candidate in &candidates {
        if std::path::Path::new(candidate).exists() {
            eprintln!("[sidecar] 固定路径找到 node: {}", candidate);
            return Some(candidate.clone());
        }
    }

    eprintln!("[sidecar] 未找到 node");
    None
}

/// 存储子进程 PID，用于退出时清理
pub struct SidecarChild(pub Mutex<Option<u32>>);

/// 杀掉当前 sidecar 子进程（如果有）
fn kill_sidecar_process(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarChild>() {
        if let Ok(mut pid_lock) = state.0.lock() {
            if let Some(pid) = pid_lock.take() {
                println!("[sidecar] 正在终止子进程 PID={}", pid);
                // 先发 SIGTERM 让进程优雅退出
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .output();
                // 等待 500ms 后强制 SIGKILL
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                });
            }
        }
    }
}

/// 关闭 Sidecar 子进程（应用退出时调用）
pub fn shutdown_sidecar(app: &tauri::AppHandle) {
    // 标记正在关闭，防止自动重启
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    kill_sidecar_process(app);
    clear_sidecar_info();
    println!("[sidecar] 已关闭");
}
