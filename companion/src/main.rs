//! Setu Companion - Native Input Daemon for Setu Remote Control
//! Listens on 127.0.0.1:<PORT> (default 49152).
//! Requires shared security passkey authentication to execute input.
//! Zero telemetry, strictly local execution.

use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::http::header::{HeaderValue, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN};
use tokio_tungstenite::tungstenite::Message;

use enigo::{
    Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub port: u16,
    pub passkey: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port: 49152,
            passkey: format!("setu_sec_{:016x}{:016x}", rand_u64(), rand_u64()),
        }
    }
}

fn rand_u64() -> u64 {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    nanos.wrapping_mul(6364136223846793005).wrapping_add(1)
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum IncomingPacket {
    #[serde(rename = "rc-auth")]
    Auth { passkey: String },
    #[serde(rename = "rc-input")]
    Input {
        action: String,
        x: Option<f64>,
        y: Option<f64>,
        button: Option<String>,
        dx: Option<i32>,
        dy: Option<i32>,
        key: Option<String>,
        code: Option<String>,
    },
    #[serde(rename = "rc-ping")]
    Ping,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum OutgoingPacket {
    #[serde(rename = "rc-auth-success")]
    AuthSuccess,
    #[serde(rename = "rc-auth-failed")]
    AuthFailed { reason: String },
    #[serde(rename = "rc-override")]
    HostOverride,
    #[serde(rename = "rc-pong")]
    Pong,
}

struct CompanionState {
    config: AppConfig,
    enigo: Mutex<Enigo>,
    last_physical_mouse: Mutex<(i32, i32)>,
    last_simulated_mouse: Mutex<(i32, i32)>,
    override_until: Mutex<Option<Instant>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("----------------------------------------------------");
    println!("Setu Companion - Native Input Daemon");
    println!("----------------------------------------------------");

    let config = load_or_create_config()?;
    println!("[Config] Port: {}", config.port);
    println!("[Config] Security Passkey: {}", config.passkey);

    let enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(err) => {
            eprintln!("[Error] Failed to initialize native input simulator: {:?}", err);
            return Err("Enigo init failed".into());
        }
    };

    let initial_pos = enigo.location().unwrap_or((0, 0));
    let state = Arc::new(CompanionState {
        config: config.clone(),
        enigo: Mutex::new(enigo),
        last_physical_mouse: Mutex::new(initial_pos),
        last_simulated_mouse: Mutex::new(initial_pos),
        override_until: Mutex::new(None),
    });

    let addr: SocketAddr = format!("127.0.0.1:{}", config.port).parse()?;
    let listener = TcpListener::bind(&addr).await?;
    println!("[Server] Listening on ws://{}", addr);
    println!("[Ready] Waiting for Setu web application connection...");

    while let Ok((stream, peer_addr)) = listener.accept().await {
        let state = Arc::clone(&state);
        tokio::spawn(async move {
            handle_connection(stream, peer_addr, state).await;
        });
    }

    Ok(())
}

fn load_or_create_config() -> Result<AppConfig, Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let mut port_override = None;
    let mut key_override = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" if i + 1 < args.len() => {
                port_override = args[i + 1].parse::<u16>().ok();
                i += 2;
            }
            "--key" | "-k" if i + 1 < args.len() => {
                key_override = Some(args[i + 1].clone());
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    let config_path = get_config_path();
    let mut config = if config_path.exists() {
        match fs::read_to_string(&config_path) {
            Ok(content) => serde_json::from_str::<AppConfig>(&content).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        }
    } else {
        let def = AppConfig::default();
        if let Ok(json) = serde_json::to_string_pretty(&def) {
            let _ = fs::write(&config_path, json);
            println!("[Config] Generated new config at {}", config_path.display());
        }
        def
    };

    if let Some(p) = port_override {
        config.port = p;
    }
    if let Some(k) = key_override {
        config.passkey = k;
    }

    Ok(config)
}

fn get_config_path() -> PathBuf {
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("config.json");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    PathBuf::from("config.json")
}

