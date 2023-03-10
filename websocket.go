package websocket

import (
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"time"

	"github.com/AspieSoft/go-regex/v4"
	"github.com/AspieSoft/goutil/v4"
	"github.com/alphadose/haxmap"
	"golang.org/x/net/websocket"
)

type listener struct {
	name string
	cbClient *func(client *Client)
	cbMsg *func(msg interface{})
	cbClientMsg *func(client *Client, msg interface{})
	cbCode *func(code int)
	cbClientCode *func(client *Client, code int)
}

// Client of a websocket
type Client struct {
	ws *websocket.Conn
	ip string
	token string
	serverKey string
	encKey string
	ClientID string
	listeners []string
	serverListeners []listener
	close bool
	compress uint8
	connLost int64
	Store map[string]interface{}
}

// Server for a websocket
type Server struct {
	origin string
	clients *haxmap.Map[string, *Client]
	serverListeners []listener
	uuidSize int
}

type msgType interface {
	string | []byte | int | bool | map[string]interface{} | []interface{} | byte | int64 | int32 | float64 | float32 | [][]byte
}

// ErrLog contains a list of client errors which you can handle any way you would like
var ErrLog []error = []error{}

var logErr bool

func newErr(name string, err ...error){
	resErr := name

	// ErrLog = append(ErrLog, errors.New(name))
	for _, e := range err {
		// ErrLog = append(ErrLog, e)

		resErr += e.Error()
	}

	ErrLog = append(ErrLog, errors.New(resErr))
}

// LogErrors can be used if you would like client errors to be logged with fmt.Println
//
// By default, these errors will not be logged
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

// NewServer creates a new server
//
// @origin enforces a specific http/https host to be accepted, and rejects connections from other hosts
func NewServer(origin string, reconnectTimeout ...time.Duration) *Server {
	server := Server{
		origin: origin,
		clients: haxmap.New[string, *Client](),
		uuidSize: 16,
	}

	timeout := int64(30 * time.Second)
	if len(reconnectTimeout) != 0 {
		timeout = int64(reconnectTimeout[0])
	}

	go func(){
		time.Sleep(1 * time.Second)

		now := time.Now().UnixNano()
		server.clients.ForEach(func(clientID string, client *Client) bool {
			if client.close && now - client.connLost > timeout {
				server.clients.Del(clientID)
			}
			return true
		})
	}()

	return &server
}

func (s *Server) handleWS(ws *websocket.Conn){
	if addr := ws.RemoteAddr(); addr.Network() != "websocket" || addr.String() != s.origin {
		newErr("connection unexpected origin: '"+addr.Network()+"', '"+addr.String()+"'")
		return
	}

	clientID := s.clientUUID()
	token := string(goutil.RandBytes(32))
	serverKey := string(goutil.RandBytes(32))
	// encKey := string(goutil.RandBytes(64))
	encKey := string(goutil.RandBytes(32))

	client := Client{
		ws: ws,
		ip: ws.Request().RemoteAddr,
		ClientID: clientID,
		token: token,
		serverKey: serverKey,
		encKey: encKey,
		Store: map[string]interface{}{},
	}

	s.clients.Set(clientID, &client)

	json, err := goutil.StringifyJSON(map[string]interface{}{
		"name": "@connection",
		"data": "connect",
		"clientID": clientID,
		"token": token,
		"serverKey": serverKey,
		"encKey": encKey,
	})
	if err != nil {
		newErr("connection parse err:", err)
		return
	}
	ws.Write(json)

	s.readLoop(ws, &client)
}

