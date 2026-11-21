//! Native socket I/O and transport-level liveness. No ACP requests or retries here.
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot, Notify};
use tokio::time::{sleep_until, timeout, Instant};
use tokio_tungstenite::{tungstenite::Message, WebSocketStream};

use crate::server_auth::SocketEvent;

const PING_INTERVAL: Duration = Duration::from_secs(30);
const PONG_TIMEOUT: Duration = Duration::from_secs(10);
// A suspended process cannot check its deadline. Give a substantially late
// timer a fresh probe instead of declaring a healthy socket dead on wake.
const SUSPENDED_TIMER_DELAY: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(15);

pub struct PendingWrite {
    pub data: String,
    pub result: oneshot::Sender<Result<(), String>>,
}

pub async fn run_socket<S>(
    socket: &mut WebSocketStream<S>,
    mut pending: mpsc::Receiver<PendingWrite>,
    close: Arc<Notify>,
    mut emit: impl FnMut(SocketEvent) -> bool,
) -> (u16, Option<String>)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut next_check = Instant::now() + PING_INTERVAL;
    let mut awaiting_pong: Option<[u8; 8]> = None;
    let mut sequence = 0_u64;
    loop {
        tokio::select! {
            _ = close.notified() => {
                let _ = timeout(Duration::from_secs(2), socket.close(None)).await;
                return (1000, None);
            }
            _ = sleep_until(next_check) => {
                if awaiting_pong.is_some()
                    && Instant::now().saturating_duration_since(next_check) < SUSPENDED_TIMER_DELAY
                {
                    return (1006, Some("The server connection stopped responding. Reconnecting may restore the chat.".into()));
                }
                sequence = sequence.wrapping_add(1);
                let payload = sequence.to_be_bytes();
                if !matches!(timeout(WRITE_TIMEOUT, socket.send(Message::Ping(payload.to_vec().into()))).await, Ok(Ok(()))) {
                    return lost_connection();
                }
                awaiting_pong = Some(payload);
                // Start the response window after the probe actually leaves the sink.
                next_check = Instant::now() + PONG_TIMEOUT;
            }
            write = pending.recv() => {
                let Some(write) = write else { return (1000, None); };
                let sent = timeout(WRITE_TIMEOUT, socket.send(Message::Text(write.data.into()))).await;
                let result = match sent {
                    Ok(Ok(())) => Ok(()),
                    _ => Err("The server connection stopped accepting messages.".to_string()),
                };
                let failed = result.is_err();
                let _ = write.result.send(result);
                if failed { return lost_connection(); }
            }
            incoming = socket.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if !emit(SocketEvent::Text { data: text.to_string() }) { return (1000, None); }
                }
                Some(Ok(Message::Pong(payload))) => {
                    if awaiting_pong.as_ref().is_some_and(|expected| payload.as_ref() == expected) {
                        awaiting_pong = None;
                        next_check = Instant::now() + PING_INTERVAL;
                    }
                }
                Some(Ok(Message::Close(frame))) => return (frame.map(|frame| u16::from(frame.code)).unwrap_or(1000), None),
                Some(Ok(Message::Binary(_))) => return (1003, Some("The server sent a binary ACP message.".into())),
                Some(Ok(_)) => {} // Reading again flushes tungstenite's automatic pong replies.
                Some(Err(_)) => return lost_connection(),
                None => return (1000, None),
            }
        }
    }
}

