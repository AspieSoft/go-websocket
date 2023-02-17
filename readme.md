# Go WebSocket

[![donation link](https://img.shields.io/badge/buy%20me%20a%20coffee-paypal-blue)](https://paypal.me/shaynejrtaylor?country.x=US&locale.x=en_US)

An easy way to get started with websockets in golang.

## Installation

### Go (server)

```shell script

  go get github.com/AspieSoft/go-websocket

```

### JavaScript (client)

```html
<script src="https://cdn.jsdelivr.net/gh/AspieSoft/go-websocket@1.1.0/client.min.js" defer></script>
```

## Usage

### Go (server)

```go

import (
  "net/http"

  "github.com/AspieSoft/go-websocket"
)

func main(){
  server := websocket.NewServer("https://www.example.com")
  http.Handle("/ws", server.Handler())

  static := http.FileServer(http.Dir("./public/"))
  http.Handle("/", static)

  server.Connect(func(client *Client){
    // client connected

    server.Broadcast("notify", "a new user connected to the server")
    server.Broadcast("user", client.ClientID)

    client.On("message", func(msg interface{}) {
      // client sent a message

      // optional: enforce a specific message type
      str := websocket.MsgType[string](msg).(string)
      b := websocket.MsgType[[]byte](msg).([]byte)
      i := websocket.MsgType[int](msg).(int)
      bool := websocket.MsgType[bool](msg).(bool)
      json := websocket.MsgType[map[string]interface{}](msg).(map[string]interface{})
      array := websocket.MsgType[[]interface{}](msg).([]interface{})
    })

    // send data to client
    client.Send("message", "my message to the client")

    client.Send("json", map[string]interface{}{
      "jsondata": "my json data",
      "key": "value",
      "a": 1,
    })

    client.on("send-to-friend", func(msg interface{}){
      json := websocket.MsgType[map[string]interface{}](msg).(map[string]interface{})

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

  server.On("kick", func(client *Client, msg interface{}) {
    friendsClientID := websocket.MsgType[string](msg).(string)

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

socket.connect(function(){
  // connected to server

  socket.send('message', "my message to the server");
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

socket.disconnect(function(){
  // on disconnect
});

```
