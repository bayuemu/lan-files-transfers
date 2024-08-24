 
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use warp::filters::ws::Message;
 
use figment::{Figment, providers::{Format, Json}};

#[derive(Deserialize,Serialize,PartialEq)]
pub struct AppConf{
    #[serde(rename="webStunPort")]
    pub web_stun_port:u16,
    #[serde(rename="logLevel")]
    pub log_level:String,
}

impl Default for AppConf {
    fn default() -> Self {
        Self { web_stun_port: 12345,log_level:String::from("warn") }
    }
}

impl AppConf {
    pub fn parse()->Self{
        let args = std::env::args().collect::<Vec<String>>();
         
        let cmd_path = std::path::Path::new(&args[0]);
        let parent_path = std::path::absolute(cmd_path);
        let parent_path = parent_path.as_ref().unwrap().parent().unwrap();
         

        let figment = Figment::new()
        .merge(Json::file(parent_path.join("appConf.json")));

        match figment.extract::<AppConf>(){
            Ok(appconf) => appconf,
            Err(err) => {
                log::error!("parse appConf.json err:{:?},App user default config value!",err);
                AppConf::default()
            },
        }

         
    }
}


#[derive(Debug,Deserialize,Serialize)]
pub struct ClistMsg{
  #[serde(rename="type")]
  pub tpye :String,
  pub content:serde_json::Value,
}

#[derive(Debug,Deserialize,Serialize)]
pub struct ConnectMsg{
  pub from :String,
  pub to:String,
}

 

#[derive(Debug,Clone)]
pub struct Client{
    pub name:String,
    pub sender: Option<mpsc::UnboundedSender<Message>>,
}

#[derive(Debug,Deserialize,Serialize)]
pub struct JsConf{
  #[serde(rename="wsUrl")]  
  pub ws_url :String,
  pub stun:String,
}
  
 
 



