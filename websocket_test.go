package websocket

import (
	"fmt"
	"log"
	"net/http"
	"testing"
	"time"
)

func Test(t *testing.T){
	server := NewServer("http://localhost:3000")
	http.Handle("/ws", server.Handler())

	static := http.FileServer(http.Dir("./test/"))
	http.Handle("/", static)

	LogErrors()

	/* server.On("message", func(client *Client) {

	}) */

	server.Connect(func(client *Client){
		fmt.Println("connected")

		client.On("message", func(msg interface{}) {
			str := MsgType[string](msg).(string)
			fmt.Println("client:", str)
		})

		server.Broadcast("message", "test")
		server.Broadcast("no-message", "test should not be sent")
	})

	server.On("message", func(client *Client, msg interface{}) {
		fmt.Println("server:", msg)
	})

	go func(){
		time.Sleep(3 * time.Second)

		// server.Broadcast("message", "test")
		// server.Broadcast("no-message", "test should not be sent")
	}()

	log.Fatal(http.ListenAndServe(":3000", nil))
}
