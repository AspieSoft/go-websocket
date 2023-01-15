package websocket

import (
	"errors"
	"fmt"
	"io"
	"reflect"
	"time"

	"github.com/AspieSoft/goutil/v3"
	"github.com/alphadose/haxmap"
	"golang.org/x/net/websocket"
)

type Client struct {
	ws *websocket.Conn
	ip string
	token string
	serverKey string
	clientID string
	listeners []string
	close bool
}

type Server struct {
	origin string
	clients *haxmap.Map[string, *Client]
}

var ErrLog []error = []error{}

func newErr(name string, err ...error){
	ErrLog = append(ErrLog, errors.New(name))
	for _, e := range err {
		ErrLog = append(ErrLog, e)
	}
}

var logErr bool
func LogErrors(){
	if logErr {
		return
	}
	logErr = true

	go func(){
		for {
			for len(ErrLog) != 0 {
				err := ErrLog[0]
				ErrLog = ErrLog[1:]
				fmt.Println(err)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

func NewServer(origin string) *Server {
	server := Server{
		origin: origin,
		clients: haxmap.New[string, *Client](),
	}

	return &server
}

func (s *Server) handleWS(ws *websocket.Conn){
	if addr := ws.RemoteAddr(); addr.Network() != "websocket" || addr.String() != s.origin {
		newErr("connection unexpected origin: '"+addr.Network()+"', '"+addr.String()+"'")
		return
	}

	clientID := string(goutil.RandBytes(16))
	token := string(goutil.RandBytes(64))
	serverKey := string(goutil.RandBytes(32))

	client := Client{
		ws: ws,
		ip: ws.Request().RemoteAddr,
		clientID: clientID,
		token: token,
		serverKey: serverKey,
	}

	s.clients.Set(clientID, &client)

	json, err := goutil.StringifyJSON(map[string]interface{}{
		"name": "@connection",
		"clientID": clientID,
		"token": token,
		"serverKey": serverKey,
	})
	if err != nil {
		newErr("connection parse err:", err)
		return
	}
	ws.Write(json)

	s.readLoop(ws, &client)
}

func (s *Server) readLoop(ws *websocket.Conn, client *Client) {
	buf := make([]byte, 1024)
	for {
		if client.close {
			break
		}

		b, err := ws.Read(buf)
		if err != nil {
			if err == io.EOF {
				break
			}
			newErr("read err:", err)
			continue
		}

		msg := buf[:b]

		go func(){
			json, err := goutil.ParseJson(goutil.CleanByte(msg))
			if err != nil {
				newErr("read parse err:", err)
				return
			}

			if reflect.TypeOf(json["token"]) != goutil.VarType["string"] {
				newErr("read invalid token: not a valid string")
				return
			}else if json["token"].(string) != client.token {
				newErr("read invalid token: '"+json["token"].(string)+"' != '"+client.token+"'")
				return
			}

			if reflect.TypeOf(json["name"]) != goutil.VarType["string"] {
				newErr("read invalid name: not a valid string")
				return
			}
			name := json["name"].(string)

			if name == "@listener" {
				if reflect.TypeOf(json["data"]) != goutil.VarType["string"] {
					newErr("read listener invalid data: not a valid string")
					return
				}
				data := json["data"].(string)

				//todo: add listener
				fmt.Println(data)
			}
			//todo: handle other message types

			// fmt.Println("json:", json)
		}()

		// fmt.Println(string(msg))

		// s.broadcast("broadcast", []byte("msg received"))

		// ws.Write([]byte("msg received"))
	}
}

func (s *Server) broadcast(name string, msg interface{}) {
	s.clients.ForEach(func(token string, client *Client) bool {
		go client.Send(name, msg)
		return true
	})
}

func (s *Server) Handler() websocket.Handler {
	return websocket.Handler(s.handleWS)
}

func (c *Client) Send(name string, msg interface{}){
	json, err := goutil.StringifyJSON(map[string]interface{}{
		"name": name,
		"data": msg,
		"token": c.serverKey,
	})
	if err != nil {
		newErr("write parse err:", err)
	}

	c.ws.Write(json)
}
