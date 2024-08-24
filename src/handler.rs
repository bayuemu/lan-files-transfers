use std::collections::HashMap;

 
use futures_util::{SinkExt, StreamExt};
 
use tokio::sync::mpsc;
use warp::{filters::ws::WebSocket,   reject::Rejection, reply::Reply};
use warp::{self, reply::Response};
use warp::ws::Message;

use crate::entity::{Client, ClistMsg, ConnectMsg, JsConf};
use crate::Clients; 


  

pub async fn ws_handler(ws: warp::ws::Ws,map:HashMap<String, String>,clients :Clients) -> Result<impl Reply,Rejection>{
  
    let name = map.get("id").unwrap();
    let name = name.to_string();
    
    match clients.read().await.get(name.clone().as_str()){
        Some(_) => Err(warp::reject::not_found()),
        None => {
            
            let clients_ = clients.clone();
            let c = ws.on_upgrade(move|socket|{
                  client_handler(socket,clients_,name)
            });
             
            return Ok(c);
        },
    }

    
}

 

pub async fn client_handler(socket: WebSocket,clients :Clients,name:String){
 
    let (mut client_ws_sender, mut client_ws_rcv) = socket.split();

    let (tx, mut rx) = mpsc::unbounded_channel();
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

    let client = Client{name:name.clone(),sender:Some(tx)};
    clients.write().await.insert(name.clone(), client);

    

    while let Some(res_msg) = client_ws_rcv.next().await{
           let clients_u = clients.clone();
            match res_msg{
                Ok(msg) => {
                
                if msg.is_text(){
                        log::info!("Receive Text Msg From  Client Id:{:?}",msg);
                        do_text_msg(msg,clients_u,name.clone()).await;
                    }
                    
                },
                Err(err) => {
                    log::error!("Receive Msg From  Client Id:{}, Err:{:?}",name.clone(),err);
                },
            }
    }
    
    clients.write().await.remove(&name);
    log::error!("Client ID:{} Disconnected", name);
    send_client_list(clients.clone()).await;
    
}

async fn do_text_msg(msg:Message,clients :Clients,name:String){
    match serde_json::from_slice::<ClistMsg>(msg.as_bytes()){
        Ok(s) => {
              match s.tpye.as_str(){
                 "list" =>{
                    log::info!("list text msg:{:?} ",s);
                     send_client_list(clients.clone()).await;
                 },
                 "connect" =>{
                    log::info!("connect text msg:{:?} ",s);
                    connect_text_action(s.content,clients.clone()).await;
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
        },
       }
}

async fn action_text_action(content:serde_json::Value,clients :Clients,action:String){
    
    match serde_json::from_value::<ConnectMsg>(content.clone()){
        Ok(obj) => {
         
            let to = obj.to;
            match clients.read().await.get(&to){
                Some(c) => {
                    let m = ClistMsg{tpye:action,content:content};
                    match c.sender.as_ref().unwrap().send(Message::text(serde_json::to_string(&m).unwrap())){
                       Ok(_) => {
                        log::info!("send msg ok");
                       },
                       Err(err) => {
                        log::error!("send msg err:{:?} ",err.to_string());
                       },
                   }
                },
                None => {
                    log::error!("connect send text msg:{:?} ","err"); 
                },
            }
        },
        Err(err) => {
            log::error!("connect err:{:?}",err);
        },
    }
}

async fn connect_text_action(content:serde_json::Value,clients :Clients){
    
    match serde_json::from_value::<ConnectMsg>(content.clone()){
        Ok(obj) => {
            
            let to = obj.to;
            match clients.read().await.get(&to){
                Some(c) => {
                    let m = ClistMsg{tpye:"connect".to_string(),content:content};
                    match c.sender.as_ref().unwrap().send(Message::text(serde_json::to_string(&m).unwrap())){
                       Ok(_) => {
                        log::info!("send msg ok");
                       },
                       Err(err) => {
                        log::error!("send msg err:{:?} ",err.to_string());
                       },
                   }
                },
                None => {
                    log::error!("connect send text msg:{:?} ","err"); 
                },
            }
        },
        Err(err) => {
            log::error!("connect err:{:?}",err);
        },
    }
}
 
 async fn send_client_list(clients :Clients){
    let map = clients.read().await;
    let list:Vec<String> = map.clone().into_keys().collect();

    map.clone().into_values().for_each(|c|{
       let m = ClistMsg{tpye:"list".to_string(),content:serde_json::to_value(list.clone()).unwrap()};
       match c.sender.as_ref().unwrap().send(Message::text(serde_json::to_string(&m).unwrap())){
          Ok(_) => {
            log::info!("Send Client List Ok!");
          },
          Err(err) => {
            log::error!("Send Client List Msg Err:{:?} ",err.to_string());
          },
      }
    });
 }
 
 
 
pub async fn js_conf_handler(port :u16) ->Response{
    let ip = local_ip_address::local_ip().unwrap();
    let ws_url = format!("http://{}:{}/ws",ip,port);
    let stun = format!("{}:{}",ip,port);
    let js_conf = JsConf{ ws_url: ws_url, stun: stun };
    let reply = warp::reply::json(&js_conf);
    
    return  reply.into_response();
}



