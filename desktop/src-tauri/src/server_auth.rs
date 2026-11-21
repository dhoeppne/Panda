//! Sign in with the app's website-data store, then use its cookies in a native
//! WebSocket handshake. Cookie values never cross IPC or enter logs.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{ipc::Channel, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::{mpsc, oneshot, Notify};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::header};

use crate::websocket::{run_socket, PendingWrite};

struct SocketEntry {
    writes: mpsc::Sender<PendingWrite>,
    close: Arc<Notify>,
}

#[derive(Default)]
pub struct SocketTable {
    next_id: AtomicU32,
    sockets: Mutex<HashMap<u32, SocketEntry>>,
    pub(crate) shutting_down: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SocketEvent {
    Text { data: String },
    Close { code: u16, error: Option<String> },
}

pub(crate) fn local_main(window: &WebviewWindow) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| "Could not identify the app window.")?;
    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(5173));
    if window.label() == "main" && local {
        Ok(())
    } else {
        Err("Server connections can only be opened by the local Panda app.".into())
    }
}

fn endpoint(raw: &str) -> Result<(Url, Url), String> {
    let socket = Url::parse(raw).map_err(|_| "Enter a valid WebSocket endpoint.")?;
    if !matches!(socket.scheme(), "ws" | "wss")
        || socket.host_str().is_none()
        || !socket.username().is_empty()
        || socket.password().is_some()
        || socket.fragment().is_some()
    {
        return Err(
            "Use a ws:// or wss:// endpoint without embedded credentials or a fragment.".into(),
        );
    }
    let mut website = socket.clone();
    website
        .set_scheme(if socket.scheme() == "wss" {
            "https"
        } else {
            "http"
        })
        .unwrap();
    Ok((socket, website))
}

#[tauri::command]
pub async fn server_sign_in(window: WebviewWindow, url: String) -> Result<(), String> {
    local_main(&window)?;
    let (_, mut website) = endpoint(&url)?;
    if website.scheme() != "https" {
        return Err("Server sign-in requires a secure wss:// endpoint.".into());
    }
    website.set_path("/");
    website.set_query(None);
    website.set_fragment(None);
    let app = window.app_handle();
    if let Some(previous) = app.get_webview_window("server-sign-in") {
        previous
            .navigate(website)
            .map_err(|_| "Could not open the server sign-in page.")?;
        previous
            .set_focus()
            .map_err(|_| "Could not focus the sign-in window.")?;
        return Ok(());
    }
    // The default persistent website-data store is shared with the main
    // webview. This window has no capability grants and receives no local IPC access.
    WebviewWindowBuilder::new(app, "server-sign-in", WebviewUrl::External(website.clone()))
        .title(format!(
            "Sign in — {}",
            website.host_str().unwrap_or("server")
        ))
        .inner_size(720.0, 800.0)
        .on_navigation(|url| url.scheme() == "https")
        .build()
        .map_err(|_| "Could not open the server sign-in window.")?;
    Ok(())
}

// Filter again after the platform cookie lookup. In particular, a cookie
// scoped to /outpost must never be sent to /acp, nor a Secure cookie over ws.
fn cookie_matches(cookie: &tauri::webview::Cookie<'_>, url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    let domain = cookie.domain().unwrap_or_default().trim_start_matches('.');
    let domain_ok = !domain.is_empty()
        && (host.eq_ignore_ascii_case(domain)
            || host
                .to_ascii_lowercase()
                .ends_with(&format!(".{}", domain.to_ascii_lowercase())));
    let path = cookie.path().filter(|path| !path.is_empty()).unwrap_or("/");
    let path_ok = url.path() == path
        || (url.path().starts_with(path)
            && (path.ends_with('/') || url.path().as_bytes().get(path.len()) == Some(&b'/')));
    let not_expired = cookie.expires_datetime().is_none_or(|expiry| {
        expiry.unix_timestamp()
            > std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64
    });
    domain_ok
        && path_ok
        && not_expired
        && (cookie.secure() != Some(true) || url.scheme() == "https")
}

