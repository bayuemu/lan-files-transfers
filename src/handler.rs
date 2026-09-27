use std::collections::HashMap;
 

 
use futures_util::{SinkExt, StreamExt};
use image::{codecs::png::PngEncoder, ColorType, ImageEncoder, Luma};
 
use qrcode::{  QrCode};
 
use tokio::sync::mpsc;
use warp::http::StatusCode;
use warp::{filters::ws::WebSocket,   reject::Rejection, reply::Reply};
use warp::{self, reply::Response};
use warp::ws::Message;

use crate::entity::{Client, ClistMsg, ConnectMsg, JsConf};
use crate::Clients; 
use crate::turn_server::{add_turn_credential, remove_turn_credential, TurnCredMap};


  

pub async fn ws_handler(ws: warp::ws::Ws,map:HashMap<String, String>,clients :Clients, cred_map: TurnCredMap, pair_codes: crate::PairCodes) -> Result<impl Reply,Rejection>{
  
    let name = match map.get("id") {
        Some(v) if !v.trim().is_empty() && v.len() < 64 => v.to_string(),
        _ => return Err(warp::reject::not_found()),
    };
    
    match clients.read().await.get(name.clone().as_str()){
        Some(_) => Err(warp::reject::not_found()),
        None => {
            
            let clients_ = clients.clone();
            let c = ws.on_upgrade(move|socket|{
                  client_handler(socket,clients_,name, cred_map, pair_codes)
            });
             
            return Ok(c);
        },
    }

    
}

 

pub async fn client_handler(socket: WebSocket,clients :Clients,name:String, cred_map: TurnCredMap, pair_codes: crate::PairCodes){
 
    let (mut client_ws_sender, mut client_ws_rcv) = socket.split();

    let (tx, mut rx) = mpsc::unbounded_channel();
    
    let password = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos().to_string();
    add_turn_credential(&cred_map, &name, &password);
    
    let cred_msg = ClistMsg {
        tpye: "turn_credentials".to_string(),
        content: serde_json::json!({
            "username": name.clone(),
            "credential": password
        }),
    };
    let _ = tx.send(Message::text(serde_json::to_string(&cred_msg).unwrap()));
    
    let tmp_name = name.clone();
    tokio::task::spawn(async move {
        while let Some(msg) = rx.recv().await{
            
            match client_ws_sender.send(msg).await{
                Ok(_) => {
                    log::info!("send to Client Id:{} Ok!",tmp_name.clone());
                },
                Err(err) => {
                    log::error!("send to Client Id:{}, Err:{:?}",tmp_name.clone(),err);
                },
            };
        }
    });

    let client = Client{sender:Some(tx)};
    clients.write().await.insert(name.clone(), client);

    

    while let Some(res_msg) = client_ws_rcv.next().await{
           let clients_u = clients.clone();
           let pair_codes_u = pair_codes.clone();
            match res_msg{
                Ok(msg) => {
                
                if msg.is_text(){
                        log::info!("Receive Text Msg From  Client Id:{:?}",msg);
                        do_text_msg(msg,clients_u,name.clone(), pair_codes_u).await;
                    }
                    
                },
                Err(err) => {
                    log::error!("Receive Msg From  Client Id:{}, Err:{:?}",name.clone(),err);
                },
            }
    }
    
    clients.write().await.remove(&name);
    remove_turn_credential(&cred_map, &name);
    {
        let mut map = pair_codes.write().await;
        map.retain(|_, v| v != &name);
    }
    log::error!("Client ID:{} Disconnected", name);
    // send_client_list(clients.clone()).await;
    
}

async fn do_text_msg(msg:Message,clients :Clients,name:String, pair_codes: crate::PairCodes){
    match serde_json::from_slice::<ClistMsg>(msg.as_bytes()){
        Ok(s) => {
              match s.tpye.as_str(){
                "ping"=>{
                    send_pong_action(clients.clone(),name.clone()).await;
                },
                "generate_code" => {
                    let mut code = String::new();
                    let mut map = pair_codes.write().await;
                    for _ in 0..10 {
                        let num = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos() % 1000000;
                        let c = format!("{:06}", num);
                        if !map.contains_key(&c) {
                            code = c;
                            break;
                        }
                    }
                    if !code.is_empty() {
                        map.insert(code.clone(), name.clone());
                        let res = ClistMsg {
                            tpye: "code_generated".to_string(),
                            content: serde_json::json!({ "code": code }),
                        };
                        if let Some(c) = clients.read().await.get(&name) {
                            send_to_client(c, &res);
                        }
                    }
                },
                "resolve_code" => {
                    if let Some(code) = s.content.get("code").and_then(|c| c.as_str()) {
                        if let Some(uuid) = pair_codes.read().await.get(code) {
                            let res = ClistMsg {
                                tpye: "code_resolved".to_string(),
                                content: serde_json::json!({ "code": code, "uuid": uuid }),
                            };
                            if let Some(c) = clients.read().await.get(&name) {
                                send_to_client(c, &res);
                            }
                        } else {
                            let res = ClistMsg {
                                tpye: "error".to_string(),
                                content: serde_json::json!("Code not found or expired"),
                            };
                            if let Some(c) = clients.read().await.get(&name) {
                                send_to_client(c, &res);
                            }
                        }
                    }
                },
                 "connect" =>{
                    log::info!("connect text msg:{:?} ",s);
                    connect_text_action(s.content,clients.clone(), pair_codes.clone()).await;
                },
                "offer" =>{
                    log::info!("offer text msg:{:?} ",s);
                    action_text_action(s.content,clients.clone(),"offer".to_string()).await;
                 },
                 "ice" =>{
                    log::info!("ice text msg:{:?} ",s);
                    action_text_action(s.content,clients.clone(),"ice".to_string()).await;
                 },
                 "answer" =>{
                    log::info!("answer text msg:{:?} ",s);
                    action_text_action(s.content,clients.clone(),"answer".to_string()).await;
                 },
                 "error" =>{
                    log::info!("error text msg:{:?} ",s);
                    action_text_action(s.content,clients.clone(),"error".to_string()).await;
                 },
                 _ =>{
                    log::error!("any text msg:{:?} ",s);
                 }
              }
        },
        Err(err) => {
            log::error!("msg to json err:{:?}",err);
            if let Some(c) = clients.read().await.get(&name) {
                let err_msg = ClistMsg {
                    tpye: "error".to_string(),
                    content: serde_json::json!(format!("Invalid JSON: {}", err)),
                };
                send_to_client(c, &err_msg);
            }
        },
       }
}

