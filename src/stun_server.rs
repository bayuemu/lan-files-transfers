 
use rustun::server::{BindingHandler, UdpServer};
 




pub fn start(port:u16){
    tokio::spawn(stun_init(port));
}

async fn stun_init(port:u16) {
    let addr = match format!("0.0.0.0:{}", port).parse(){
        Ok(a) => a,
        Err(err) => {
            log::error!("ipAddr parse err:{:?}",err);
            return 
        },
    };

    let server = fibers_global::execute(UdpServer::start(
        fibers_global::handle(),
        addr,
        BindingHandler
    ) )  ;

    match server {
        Ok(srv) => {
            match fibers_global::execute(srv){
                Ok(_) => {
                    log::info!("stun server stop!");
                },
                Err(err) => {
                    log::error!("stun srver err:{:?}",err);
                    return ;
                },
            }
        },
        Err(err) => {
            log::error!("stun srver err:{:?}",err);
            return ;
        },
    }
   // 
   
  
}