#[tauri::command]
pub async fn websocket_connect(
    window: WebviewWindow,
    url: String,
    on_event: Channel<SocketEvent>,
) -> Result<u32, String> {
    local_main(&window)?;
    if window.state::<SocketTable>().shutting_down.load(Ordering::SeqCst) {
        return Err("Panda is preparing to restart.".into());
    }
    let (socket_url, website) = endpoint(&url)?;
    let cookie_window = window.clone();
    let lookup = website.clone();
    // Cookie APIs dispatch to the webview thread; never block that thread.
    let cookies =
        tauri::async_runtime::spawn_blocking(move || cookie_window.cookies_for_url(lookup))
            .await
            .map_err(|_| "Could not read the app's server session.")?
            .map_err(|_| "Could not read the app's server session.")?;
    let cookie_header = cookies
        .iter()
        .filter(|cookie| cookie_matches(cookie, &website))
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
        .collect::<Vec<_>>()
        .join("; ");
    let mut request = socket_url
        .as_str()
        .into_client_request()
        .map_err(|_| "Could not prepare the WebSocket connection.")?;
    request.headers_mut().insert(
        header::ORIGIN,
        website
            .origin()
            .ascii_serialization()
            .parse()
            .map_err(|_| "Invalid server origin.")?,
    );
    if !cookie_header.is_empty() {
        request.headers_mut().insert(
            header::COOKIE,
            cookie_header
                .parse()
                .map_err(|_| "The app's server session is invalid. Sign in again.")?,
        );
    }
    // Do not follow redirects with credentials. A redirect or auth rejection
    // should send the user to a visible login window instead.
    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(request))
        .await.map_err(|_| "The server did not answer within 15 seconds.")?
        .map_err(|error| match error {
            tokio_tungstenite::tungstenite::Error::Http(response)
                if response.status().is_redirection() || matches!(response.status().as_u16(), 401 | 403) =>
                "Server sign-in is required. Click ‘Sign in to server’, complete sign-in, then test again.".to_string(),
            // Never format handshake errors: they can contain request/response credentials.
            _ => "Could not open the server connection. Check the endpoint and network, then try again.".into(),
        })?;
    let app = window.app_handle().clone();
    let table = app.state::<SocketTable>();
    let id = table.next_id.fetch_add(1, Ordering::Relaxed);
    let (writes, pending) = mpsc::channel::<PendingWrite>(16);
    let close = Arc::new(Notify::new());
    {
        let mut sockets = table.sockets.lock().unwrap();
        if table.shutting_down.load(Ordering::SeqCst) {
            return Err("Panda is preparing to restart.".into());
        }
        sockets.insert(id, SocketEntry { writes, close: close.clone() });
    }
    tauri::async_runtime::spawn(async move {
        let (code, error) = run_socket(&mut socket, pending, close, |event| {
            on_event.send(event).is_ok()
        })
        .await;
        app.state::<SocketTable>()
            .sockets
            .lock()
            .unwrap()
            .remove(&id);
        let _ = on_event.send(SocketEvent::Close { code, error });
    });
    Ok(id)
}

#[tauri::command]
pub async fn websocket_write(window: WebviewWindow, id: u32, data: String) -> Result<(), String> {
    local_main(&window)?;
    let writes = window
        .state::<SocketTable>()
        .sockets
        .lock()
        .unwrap()
        .get(&id)
        .map(|entry| entry.writes.clone())
        .ok_or("The server connection is closed.")?;
    let (result, received) = oneshot::channel();
    writes
        .send(PendingWrite { data, result })
        .await
        .map_err(|_| "The server connection is closed.")?;
    received
        .await
        .map_err(|_| "The server connection is closed.")?
}

#[tauri::command]
pub async fn websocket_close(window: WebviewWindow, id: u32) -> Result<(), String> {
    local_main(&window)?;
    if let Some(entry) = window
        .state::<SocketTable>()
        .sockets
        .lock()
        .unwrap()
        .remove(&id)
    {
        entry.close.notify_one();
    }
    Ok(())
}

pub fn close_all(table: &SocketTable) {
    for (_, entry) in table.sockets.lock().unwrap().drain() {
        entry.close.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::webview::Cookie;

    #[test]
    fn endpoints_reject_credentials_and_non_websocket_urls() {
        for url in [
            "https://example.com",
            "wss://user:password@example.com/acp",
            "wss://example.com/acp#secret",
        ] {
            assert!(endpoint(url).is_err());
        }
        assert_eq!(
            endpoint("wss://example.com:8443/acp/a").unwrap().1.as_str(),
            "https://example.com:8443/acp/a"
        );
    }

    #[test]
    fn cookies_stay_with_their_domain_path_and_secure_transport() {
        let cookie = Cookie::build(("session", "secret"))
            .domain(".example.com")
            .path("/acp")
            .secure(true)
            .build();
        assert!(cookie_matches(
            &cookie,
            &Url::parse("https://chat.example.com/acp/a").unwrap()
        ));
        for url in [
            "https://other.com/acp/a",
            "https://evil-example.com/acp/a",
            "https://chat.example.com/acp-other",
            "http://chat.example.com/acp/a",
        ] {
            assert!(!cookie_matches(&cookie, &Url::parse(url).unwrap()));
        }
    }
}
