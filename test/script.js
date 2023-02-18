'use strict'

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
    socket.disconnect(1006);
  }, 3000);
})();
