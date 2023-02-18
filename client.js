'use strict'

;(function(){
  const body = (document.body || document.querySelector('body')[0]);

  let nonceKey = undefined;
  const nonceKeyElm = document.querySelector('script[nonce]');
  if(nonceKeyElm){
    nonceKey = nonceKeyElm.getAttribute('nonce');
  }

  function addScript(url){
    const script = document.createElement('script');
    script.src = url;
    if(nonceKey){
      script.setAttribute('nonce', nonceKey);
    }
    body.appendChild(script)
  }

  // add script dependencies
  addScript('https://cdn.jsdelivr.net/gh/nodeca/pako@1.0.11/dist/pako.min.js');
  addScript('https://cdn.jsdelivr.net/npm/crypto-js@4.1.1/crypto-js.min.js');
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
    this._currentListeners = [];

    this.lastConnect = 0;
    this.lastDisconnect = 0;
    this.connected = false;
    this._disconnectCode = undefined;

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

      this._oldData = this._data;
      this._data = undefined;

      let code = e.code || this._disconnectCode || 1000;
      if(this._disconnectCode && code === 1000){
        code = this._disconnectCode;
      }
      this._disconnectCode = undefined;

      if(this._listeners['@disconnect']){
        for(let i = 0; i < this._listeners['@disconnect'].length; i++){
          this._listeners['@disconnect'][i].call(this, code);
        }
      }

      if(this.autoReconnect && [1006, 1009, 1011, 1012, 1013, 1014, 1015].includes(code)){
        console.log('reconnecting')
        this.connect('@retry');
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
              encKey: data.encKey,
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

        if(data.name === '@error'){
          if(this._listeners['@error']){
            for(let i = 0; i < this._listeners['@error'].length; i++){
              this._listeners['@error'][i].call(this, data.data);
            }
          }

          if(data.data === 'migrate'){
            for(let i = 0; i < this._currentListeners.length; i++){
              if(!this._currentListeners[i].startsWith('@')){
                this.on(this._currentListeners[i]);
              }
            }
          }
          return;
        }

        //todo: decrypt data.data
        /* let enc = CryptoJS.AES.encrypt('test', 'key123').toString();
        let bytes  = CryptoJS.AES.decrypt(enc, 'key123');
        let originalText = bytes.toString(CryptoJS.enc.Utf8);
        console.log(enc, originalText) */

        /* let base64data = CryptoJS.enc.Base64.parse(data.data);
        let enc = new CryptoJS.lib.WordArray.init(base64data.words.slice(4), base64data.sigBytes - 16);
        let iv = new CryptoJS.lib.WordArray.init(base64data.words.slice(0, 4));
        let cipher = CryptoJS.lib.CipherParams.create({ ciphertext: enc });

        let resData = CryptoJS.AES.decrypt(cipher, this._data.encKey, {iv: iv, mode: CryptoJS.mode.CFB});
        console.log(resData.toString(CryptoJS.enc.Utf8)) */

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

        if(!this._listeners['@connect']){
          this._listeners['@connect'] = [];
        }
        this._listeners['@connect'].push(cb);

        // @args: 'initial connection' -> bool
        cb.call(this, true);
        return;
      }

      if(this._data){
        return;
      }

      let now = Date.now();
      if(now - this.lastConnect < 10000){
        setTimeout(() => {
          this.connect(cb);
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

      if(cb === '@retry' && this._oldData){
        this._socketSend(JSON.stringify({
          name: "@connection",
          data: 'migrate',
          token: this._data.token,
          oldClient: this._oldData.clientID,
          oldToken: this._oldData.token,
          oldServerKey: this._oldData.serverKey,
          oldEncKey: this._oldData.encKey,
        }));
        this._oldData = undefined;
      }

      if(this._listeners['@connect']){
        for(let i = 0; i < this._listeners['@connect'].length; i++){
          this._listeners['@connect'][i].call(this, false);
        }
      }
    }, 100);

    return this;
  }

  async disconnect(cb){
    // on disconnect
    if(typeof cb === 'function'){
      if(!this._listeners['@disconnect']){
        this._listeners['@disconnect'] = [];
      }
      this._listeners['@disconnect'].push(cb);
      return this;
    }

    while(!this._data){
      await new Promise(r => setTimeout(r, 100));
    }

    let code = 1000;
    if(typeof cb === 'number'){
      code = Number(cb);
    }
    if(code < 1000){
      code += 1000;
    }

    this._disconnectCode = code;

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

    return this;
  }

  async on(name, cb){
    if(typeof name !== 'string' || typeof name.toString() !== 'string'){
      return this;
    }
    name = name.toString().replace(/[^\w_-]+/g, '');
    if(name === ''){
      return this;
    }

    if(!this._listeners[name]){
      this._listeners[name] = [];
    }

    if(!this._currentListeners.includes(name)){
      this._currentListeners.push(name);
    }

    if(typeof cb === 'function'){
      this._listeners[name].push(cb);
    }

    while(!this._data){
      await new Promise(r => setTimeout(r, 100));
    }

    this._socketSend(JSON.stringify({
      name: "@listener",
      data: name,
      token: this._data.token,
    }));

    return this;
  }

  async off(name, delCB = true){
    if(typeof name !== 'string' || typeof name.toString() !== 'string'){
      return this;
    }
    name = name.toString().replace(/[^\w_-]+/g, '');
    if(name === ''){
      return this;
    }

    if(this._listeners[name] && delCB){
      delete this._listeners[name];
    }

    let ind = this._currentListeners.indexOf(name);
    if(ind !== -1){
      this._currentListeners.splice(ind, 1);
    }

    while(!this._data){
      await new Promise(r => setTimeout(r, 100));
    }

    this._socketSend(JSON.stringify({
      name: "@listener",
      data: '!'+name,
      token: this._data.token,
    }));

    return this;
  }

  async send(name, msg){
    if(typeof name !== 'string' || typeof name.toString() !== 'string' || typeof msg === 'function' /* prevent functions */){
      return this;
    }
    name = name.toString().replace(/[^\w_-]+/g, '');
    if(name === ''){
      return this;
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

    return this;
  }

  async error(cb){
    if(typeof cb === 'function'){
      if(!this._listeners['@error']){
        this._listeners['@error'] = [];
      }
      this._listeners['@error'].push(cb);
    }

    return this;
  }
}
