/*
 * listen on a port
 */

var net = require('net');
var fs = require('fs');

function makeDataReceiverListener(fifoPath) {
  console.log(': creating server');
  var server = net.createServer(function(conn) {
    console.log(': got conn, writing to fifo');
    var writeStream = fs.createWriteStream(fifoPath, { flags: 'r+' });
    conn.on('end', function() {
      console.log(': TCP stream died!');
    });
    conn.pipe(writeStream);
  });
  server.listen(0, function() {
    console.log(': listener bound');
    process.send({ port: server.address().port });
  });

  return server;
}

var listenerServer;
process.on('message', function(msg) {
  listenerServer = makeDataReceiverListener(msg.fifoPath);
});
