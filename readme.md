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

  <script src="https://cdn.jsdelivr.net/gh/AspieSoft/go-websocket@1.0.0/client.min.js" defer></script>

```

## Usage

### Go (server)

```go

import (
  "net/http"

  "github.com/AspieSoft/go-websocket"
)

func main(){
  server := websocket.NewServer("http://localhost:3000")
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
    client.Send("message", "my message")

    client.Send("json", map[string]interface{}{
      "jsondata": "my json data"
    })

    client.on("send-to-friend", func(msg interface{}){
      json := websocket.MsgType[map[string]interface{}](msg).(map[string]interface{})

      // send a message to a different client
      server.send(json["friendsClientID"], json["msg"])
    })

    client.Disconnect(func(code int) {
      // when client disconnects
      server.Broadcast("disconnected", client.ClientID)
	  })
  })

  server.On("kick", func(client *Client, msg interface{}) {
		friendsClientID := websocket.MsgType[string](msg).(string)

    // force a client to leave the server
    server.Exit(friendsClientID, 1000)

    server.Broadcast("kicked", friendsClientID+" was kicked by "+client.ClientID)
	})

  server.On("kick-all", func(client *Client, msg interface{}) {
    // kick every client from the server
    server.ExitAll()
  })

  log.Fatal(http.ListenAndServe(":3000", nil))
}

```
