use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;

use tokio::net::UdpSocket;
use tokio::sync::oneshot;

use tokio::time::Duration;

use turn::relay::relay_range::RelayAddressGeneratorRanges;
use webrtc::turn::auth::*;
use webrtc::turn::server::config::*;

use webrtc::turn::server::Server;
use webrtc::turn::Error;
use webrtc::util::vnet::net::*;

pub type TurnCredMap = Arc<std::sync::RwLock<HashMap<String, Vec<u8>>>>;

struct MyAuthHandler {
    cred_map: TurnCredMap,
}

pub struct TurnServerHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    join_handle: tokio::task::JoinHandle<()>,
}

impl TurnServerHandle {
    pub async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = self.join_handle.await;
    }
}

impl MyAuthHandler {
    fn new(cred_map: TurnCredMap) -> Self {
        MyAuthHandler { cred_map }
    }
}

impl AuthHandler for MyAuthHandler {
    fn auth_handle(
        &self,
        username: &str,
        _realm: &str,
        _src_addr: SocketAddr,
    ) -> Result<Vec<u8>, Error> {
        println!(
            "username={}, password={:?}   _realm:{:?}",
            username, username, _realm
        );
        // let realm="test";
        // let key = generate_auth_key(username, realm, username);
        // Ok(key.to_vec())
        if let Ok(map) = self.cred_map.read() {
            if let Some(pw) = map.get(username) {
                println!("username={}, password={:?}", username, pw);
                return Ok(pw.to_vec());
            }
        }
        Err(Error::ErrFakeErr)
    }
}

pub fn start(port: u16, cred_map: TurnCredMap) -> TurnServerHandle {
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let join_handle = tokio::spawn(async move {
        if let Err(err) = turn_init(port, shutdown_rx, cred_map).await {
            log::error!("turn server err: {:?}", err);
        }
    });

    TurnServerHandle {
        shutdown_tx: Some(shutdown_tx),
        join_handle,
    }
}

async fn turn_init(port: u16, mut shutdown_rx: oneshot::Receiver<()>, cred_map: TurnCredMap) -> Result<(), Error> {
    // 3478
    let conn = Arc::new(UdpSocket::bind(format!("0.0.0.0:{port}")).await?);

    println!("listening {}...", conn.local_addr()?);

    let realm = "test";

    let relay_ip = local_ip_address::local_ip()
        .ok()
        .filter(|ip| ip.is_ipv4())
        .unwrap_or(IpAddr::from_str("127.0.0.1")?);

    let server = Server::new(ServerConfig {
        conn_configs: vec![ConnConfig {
            conn,
            relay_addr_generator: Box::new(RelayAddressGeneratorRanges {
                relay_address: relay_ip,
                address: "0.0.0.0".to_owned(),
                net: Arc::new(Net::new(None)),
                min_port: 49200,
                max_port: 60000,
                max_retries: 3,
            }),
        }],
        realm: realm.to_owned(),
        auth_handler: Arc::new(MyAuthHandler::new(cred_map)),
        channel_bind_timeout: Duration::from_secs(0),
        alloc_close_notify: None,
    })
    .await?;

    println!("TURN server started and waiting for shutdown signal...");
    tokio::select! {
        _ = &mut shutdown_rx => {
            println!("TURN server received shutdown signal");
        }
    }

    println!("\nClosing connection now...");
    server.close().await?;
    println!("listening end {}...", "--------------------");
    Ok(())
}

pub fn add_turn_credential(cred_map: &TurnCredMap, username: &str, password: &str) {
    let key = generate_auth_key(username, "test", password);
    if let Ok(mut map) = cred_map.write() {
        map.insert(username.to_owned(), key);
    }
}

pub fn remove_turn_credential(cred_map: &TurnCredMap, username: &str) {
    if let Ok(mut map) = cred_map.write() {
        map.remove(username);
    }
}
