'use strict'

;(function(){
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/gh/nodeca/pako@1.0.11/dist/pako.min.js';
  (document.body || document.querySelector('body')[0]).appendChild(script)
})();

class ServerIO {
  constructor() {
    const origin = window.location.origin.replace(/^http/, 'ws');
    this.origin = origin;

    let socket = new WebSocket(window.location.origin.replace(/^http/, 'ws') + '/ws');
    this.socket = socket;

    this.data = undefined;
    this.listeners = {};

    socket.addEventListener('message', (e) => {
      if(e.origin !== origin){
        return;
      }

      let data = e.data;
      if(this.data && this.data.compress === 1){
        try {
          let dec = pako.ungzip(atob(data), {to: 'string'});
          if(dec && dec !== ''){
            data = dec;
          }
        } catch(e) {}
      }

      try {
        data = JSON.parse(data);
      } catch(e) {
        return;
      }

      if(data.name === '@connection'){
        if(!this.data){
          setTimeout(() => {
            let compress = 0;
            if(typeof window.pako !== 'undefined'){
              compress = 1;
            }

            this.data = {
              clientID: data.clientID,
              token: data.token,
              serverKey: data.serverKey,
              compress: compress,
            };
  
            setTimeout(function(){
              socket.send(JSON.stringify({
                name: "@connection",
                data: "connect",
                token: data.token,
                compress: compress,
              }));
            }, 100);
          }, 500);
        }
      }else{
        if(data.token !== this.data.serverKey){
          return;
        }
        if(typeof this.listeners[data.name] === 'function'){
          this.listeners[data.name].call(this, data.data);
        }
      }
    }, {passive: true});
  }

  async connect(cb){
    while(!this.data){
      await new Promise(r => setTimeout(r, 100));
    }

    setTimeout(function(){
      cb.call(this);
    }, 100)
  }

  async disconnect(cb){
    //todo: setup disconnect function
  }

  async on(name, cb){
    if(typeof name !== 'string' || typeof name.toString() !== 'string'){
      console.log('test err')
      return;
    }
    name = name.toString().replace(/[^\w_-]+/g, '');
    if(name === ''){
      return;
    }

    while(!this.data){
      await new Promise(r => setTimeout(r, 100));
    }

    this.listeners[name] = cb;

    this.socket.send(JSON.stringify({
      name: "@listener",
      data: name,
      token: this.data.token,
    }));
  }

  async send(name, msg){
    if(typeof name !== 'string' || typeof name.toString() !== 'string'){
      console.log('test err')
      return;
    }
    name = name.toString().replace(/[^\w_-]+/g, '');
    if(name === ''){
      return;
    }

    while(!this.data){
      await new Promise(r => setTimeout(r, 100));
    }

    let json = JSON.stringify({
      name: name,
      data: msg,
      token: this.data.token,
    });

    if(this.data.compress === 1){
      try {
        let enc = btoa(pako.gzip(json, {to: 'string'}));
        if(enc && enc !== ''){
          json = enc;
        }
      } catch(e) {}
    }

    this.socket.send(json);
  }
}

;(function(){
  let socket = new ServerIO();

  socket.connect(function(){
    console.log('connected')
  });

  socket.on('message', function(data){
    console.log('message received:', data)

    socket.send('message', 'message received');
  });
})();
