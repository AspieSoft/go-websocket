'use strict'

;(function(){
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/gh/nodeca/pako@1.0.11/dist/pako.min.js';
  (document.body || document.querySelector('body')[0]).appendChild(script)
})();

class ServerIO {
  constructor(setOrigin = null) {
    let origin;
    if(typeof setOrigin === 'string' && setOrigin.match(/^(http|ws)s?:\/\//)){
      origin = setOrigin.replace(/^http/, 'ws');
    }else{
      origin = window.location.origin.replace(/^http/, 'ws');
    }
    this.origin = origin;

    let socket = new WebSocket(origin + '/ws');
    this.socket = socket;
    this._sendingData = 0;

    this._data = undefined;
    this.autoReconnect = true;
    this._listeners = {};

    this.lastConnect = 0;
    this.lastDisconnect = 0;
    this.connected = false;

    const onConnect = (e) => {
      if(!e.target.url || !e.target.url.startsWith(origin)){
        return;
      }

      this.lastConnect = Date.now();
      this.connected = true;
    };

    const onDisconnect = (e) => {
      if(!e.target.url || !e.target.url.startsWith(origin)){
        return;
      }

      this.connected = false;

      let now = Date.now();
      if(now - this.lastDisconnect < 100){
        return;
      }
      this.lastDisconnect = now;

      this._data = undefined;
      if(this._listeners['@disconnect']){
        for(let i = 0; i < this._listeners['@disconnect'].length; i++){
          this._listeners['@disconnect'][i].call(this, e.code || 1000);
        }
      }

      //todo: fix wrong error code being sent on normal close
      if(this.autoReconnect && e.code !== 1000){
        console.log('reconnecting')
        this.connect();
      }
    };

    const onMessage = (e) => {
      if(e.origin !== origin){
        return;
      }

      let data = e.data;
      if(this._data && this._data.compress === 1){
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
        if(data.data === 'connect' && !this._data){
          setTimeout(() => {
            let compress = 0;
            if(typeof window.pako !== 'undefined'){
              compress = 1;
            }

            this._data = {
              clientID: data.clientID,
              token: data.token,
              serverKey: data.serverKey,
              compress: compress,
            };

            setTimeout(() => {
              this._socketSend(JSON.stringify({
                name: "@connection",
                data: "connect",
                token: data.token,
                compress: compress,
              }));
            }, 100);
          }, 500);
        }
      }else{
        if(data.token !== this._data.serverKey){
          return;
        }
        if(this._listeners[data.name]){
          for(let i = 0; i < this._listeners[data.name].length; i++){
            this._listeners[data.name][i].call(this, data.data);
          }
        }
      }
    };

    this._socketFuncs = {
      onConnect,
      onDisconnect,
      onMessage,
    };
    Object.freeze(this._socketFuncs);

    socket.addEventListener('open', onConnect, {passive: true});
    socket.addEventListener('close', onDisconnect, {passive: true});
    socket.addEventListener('error', onDisconnect, {passive: true});
    socket.addEventListener('message', onMessage, {passive: true});
  }

  async _socketSend(data){
    // fix for sending multiple strings at the same time causing overwriting data issues
    if(typeof data !== 'string'){
      return;
    }

    while(this._sendingData > 0){
      await new Promise(r => setTimeout(r, 100));
    }
    this._sendingData++;

    await new Promise(r => setTimeout(r, 10));
    if(this._sendingData > 1){
      this._sendingData--;
      this._socketSend(json);
      return;
    }

    this.socket.send(data);

    await new Promise(r => setTimeout(r, 100));
    this._sendingData--;
  }

  async connect(cb){
    setTimeout(async () => {
      // on connect
      if(typeof cb === 'function'){
        while(!this._data){
          await new Promise(r => setTimeout(r, 100));
        }

        cb.call(this);
        return;
      }

      if(this._data){
        return;
      }

      let now = Date.now();
      if(now - this.lastConnect < 10000){
        setTimeout(() => {
          this.connect();
        }, now - this.lastConnect);
        return;
      }

      this.lastConnect = now;

      // run reconnect
      this.socket = new WebSocket(this.origin + '/ws');
      this.socket.addEventListener('open', this._socketFuncs.onConnect, {passive: true});
      this.socket.addEventListener('close', this._socketFuncs.onDisconnect, {passive: true});
      this.socket.addEventListener('error', this._socketFuncs.onDisconnect, {passive: true});
      this.socket.addEventListener('message', this._socketFuncs.onMessage, {passive: true});

      while(!this._data){
        await new Promise(r => setTimeout(r, 100));
      }

      const listeners = Object.keys(this._listeners);
      for(let i = 0; i < listeners.length; i++){
        this._socketSend(JSON.stringify({
          name: "@listener",
          data: listeners[i],
          token: this._data.token,
        }));
      }
    }, 100);
  }

  async disconnect(cb){
    // on disconnect
    if(typeof cb === 'function'){
      if(!this._listeners['@disconnect']){
        this._listeners['@disconnect'] = [];
      }
      this._listeners['@disconnect'].push(cb);
      return;
    }

    while(!this._data){
      await new Promise(r => setTimeout(r, 100));
    }

    let code = 1000;
    if(typeof cb === 'number'){
      code = Number(cb);
    }
    if(code < 1000){
      code = 1000;
    }

    // run disconnect
    this._socketSend(JSON.stringify({
      name: "@connection",
      data: 'disconnect',
      token: this._data.token,
      code: code,
    }));

    setTimeout(() => {
      if(this.connected){
        this.socket.close(code);
      }
    }, 1000);
  }

  async on(name, cb){
    if(typeof name !== 'string' || typeof name.toString() !== 'string' || typeof cb !== 'function'){
      return;
    }
    name = name.toString().replace(/[^\w_-]+/g, '');
    if(name === ''){
      return;
    }

    if(!this._listeners[name]){
      this._listeners[name] = [];
    }
    this._listeners[name].push(cb);

    while(!this._data){
      await new Promise(r => setTimeout(r, 100));
    }

    this._socketSend(JSON.stringify({
      name: "@listener",
      data: name,
      token: this._data.token,
    }));
  }

  async send(name, msg){
    if(typeof name !== 'string' || typeof name.toString() !== 'string' || typeof msg === 'function' /* prevent functions */){
      return;
    }
    name = name.toString().replace(/[^\w_-]+/g, '');
    if(name === ''){
      return;
    }

    while(!this._data){
      await new Promise(r => setTimeout(r, 100));
    }

    let json = JSON.stringify({
      name: name,
      data: msg,
      token: this._data.token,
    });

    if(this._data.compress === 1){
      try {
        let enc = btoa(pako.gzip(json, {to: 'string'}));
        if(enc && enc !== ''){
          json = enc;
        }
      } catch(e) {}
    }

    this._socketSend(json);
  }
}

;(function(){
  let socket = new ServerIO();

  socket.connect(function(){
    console.log('connected');
  });

  socket.on('message', function(data){
    console.log('message received:', data);

    socket.send('message', 'message received');
  });

  socket.disconnect(function(code){
    console.log('socket disconnected', code);
  });

  setTimeout(function(){
    // socket.disconnect();
  }, 3000);
})();