async fn action_text_action(content:serde_json::Value,clients :Clients,action:String){
    
    match serde_json::from_value::<ConnectMsg>(content.clone()){
        Ok(obj) => {
         
            if let Some(to) = obj.to {
                match clients.read().await.get(&to){
                    Some(c) => {
                        let m = ClistMsg{tpye:action,content:content};
                        send_to_client(c, &m);
                    },
                    None => {
                        log::error!("connect send text msg:{:?} ","err"); 
                    },
                }
            }
        },
        Err(err) => {
            log::error!("connect err:{:?}",err);
        },
    }
}

async fn connect_text_action(content:serde_json::Value,clients :Clients, pair_codes: crate::PairCodes){
    
    match serde_json::from_value::<ConnectMsg>(content.clone()){
        Ok(obj) => {
            
            let target_uuid = if let Some(code) = obj.to_code {
                pair_codes.read().await.get(&code).cloned()
            } else if let Some(to) = obj.to {
                Some(to)
            } else {
                None
            };

            if let Some(to) = target_uuid {
                match clients.read().await.get(&to){
                    Some(c) => {
                        let m = ClistMsg{tpye:"connect".to_string(),content:content};
                        send_to_client(c, &m);
                    },
                    None => {
                        log::error!("connect send text msg:{:?} ","err"); 
                    },
                }
            } else {
                log::error!("connect code not found or empty"); 
            }
        },
        Err(err) => {
            log::error!("connect err:{:?}",err);
        },
    }
}

async fn send_pong_action(clients :Clients,name:String){
    clients.read().await.get(&name).map(|c|{
        let m = ClistMsg{tpye:"pong".to_string(),content:serde_json::Value::String(String::new())};
        send_to_client(c, &m);
    });
}
 
 fn send_to_client(client: &Client, msg: &ClistMsg) {
    let payload = match serde_json::to_string(msg) {
        Ok(v) => v,
        Err(err) => {
            log::error!("serialize msg err:{:?}", err);
            return;
        }
    };

    let sender = match client.sender.as_ref() {
        Some(v) => v,
        None => {
            log::error!("client sender is None");
            return;
        }
    };

    match sender.send(Message::text(payload)) {
        Ok(_) => {
            log::info!("send msg ok");
        }
        Err(err) => {
            log::error!("send msg err:{:?}", err.to_string());
        }
    }
}
 
 
 
pub async fn js_conf_handler(ip_port_str :String) ->Response{
    let ws_url = format!("http://{}/ws",ip_port_str);
    let stun = format!("{}",ip_port_str);
    let js_conf = JsConf{ ws_url: ws_url, stun: stun };
    let reply = warp::reply::json(&js_conf);
    
    return  reply.into_response();
}

// 根据前端传来的code生成二维码
pub async fn create_qrcode(ip_port_str :String,code:String)->Response{
    let code = code.trim().to_string();
    if code.is_empty() || code.len() > 128 {
        let reply = warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "error": "invalid code"
            })),
            StatusCode::BAD_REQUEST,
        );
        return reply.into_response();
    }

    let qr_code_data = format!("http://{}/?to={}", ip_port_str, code);
    let qr = match QrCode::new(qr_code_data.clone()) {
        Ok(code) => code,
        Err(err) => {
            log::error!("qrcode build failed: {:?}", err);
            let reply = warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "error": "qrcode build failed",
                    "url": qr_code_data
                })),
                StatusCode::INTERNAL_SERVER_ERROR,
            );
            return reply.into_response();
        }
    };

    let image = qr
        .render::<Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(300, 300)
        .build();
    let (width, height) = image.dimensions();
    let image_raw = image.into_raw();

    let mut png_bytes = Vec::new();
    if let Err(err) = PngEncoder::new(&mut png_bytes)
        .write_image(&image_raw, width, height, ColorType::L8.into())
    {
        log::error!("encode qrcode png failed: {:?}", err);
        let reply = warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "error": "encode qrcode png failed"
            })),
            StatusCode::INTERNAL_SERVER_ERROR,
        );
        return reply.into_response();
    }

    warp::reply::with_header(png_bytes, "content-type", "image/png").into_response()
}