func (s *Server) readLoop(ws *websocket.Conn, client *Client) {
	buf := make([]byte, 102400)
	for !client.close {
		b, err := ws.Read(buf)
		if err != nil {
			if err == io.EOF {
				if !client.close {
					for _, l := range s.serverListeners {
						go func(l listener){
							if l.name == "@disconnect" {
								cb := l.cbClientCode
								if cb != nil {
									time.Sleep(100 * time.Millisecond)
									(*cb)(client, 1006)
								}
							}
						}(l)
					}
	
					for _, l := range client.serverListeners {
						go func(l listener){
							if l.name == "@disconnect" {
								cb := l.cbCode
								if cb != nil {
									time.Sleep(100 * time.Millisecond)
									(*cb)(1006)
								}
							}
						}(l)
					}
				}

				client.connLost = time.Now().UnixNano()
				client.close = true
				// s.clients.Del(client.ClientID)
				break
			}

			if client.close {
				break
			}

			newErr("read err:", err)
			continue
		}

		msg := buf[:b]

		go func(){
			if dec, err := goutil.Decompress(goutil.CleanByte(msg)); err == nil {
				msg = dec
			}

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

			if name == "@connection" {
				if reflect.TypeOf(json["data"]) != goutil.VarType["string"] {
					newErr("read listener invalid data: not a valid string")
					return
				}
				data := json["data"].(string)

				if data == "connect" {
					client.compress = goutil.ToNumber[uint8](json["compress"])

					for _, l := range s.serverListeners {
						go func(l listener){
							if l.name == "@connect" {
								cb := l.cbClient
								if cb != nil {
									time.Sleep(100 * time.Millisecond)
									(*cb)(client)
								}
							}
						}(l)
					}
				}else if data == "disconnect" {
					code := goutil.ToNumber[int](json["code"])
					if code < 1000 {
						code += 1000
					}

					for _, l := range s.serverListeners {
						go func(l listener){
							if l.name == "@disconnect" {
								cb := l.cbClientCode
								if cb != nil {
									time.Sleep(100 * time.Millisecond)
									(*cb)(client, code)
								}
							}
						}(l)
					}

					for _, l := range client.serverListeners {
						go func(l listener){
							if l.name == "@disconnect" {
								cb := l.cbCode
								if cb != nil {
									time.Sleep(100 * time.Millisecond)
									(*cb)(code)
								}
							}
						}(l)
					}

					if code == 1000 {
						s.clients.Del(client.ClientID)
					}else{
						client.connLost = time.Now().UnixNano()
					}

					client.close = true
					ws.Close()
				}else if data == "migrate" {
					oldClientID := goutil.ToString[string](json["oldClient"])
					oldToken := goutil.ToString[string](json["oldToken"])
					oldServerKey := goutil.ToString[string](json["oldServerKey"])
					oldEncKey := goutil.ToString[string](json["oldEncKey"])

					if oldClient, ok := s.clients.Get(oldClientID); ok && oldClient.close && oldClient.token == oldToken && oldClient.serverKey == oldServerKey && oldClient.encKey == oldEncKey && oldClient.ip == client.ip {
						// migrate old client data to new client
						for _, l := range oldClient.listeners {
							client.listeners = append(client.listeners, l)
						}

						for _, sl := range oldClient.serverListeners {
							client.serverListeners = append(client.serverListeners, sl)
						}

						for k, s := range oldClient.Store {
							if client.Store[k] == nil {
								client.Store[k] = s
							}
						}
					}else{
						client.sendCore("@error", "migrate")
					}
				}
			}else if name == "@listener" {
				if reflect.TypeOf(json["data"]) != goutil.VarType["string"] {
					newErr("read listener invalid data: not a valid string")
					return
				}
				data := json["data"].(string)

				go func(){
					if strings.HasPrefix(data, "!") {
						data = data[1:]
						for i := 0; i < len(client.listeners); i++ {
							if client.listeners[i] == data {
								client.listeners = append(client.listeners[:i], client.listeners[i+1:]...)
								break
							}
						}
					}else if !goutil.Contains(client.listeners, data) {
						client.listeners = append(client.listeners, data)
					}
				}()
			}else{
				for _, l := range s.serverListeners {
					go func(l listener){
						if l.name == name {
							cb := l.cbClientMsg
							if cb != nil {
								(*cb)((client), json["data"])
							}
						}
					}(l)
				}

				for _, l := range client.serverListeners {
					go func(l listener){
						if l.name == name {
							cb := l.cbMsg
							if cb != nil {
								(*cb)(json["data"])
							}
						}
					}(l)
				}
			}
		}()
	}

	// s.clients.Del(client.ClientID)
}

// Handler should be passed into your http handler
//
// http.Handle("/ws", server.Handler())
func (s *Server) Handler() websocket.Handler {
	return websocket.Handler(s.handleWS)
}

// Broadcast sends a message to every client
func (s *Server) Broadcast(name string, msg interface{}) {
	s.clients.ForEach(func(token string, client *Client) bool {
		go client.Send(name, msg)
		return true
	})
}

// Send sends a message to a specific client
func (s *Server) Send(clientID string, name string, msg interface{}){
	if client, ok := s.clients.Get(clientID); ok {
		client.Send(name, msg)
	}
}

