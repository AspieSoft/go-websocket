package websocket

import (
	"log"
	"net/http"
	"testing"
)

func Test(t *testing.T){
	server := NewServer("http://localhost:3000")
	http.Handle("/ws", server.Handler())

	static := http.FileServer(http.Dir("./test/"))
	http.Handle("/", static)

	LogErrors()

	log.Fatal(http.ListenAndServe(":3000", nil))
}
