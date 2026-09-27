 
use std::{collections::HashMap, str::FromStr, sync::Arc};
use log::LevelFilter;
use qrcode::{render::unicode, QrCode};
use tokio::sync::RwLock;
use entity::{AppConf, Client};
use warp::{self,Filter};

mod handler; 
mod entity;
mod stun_server;
mod turn_server;
 

type  Clients = Arc<RwLock<HashMap<String, Client>>>;
type  PairCodes = Arc<RwLock<HashMap<String, String>>>;
use turn_server::TurnCredMap;


#[tokio::main]
async fn main() ->std::io::Result<()> {
    
    let app_conf = AppConf::parse();
    let mut builder = env_logger::Builder::new();
    let log_level = LevelFilter::from_str(&app_conf.log_level).unwrap_or(LevelFilter::Warn);
    builder.filter_level(log_level);
    
    builder.init();
    
    let port:u16 = app_conf.web_stun_port;
    let web_addr = app_conf.web_addr.clone();
    let ip_port_str = format!("{}:{}", web_addr, port);

    let cred_map: TurnCredMap = Arc::new(std::sync::RwLock::new(HashMap::new()));
    let turn_server_handle = turn_server::start(port, cred_map.clone());

    
    let clients: Clients = Arc::new(RwLock::new(HashMap::new()));
    let pair_codes: PairCodes = Arc::new(RwLock::new(HashMap::new()));
    
    let cors = warp::cors()
              .allow_any_origin()
              .build();
    
    let html_path = warp::any()
                   .and(warp::fs::dir("www"));

    let c1 = clients.clone();
    let cm = cred_map.clone();
    let pc = pair_codes.clone();

    let web_socket = warp::path("ws") 
                      .and(warp::ws())
                      .and(warp::query::<HashMap<String, String>>())
                      .and(warp::any().map(move || c1.clone()))
                      .and(warp::any().map(move || cm.clone()))
                      .and(warp::any().map(move || pc.clone()))
                      .and_then(handler::ws_handler);
 
    let js_conf_ip_port_str = ip_port_str.clone();
    let js_conf = warp::path("jsConf")
                  .and(warp::get())
                  .and(warp::any().map(move||js_conf_ip_port_str.clone()))
                  .then(handler::js_conf_handler);

    let qr_code_ip_port_str = ip_port_str.clone();
    let qr_code = warp::path("qrCode")
                  .and(warp::get())
                  .and(warp::query::<HashMap<String, String>>())
                  .and(warp::any().map(move||qr_code_ip_port_str.clone()))
                  .then(|query: HashMap<String, String>, ip_port: String| async move {
                      let code = query
                          .get("code")
                          .or_else(|| query.get("to"))
                          .cloned()
                          .unwrap_or_default();
                      handler::create_qrcode(ip_port, code).await
                  });
   

    let router = html_path
                .or(web_socket)
                .or(js_conf)
                .or(qr_code)
                .with(cors);
                                                               
    
                                                          
    print_server_url_qrcode(ip_port_str);
 
    let ip_port = ([0,0,0,0],port);
       
    
    let (_, server) = warp::serve(router)
        .bind_with_graceful_shutdown(ip_port, async {
            if tokio::signal::ctrl_c().await.is_ok() {
                log::info!("Ctrl+C received, shutting down web server...");
            }
        });

    server.await;

    turn_server_handle.shutdown().await;
   
    Ok(())
}

fn print_server_url_qrcode(ip_port_str:String   ){
    println!("");
    println!("");
    println!("");

    // let ip = match local_ip_address::local_ip() {
    //     Ok(ip) => ip,
    //     Err(err) => {
    //         log::error!("get local ip failed: {:?}", err);
    //         println!("User Browser Open This URL:{}", ip_port_str);
    //         return;
    //     }
    // };
    let url = ip_port_str.clone( );

    let code = match QrCode::new(url.clone()) {
        Ok(code) => code,
        Err(err) => {
            log::error!("qrcode build failed: {:?}", err);
            println!("User Browser Open This URL:{}", url);
            return;
        }
    };
    let image = code.render::<unicode::Dense1x2>()
        .light_color(unicode::Dense1x2::Dark )
        .dark_color(unicode::Dense1x2::Light)
        //.quiet_zone(false)   
       // .module_dimensions(1, 1)
        
        .build();
    println!("{}", image);
    println!("");
    println!("");
    println!("");
    println!("User Browser Open This URL:{}", url);
}


 