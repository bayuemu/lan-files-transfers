 
use std::{collections::HashMap, str::FromStr, sync::Arc};
use log::LevelFilter;
use qrcode::{render::unicode, QrCode};
use tokio::sync::RwLock;
use entity::{AppConf, Client};
use tokio ;
use warp::{self,Filter};

mod handler; 
mod entity;
mod stun_server;
 

type  Clients = Arc<RwLock<HashMap<String, Client>>>;


#[tokio::main]
async fn main() ->std::io::Result<()> {
    
    let app_conf = AppConf::parse();
    let mut builder = env_logger::Builder::new();
    builder.filter_level(LevelFilter::from_str(&app_conf.log_level).unwrap());
    
    builder.init();
    
    let port:u16 = app_conf.web_stun_port;

    stun_server::start(port);

     
    let clients: Clients = Arc::new(RwLock::new(HashMap::new()));
    let cors = warp::cors().allow_any_origin() .build();
    let html_path = warp::any().and(warp::fs::dir("www"));

    let c1 = clients.clone();                                                            
    let web_socket = warp::path("ws") 
                                                                    .and(warp::ws())
                                                                    .and(warp::query::<HashMap<String, String>>())
                                                                    .and(warp::any().map(move || c1.clone()))
                                                                    .and_then(handler::ws_handler);
 

    let js_conf = warp::path("jsConf")
                                                                   .and(warp::get())
                                                                   .and(warp::any().map(move||port))
                                                                   .then(handler::js_conf_handler);
   

    let router = html_path
                                                                .or(web_socket)
                                                                .or(js_conf)
                                                                .with(cors);
                                                               
                                                               
    print_server_url_qrcode(port);
    
    warp::serve(router).run(([0,0,0,0],port)).await;
   
    Ok(())
}

fn print_server_url_qrcode(port:u16){
    println!("");
    println!("");
    println!("");

    let ip = local_ip_address::local_ip().unwrap();
    let url = format!("http://{}:{}",ip,port);

    let code = QrCode::new(url.clone()).unwrap();
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


 