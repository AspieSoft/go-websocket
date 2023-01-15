'use strict'

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

      let data = undefined;
      try {
        data = JSON.parse(e.data);
      } catch(e) {}
      if(data === undefined){
        return;
      }

      if(data.name === '@connection'){
        this.data = {
          clientID: data.clientID,
          token: data.token,
          serverKey: data.serverKey,
        };
      }
    }, {passive: true});
  }

  async connect(cb){
    while(!this.data){
      await new Promise(r => setTimeout(r, 100));
    }

    cb.call(this);
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
}

;(function(){
  let socket = new ServerIO();

  socket.connect(function(){
    console.log('connected')
  });

  socket.on('message', function(data){
    console.log('test was sent:', data)
  });

  /* 'use strict'

  let socket = new WebSocket(window.location.origin.replace(/^http/, 'ws') + '/ws');

  socket.addEventListener('message', function(e) {


    console.log(e.origin, e.source, e.ports)
    console.log('received message:', e.data);
  });
  
  setTimeout(function(){
    // socket.send('hello from client');
  }, 100); */
})();
