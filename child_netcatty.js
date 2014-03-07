/*
 * listen on a port
 */

var net = require('net');
var fs = require('fs');

function makeDataReceiverListener(fifoPath, saveToPath) {
  console.log(': creating server');
  var server = net.createServer(function(conn) {
    console.log(': got conn, writing to fifo');
    var writeStream = fs.createWriteStream(fifoPath, { flags: 'r+' });
    conn.on('end', function() {
      console.log(': TCP stream died!');
    });
    conn.pipe(writeStream);

    if (saveToPath) {
      // write with replacement, so default mode of 'w' is fine.
      var fileStream = fs.createWriteStream(saveToPath);
      conn.pipe(fileStream);
    }
  });
  server.listen(0, function() {
    console.log(': listener bound');
    process.send({ port: server.address().port });
  });

  return server;
}

var listenerServer;
process.on('message', function(msg) {
  listenerServer = makeDataReceiverListener(msg.fifoPath, msg.saveToPath);
});