fn lost_connection() -> (u16, Option<String>) {
    (1006, Some("The server connection was lost.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, AsyncWriteExt, DuplexStream};
    use tokio::task::{yield_now, JoinHandle};
    use tokio::time::advance;
    use tokio_tungstenite::tungstenite::protocol::Role;

    struct Harness {
        peer: WebSocketStream<DuplexStream>,
        writes: mpsc::Sender<PendingWrite>,
        events: mpsc::UnboundedReceiver<SocketEvent>,
        close: Arc<Notify>,
        task: JoinHandle<(u16, Option<String>)>,
    }

    async fn harness() -> Harness {
        let (client, server) = duplex(4096);
        let mut socket = WebSocketStream::from_raw_socket(client, Role::Client, None).await;
        let peer = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
        let (writes, pending) = mpsc::channel(16);
        let (events_tx, events) = mpsc::unbounded_channel();
        let close = Arc::new(Notify::new());
        let actor_close = close.clone();
        let task = tokio::spawn(async move {
            run_socket(&mut socket, pending, actor_close, |event| {
                events_tx.send(event).is_ok()
            })
            .await
        });
        yield_now().await;
        Harness {
            peer,
            writes,
            events,
            close,
            task,
        }
    }

    async fn next_ping(h: &mut Harness) -> Vec<u8> {
        advance(PING_INTERVAL).await;
        match h.peer.next().await.unwrap().unwrap() {
            Message::Ping(payload) => payload.to_vec(),
            message => panic!("expected a heartbeat ping, got {message:?}"),
        }
    }

    // Send a server frame without flushing tungstenite's queued automatic
    // pong. This simulates a broken peer or a stale reply after suspension.
    async fn raw_pong(h: &mut Harness, payload: &[u8]) {
        let mut frame = vec![0x8a, payload.len() as u8];
        frame.extend_from_slice(payload);
        h.peer.get_mut().write_all(&frame).await.unwrap();
        yield_now().await;
    }

    #[tokio::test(start_paused = true)]
    async fn healthy_idle_socket_answers_probes_without_forwarding_control_frames() {
        let mut h = harness().await;
        for _ in 0..3 {
            next_ping(&mut h).await;
            h.peer.flush().await.unwrap(); // Real tungstenite automatic pong.
            yield_now().await;
            assert!(!h.task.is_finished());
            assert!(h.events.try_recv().is_err());
        }
        h.close.notify_one();
        assert_eq!(h.task.await.unwrap(), (1000, None));
    }

    #[tokio::test(start_paused = true)]
    async fn missing_pong_reports_an_abnormal_disconnect_instead_of_hanging() {
        let mut h = harness().await;
        next_ping(&mut h).await;
        advance(PONG_TIMEOUT).await;
        let (code, error) = h.task.await.unwrap();
        assert_eq!(code, 1006);
        assert!(error.unwrap().contains("stopped responding"));
        assert!(h.events.try_recv().is_err());
        let (result, received) = oneshot::channel();
        assert!(h
            .writes
            .send(PendingWrite {
                data: "{}".into(),
                result
            })
            .await
            .is_err());
        assert!(received.await.is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn unrelated_pongs_and_text_do_not_hide_a_missing_probe_reply() {
        let mut h = harness().await;
        next_ping(&mut h).await;
        raw_pong(&mut h, b"unrelated").await;
        // A text frame also bypasses the peer's queued automatic pong.
        h.peer.get_mut().write_all(b"\x81\x02{}").await.unwrap();
        assert!(matches!(h.events.recv().await, Some(SocketEvent::Text { data }) if data == "{}"));
        advance(PONG_TIMEOUT).await;
        assert_eq!(h.task.await.unwrap().0, 1006);
    }

    #[tokio::test(start_paused = true)]
    async fn a_late_timer_gets_a_fresh_probe_and_can_recover() {
        let mut h = harness().await;
        let old = next_ping(&mut h).await;
        // The actor cannot run during this jump, as if the process slept.
        advance(PONG_TIMEOUT + Duration::from_secs(20)).await;
        yield_now().await;
        let fresh = match h.peer.next().await.unwrap().unwrap() {
            Message::Ping(payload) => payload.to_vec(),
            message => panic!("expected a fresh ping, got {message:?}"),
        };
        assert_ne!(old, fresh);
        raw_pong(&mut h, &old).await;
        advance(PONG_TIMEOUT - Duration::from_secs(1)).await;
        assert!(!h.task.is_finished());
        raw_pong(&mut h, &fresh).await;
        advance(Duration::from_secs(2)).await;
        yield_now().await;
        assert!(!h.task.is_finished());
        h.close.notify_one();
        assert_eq!(h.task.await.unwrap(), (1000, None));
    }

    #[tokio::test(start_paused = true)]
    async fn a_stale_pong_cannot_keep_the_socket_alive_after_wake() {
        let mut h = harness().await;
        let old = next_ping(&mut h).await;
        advance(PONG_TIMEOUT + Duration::from_secs(20)).await;
        yield_now().await;
        raw_pong(&mut h, &old).await;
        advance(PONG_TIMEOUT).await;
        assert_eq!(h.task.await.unwrap().0, 1006);
    }

    #[tokio::test(start_paused = true)]
    async fn writes_and_server_pings_work_and_explicit_close_stays_clean() {
        let mut h = harness().await;
        let (result, received) = oneshot::channel();
        h.writes
            .send(PendingWrite {
                data: "{\"jsonrpc\":\"2.0\"}".into(),
                result,
            })
            .await
            .unwrap();
        assert_eq!(received.await.unwrap(), Ok(()));
        assert!(
            matches!(h.peer.next().await.unwrap().unwrap(), Message::Text(text) if text == "{\"jsonrpc\":\"2.0\"}")
        );
        h.peer
            .send(Message::Ping(b"server".to_vec().into()))
            .await
            .unwrap();
        assert_eq!(
            h.peer.next().await.unwrap().unwrap(),
            Message::Pong(b"server".to_vec().into())
        );
        next_ping(&mut h).await;
        h.close.notify_one();
        assert_eq!(h.task.await.unwrap(), (1000, None));
        advance(PONG_TIMEOUT).await;
        assert!(h.events.try_recv().is_err());
    }
}
