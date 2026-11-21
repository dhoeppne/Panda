//! Restart requests use the same process sweep as quit, before any restart API fallback.
use crate::{server_auth, sweep_orphans, ProcTable};
use serde::Serialize;
use std::{sync::atomic::Ordering, time::Duration};
use tauri::{Manager, WebviewWindow};

#[derive(Serialize)]
pub struct UpdaterInfo {
    version: String,
    supported: bool,
}

fn supported() -> bool {
    cfg!(all(
        target_os = "macos",
        target_arch = "aarch64",
        not(debug_assertions)
    ))
}

#[tauri::command]
pub fn desktop_updater_info(window: WebviewWindow) -> Result<UpdaterInfo, String> {
    server_auth::local_main(&window)?;
    Ok(UpdaterInfo {
        version: window.app_handle().package_info().version.to_string(),
        supported: supported(),
    })
}

async fn stop_children(table: &ProcTable, timeout: Duration) -> Result<(), String> {
    sweep_orphans(table);
    tokio::time::timeout(timeout, async {
        while !table.procs.lock().unwrap().is_empty() || table.starting.load(Ordering::SeqCst) > 0 {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .map_err(|_| "Local agents are still closing. Try restarting again.".into())
}

#[tauri::command]
pub async fn desktop_update_restart(window: WebviewWindow) -> Result<(), String> {
    server_auth::local_main(&window)?;
    if !supported() {
        return Err("Updates require the installed Apple Silicon release app.".into());
    }
    let app = window.app_handle();
    let procs = app.state::<ProcTable>();
    let sockets = app.state::<server_auth::SocketTable>();
    procs.shutting_down.store(true, Ordering::SeqCst);
    sockets.shutting_down.store(true, Ordering::SeqCst);
    server_auth::close_all(&sockets);
    if let Err(error) = stop_children(&procs, Duration::from_secs(5)).await {
        procs.shutting_down.store(false, Ordering::SeqCst);
        sockets.shutting_down.store(false, Ordering::SeqCst);
        return Err(error);
    }
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ProcEntry;
    use std::sync::Arc;
    use tokio::sync::Notify;

    #[tokio::test]
    async fn restart_waits_for_the_exit_watcher_to_remove_the_child() {
        let table = Arc::new(ProcTable::default());
        let kill = Arc::new(Notify::new());
        table.procs.lock().unwrap().insert(
            1,
            ProcEntry {
                stdin: Arc::new(tokio::sync::Mutex::new(None)),
                kill: kill.clone(),
            },
        );
        let watcher_table = table.clone();
        let watcher = tokio::spawn(async move {
            kill.notified().await;
            tokio::time::sleep(Duration::from_millis(35)).await;
            watcher_table.procs.lock().unwrap().remove(&1);
        });
        stop_children(&table, Duration::from_secs(1)).await.unwrap();
        assert!(table.procs.lock().unwrap().is_empty());
        watcher.await.unwrap();
    }

    #[tokio::test]
    async fn a_stuck_watcher_fails_instead_of_restarting_over_live_children() {
        let table = ProcTable::default();
        table.procs.lock().unwrap().insert(
            1,
            ProcEntry {
                stdin: Arc::new(tokio::sync::Mutex::new(None)),
                kill: Arc::new(Notify::new()),
            },
        );
        assert!(stop_children(&table, Duration::from_millis(10))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn cleanup_waits_for_in_flight_spawns_and_blocks_new_spawns() {
        let table = Arc::new(ProcTable::default());
        table.starting.store(1, Ordering::SeqCst);
        table.shutting_down.store(true, Ordering::SeqCst);
        assert!(crate::begin_spawn(&table).is_err());
        let pending = table.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(35)).await;
            pending.starting.fetch_sub(1, Ordering::SeqCst);
        });
        stop_children(&table, Duration::from_secs(1)).await.unwrap();
        assert_eq!(table.starting.load(Ordering::SeqCst), 0);
    }
}