// Send sends a message to the client
func (c *Client) Send(name string, msg interface{}){
	if c.close {
		return
	}

	name = string(regex.Comp(`[^\w_-]+`).RepStr([]byte(name), []byte{}))

	if !goutil.Contains(c.listeners, name) {
		return
	}

	//todo: encrypt stringified json msg
	/* b, err := goutil.StringifyJSON(msg)
	if err != nil {
		newErr("write parse err:", err)
		return
	} */
	
	// keyHash := sha256.Sum256([]byte(c.encKey))
	// fmt.Println(string(keyHash[:]))

	json, err := goutil.StringifyJSON(map[string]interface{}{
		"name": name,
		"data": msg,
		"token": c.serverKey,
	})
	if err != nil {
		newErr("write parse err:", err)
		return
	}

	if c.compress == 1 {
		if enc, err := goutil.Compress(json); err == nil {
			json = enc
		}
	}

	c.ws.Write(json)
}

// Send sends a message to the client
//
// This method allows sending @name listeners
func (c *Client) sendCore(name string, msg interface{}){
	if c.close {
		return
	}

	json, err := goutil.StringifyJSON(map[string]interface{}{
		"name": name,
		"data": msg,
		"token": c.serverKey,
	})
	if err != nil {
		newErr("write parse err:", err)
	}

	if c.compress == 1 {
		if enc, err := goutil.Compress(json); err == nil {
			json = enc
		}
	}

	c.ws.Write(json)
}

// Connect runs your callback when a new client connects to the websocket
func (s *Server) Connect(cb func(client *Client)){
	s.serverListeners = append(s.serverListeners, listener{
		name: "@connect",
		cbClient: &cb,
	})
}

// On runs your callback when any client a message of the same name
func (s *Server) On(name string, cb func(client *Client, msg interface{})){
	name = string(regex.Comp(`[^\w_-]+`).RepStr([]byte(name), []byte{}))

	s.serverListeners = append(s.serverListeners, listener{
		name: name,
		cbClientMsg: &cb,
	})
}

// On runs your callback when the client sends a message of the same name
func (c *Client) On(name string, cb func(msg interface{})){
	name = string(regex.Comp(`[^\w_-]+`).RepStr([]byte(name), []byte{}))

	c.serverListeners = append(c.serverListeners, listener{
		name: name,
		cbMsg: &cb,
	})
}

// Disconnect runs your callback when any client disconnects from the websocket
func (s *Server) Disconnect(cb func(client *Client, code int)){
	s.serverListeners = append(s.serverListeners, listener{
		name: "@disconnect",
		cbClientCode: &cb,
	})
}

// Disconnect runs your callback when the client disconnects from the websocket
func (c *Client) Disconnect(cb func(code int)){
	c.serverListeners = append(c.serverListeners, listener{
		name: "@disconnect",
		cbCode: &cb,
	})
}

// Exit will force a specific client to disconnect from the websocket
func (s *Server) Kick(clientID string, code int){
	if client, ok := s.clients.Get(clientID); ok {
		client.Kick(code)
	}
}

// ExitAll will force every client to disconnect from the websocket
func (s *Server) KickAll(code int){
	s.clients.ForEach(func(token string, client *Client) bool {
		go client.Kick(code)
		return true
	})
}

// ExitAll will force the client to disconnect from the websocket
func (c *Client) Kick(code int){
	c.close = true
	if code < 1000 {
		code += 1000
	}
	c.ws.WriteClose(code)
}

// MsgToType attempts to converts an msg interface from the many possible json outputs, to a specific type of your choice
//
// if it fails to convert, it will return a nil/zero value for the appropriate type
//
// recommended: add .(string|[]byte|int|etc) to the end of the function to get that type output in place of interface{}
func MsgType[T goutil.SupportedType] (msg interface{}) interface{} {
	return goutil.ToType[T](msg)
}

func (s *Server) clientUUID() string {
	uuid := goutil.RandBytes(s.uuidSize)

	var hasID bool
	_, hasID = s.clients.Get(string(uuid))

	loops := 1000
	for hasID && loops > 0 {
		loops--
		uuid = goutil.RandBytes(s.uuidSize)
		_, hasID = s.clients.Get(string(uuid))
	}

	if hasID {
		s.uuidSize++
		return s.clientUUID()
	}

	return string(uuid)
}