async fn handle_connection(stream: TcpStream, peer_addr: SocketAddr, state: Arc<CompanionState>) {
    println!("[Connection] New client connecting from {}", peer_addr);

    let callback = |_req: &Request, mut resp: Response| {
        let headers = resp.headers_mut();
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
        headers.insert(
            ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, OPTIONS"),
        );
        headers.insert(ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("*"));
        headers.insert(
            HeaderValue::from_static("access-control-allow-private-network"),
            HeaderValue::from_static("true"),
        );
        Ok(resp)
    };

    let ws_stream = match tokio_tungstenite::accept_hdr_async(stream, callback).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[Error] WebSocket handshake failed: {:?}", e);
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();
    let authenticated = Arc::new(AtomicBool::new(false));

    while let Some(msg_result) = read.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[Connection] Stream error: {:?}", e);
                break;
            }
        };

        if msg.is_close() {
            println!("[Connection] Client disconnected from {}", peer_addr);
            break;
        }

        if let Ok(text) = msg.to_text() {
            let packet: IncomingPacket = match serde_json::from_str(text) {
                Ok(p) => p,
                Err(_) => continue,
            };

            match packet {
                IncomingPacket::Auth { passkey } => {
                    if passkey == state.config.passkey {
                        authenticated.store(true, Ordering::SeqCst);
                        println!("[Auth] Client authenticated successfully from {}", peer_addr);
                        let resp = serde_json::to_string(&OutgoingPacket::AuthSuccess).unwrap_or_default();
                        let _ = write.send(Message::Text(resp)).await;
                    } else {
                        println!("[Auth] Passkey mismatch from {}", peer_addr);
                        let resp = serde_json::to_string(&OutgoingPacket::AuthFailed {
                            reason: "Invalid security passkey".into(),
                        })
                        .unwrap_or_default();
                        let _ = write.send(Message::Text(resp)).await;
                        break;
                    }
                }
                IncomingPacket::Ping => {
                    let resp = serde_json::to_string(&OutgoingPacket::Pong).unwrap_or_default();
                    let _ = write.send(Message::Text(resp)).await;
                }
                IncomingPacket::Input {
                    action,
                    x,
                    y,
                    button,
                    dx,
                    dy,
                    key,
                    code: _,
                } => {
                    if !authenticated.load(Ordering::SeqCst) {
                        eprintln!("[Security] Rejected unauthenticated input command");
                        break;
                    }

                    // Host physical mouse supremacy check
                    {
                        let mut override_lock = state.override_until.lock().await;
                        if let Some(expiry) = *override_lock {
                            if Instant::now() < expiry {
                                continue;
                            } else {
                                *override_lock = None;
                            }
                        }
                    }

                    execute_input(&state, &action, x, y, button.as_deref(), dx, dy, key.as_deref()).await;
                }
            }
        }
    }
}

async fn execute_input(
    state: &CompanionState,
    action: &str,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<&str>,
    dx: Option<i32>,
    dy: Option<i32>,
    key_str: Option<&str>,
) {
    let mut enigo = state.enigo.lock().await;

    let (screen_w, screen_h) = enigo.main_display().unwrap_or((1920, 1080));

    match action {
        "mousemove" => {
            if let (Some(norm_x), Some(norm_y)) = (x, y) {
                let target_x = (norm_x * screen_w as f64).round() as i32;
                let target_y = (norm_y * screen_h as f64).round() as i32;

                // Check physical mouse movement
                let current_loc = enigo.location().unwrap_or((target_x, target_y));
                let last_sim = *state.last_simulated_mouse.lock().await;

                let diff_x = (current_loc.0 - last_sim.0).abs();
                let diff_y = (current_loc.1 - last_sim.1).abs();

                if diff_x > 15 || diff_y > 15 {
                    // Physical host mouse moved: activate supremacy override
                    println!("[Host Supremacy] Physical mouse activity detected. Suppressing remote commands for 2.0s");
                    let mut override_lock = state.override_until.lock().await;
                    *override_lock = Some(Instant::now() + Duration::from_millis(2000));
                    return;
                }

                let _ = enigo.move_mouse(target_x, target_y, Coordinate::Abs);
                *state.last_simulated_mouse.lock().await = (target_x, target_y);
            }
        }
        "mousedown" => {
            let btn = parse_button(button);
            let _ = enigo.button(btn, Direction::Press);
        }
        "mouseup" => {
            let btn = parse_button(button);
            let _ = enigo.button(btn, Direction::Release);
        }
        "wheel" => {
            if let Some(delta_y) = dy {
                let ticks = if delta_y > 0 { -1 } else { 1 };
                let _ = enigo.scroll(ticks, Axis::Vertical);
            }
        }
        "keydown" => {
            if let Some(k) = key_str {
                if let Some(enigo_key) = parse_key(k) {
                    let _ = enigo.key(enigo_key, Direction::Press);
                }
            }
        }
        "keyup" => {
            if let Some(k) = key_str {
                if let Some(enigo_key) = parse_key(k) {
                    let _ = enigo.key(enigo_key, Direction::Release);
                }
            }
        }
        _ => {}
    }
}

fn parse_button(btn: Option<&str>) -> Button {
    match btn {
        Some("right") => Button::Right,
        Some("middle") => Button::Middle,
        _ => Button::Left,
    }
}

fn parse_key(key: &str) -> Option<Key> {
    match key {
        "Enter" => Some(Key::Return),
        "Backspace" => Some(Key::Backspace),
        "Tab" => Some(Key::Tab),
        "Escape" => Some(Key::Escape),
        "Space" | " " => Some(Key::Space),
        "ArrowUp" => Some(Key::UpArrow),
        "ArrowDown" => Some(Key::DownArrow),
        "ArrowLeft" => Some(Key::LeftArrow),
        "ArrowRight" => Some(Key::RightArrow),
        "Delete" => Some(Key::Delete),
        "Home" => Some(Key::Home),
        "End" => Some(Key::End),
        "PageUp" => Some(Key::PageUp),
        "PageDown" => Some(Key::PageDown),
        "Shift" => Some(Key::Shift),
        "Control" => Some(Key::Control),
        "Alt" => Some(Key::Alt),
        "Meta" => Some(Key::Meta),
        k if k.chars().count() == 1 => {
            k.chars().next().map(Key::Unicode)
        }
        _ => None,
    }
}
