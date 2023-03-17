package websocket

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

func Test(t *testing.T){
	server := NewServer("http://localhost:3000")
	http.Handle("/ws", server.Handler())

	http.HandleFunc("/client.js", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./client.js")
	})

	static := http.FileServer(http.Dir("./test/"))
	http.Handle("/", static)

	LogErrors()

	server.Connect(func(client *Client){
		fmt.Println("connected:", client.ClientID)

		client.On("message", func(msg interface{}) {
			str := MsgType[string](msg)
			fmt.Println("client:", str)
		})

		client.Disconnect(func(code int) {
			fmt.Println("client disconnected:", client.ClientID, "-", code)
		})
	})

	handled := 0

	server.Connect(func(client *Client){
		fmt.Println("connected")
		handled++

		client.Store["key"] = "value"

		client.On("message", func(msg interface{}) {
			str := MsgType[string](msg)
			fmt.Println("client:", str)

			handled++
		})

		client.Disconnect(func(code int) {
			fmt.Println("client disconnected", code)
			handled++
		})

		server.Broadcast("message", "test")
		server.Broadcast("no-message", "test should not be sent")
	})

	server.On("message", func(client *Client, msg interface{}) {
		fmt.Println("server:", msg)

		fmt.Println("key:", client.Store["key"])
		if client.Store["key"] == "value" {
			handled++
		}

		handled++
	})

	server.Disconnect(func(client *Client, code int) {
		fmt.Println("server disconnected", code)
		handled++
	})

	go func(){
		err := http.ListenAndServe(":3000", nil)
		if err != nil {
			t.Error(err)
		}
	}()

	time.Sleep(5 * time.Second)

	if handled > 0 && handled < 6 {
		t.Error("test did not finish correctly")
	}

	if len(ErrLog) != 0 {
		for _, err := range ErrLog {
			t.Error(err)
		}
	}
}
