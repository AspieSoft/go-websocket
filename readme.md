# Go WebSocket

[![donation link](https://img.shields.io/badge/buy%20me%20a%20coffee-paypal-blue)](https://paypal.me/shaynejrtaylor?country.x=US&locale.x=en_US)

An easy way to get started with websockets in golang.

This module tracks user sessions, can recover temporarily lost connections, and compresses data through gzip if supported by the client.

## Installation

### Go (server)

```shell script
go get github.com/AspieSoft/go-websocket
```

### JavaScript (client)

```html
<script src="https://cdn.jsdelivr.net/gh/AspieSoft/go-websocket@1.4.8/client.min.js" defer></script>
```

## Usage

### Go (server)

```go

import (
  "net/http"

  "github.com/AspieSoft/go-websocket"
)

func main(){
  // setup a new websocket server
  server := websocket.NewServer("https://www.example.com")
  http.Handle("/ws", server.Handler())

  // optional: set a timeout for when disconnected clients can no longer reconnect with the same data
  server := websocket.NewServer("https://www.example.com", 30 * time.Second)

  // by default, data is compressed with gzip before being send between the server and client
  // this behavior can opptonally be disabled
  server.Gzip = false

  // by default, the server only reads requests up to 1 megabyte
  // this value can opptionally be changed
  server.ReqSize = 1024 // KB


  static := http.FileServer(http.Dir("./public/"))
  http.Handle("/", static)

  server.Connect(func(client *websocket.Client){
    // client connected

    // localstorage that stays with the client, and verifies their session
    // map[string]interface{}
    client.Store["key"] = "value"

    server.Broadcast("notify", "a new user connected to the server")
    server.Broadcast("user", client.ClientID)

    client.On("message", func(msg interface{}) {
      // client sent a message

      // optional: enforce a specific message type
      str := websocket.ToType[string](msg)
      b := websocket.ToType[[]byte](msg)
      i := websocket.ToType[int](msg)
      bool := websocket.ToType[bool](msg)
      json := websocket.ToType[map[string]interface{}](msg)
      array := websocket.ToType[[]interface{}](msg)
    })

    // send data to client
    client.Send("message", "my message to the client")

    client.Send("json", map[string]interface{}{
      "jsondata": "my json data",
      "key": "value",
      "a": 1,
    })

    client.on("send-to-friend", func(msg interface{}){
      json := websocket.ToType[map[string]interface{}](msg)

      // send a message to a different client
      server.send(json["friendsClientID"], json["msg"])

      // do other stuff...
      client.send("send-from-friend", map[string]interface{
        "ClientID": client.ClientID,
        "msg": "General Kenobi!",
      })
    })

    client.Disconnect(func(code int) {
      // when client disconnects
      server.Broadcast("disconnected", client.ClientID)
    })
  })

  server.On("kick", func(client *websocket.Client, msg interface{}) {
    friendsClientID := websocket.ToType[string](msg)

    // force a client to leave the server
    server.Kick(friendsClientID, 1000)

    server.Broadcast("kicked", friendsClientID+" was kicked by "+client.ClientID)
  })

  server.On("kick-all", func(client *Client, msg interface{}) {
    // kick every client from the server
    server.KickAll()
  })

  log.Fatal(http.ListenAndServe(":3000", nil))
}

```

### JavaScript (client)

```JavaScript

const socket = new ServerIO(); // will default to current origin
// or
const socket = new ServerIO('https://www.example.com'); // optional: specify a different origin

socket.connect(function(initial){
  // connected to server

  socket.send('message', "my message to the server");

  if(initial){
    // very first time connecting to the server
  }else{
    // reconnecting after a previous disconnect
  }
});

socket.on('message', function(msg){
  console.log('I got a new message:', msg);

  socket.send('json', {
    jsondata: 'my json data',
    key: 'value',
    a: 1,
  });
});

socket.on('json', function(msg){
  console.log('pre-parsed json:', msg.jsondata);
});

socket.on('notify', function(msg){
  console.log(msg);
});

let myNewFriend = null;
socket.on('user', function(msg){
  myNewFriend = msg;

  socket.send('send-to-friend', {
    friendsClientID: myNewFriend,
    msg: 'Hello, There!',
  })
});

socket.on('send-from-friend', function(msg){
  socket.send('kick', myNewFriend);
});

socket.on('kicked', function(msg){
  socket.send('kick-all');

  // run disconnect
  socket.disconnect();

  // run reconnect
  socket.connect();
});

socket.disconnect(function(status){
  // on disconnect
  if(status === 1000){
    console.log('disconnected successfully');
  }else if(status === 1006){
    console.warn('error: disconnected by accident, auto reconnecting...');
  }else{
    console.error('error:', status);
  }
});


socket.on('notifications', function(){
  console.log('my notification');
})

// stop listining to a message, and remove all client listeners of that type
socket.off('notifications');

// stop the server from sending messages, but keep the listener on the client
socket.off('notifications', false);

// request the server to send messages again
socket.on('notifications');


socket.error(function(type){
  // handle errors
  // Note: disconnection errors will Not trigger this method

  if(type === 'migrate'){
    // the client reconnected to the server, but the server failed to migrate the clients old data to the new connection
    // client listeners should still automatically be restored
  }
});

```
