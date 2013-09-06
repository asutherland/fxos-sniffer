var pcap = require('pcap');
var childProcess = require('child_process');
var net = require('net');

var util = require('util');
var fs = require('fs');
var os = require('os');

function mkfifo(path, callback) {
  childProcess.exec('mkfifo ' + path, function(err, stdout, stderr) {
    callback(err);
  });
}

function makePcapStreamConsumer(pipePath, conn) {
  console.log(': got network connection, creating pcap session');
  // use stdin.  This gets a little ugly, but what are we going to do...

  //conn.setEncoding('binary');

  // We want the stream to have been opened
  var waitingOn = 2;

  var writeStream = fs.createWriteStream(pipePath, { flags: 'r+' });
  conn.on('end', function() {
    console.log(': TCP stream died!');
  });

  // Wait for the network to give us the initial tcpdump header, then write it
  // to the pipe.  Only then do we create the pcap session.  node_pcap sets the
  // pipe to non-blocking after the initial open, but it absolutely requires the
  // header to already be available.

  console.log('waiting on initial write');

  function initialWriteHandler(data) {
console.log('first 4 bytes', data[0].toString(16), data[1].toString(16),
            data[2].toString(16), data[3].toString(16));

    console.log(' !! got', data.length, 'bytes of data!');
    writeStream.write(data, initialDataWritten);

    conn.removeListener('data', initialWriteHandler);
    // let pipe take over.
    conn.pipe(writeStream);
  }
  conn.on('data', initialWriteHandler);
  function initialDataWritten() {
    console.log('creating session');
    var session = pcap.createOfflineSession(pipePath); // pipePath
    console.log('created, wish we were nonblocking');

    session.on('packet', function (raw) {
      var packet = pcap.decode.packet(raw);
      util.puts(pcap.print.packet(packet));
    });

    console.log('on created');
  }

  /*
  conn.on('data', function(data) {
    console.log('   got', data.length, 'bytes');
  });
  */
}

function makeDataReceiverListener(fifoPath, callback) {
  console.log(': creating server');
  var server = net.createServer(makePcapStreamConsumer.bind(null, fifoPath));
  server.listen(51044 /* 0 */, function() {
    callback(server.address());
  });

  return server;
}

function spawnRemote(sshString, listenDevice, localAddress, filterString) {
  console.log(': invoking remote, telling it we are at',
              localAddress.address, localAddress.port);

  var remoteCommand = [
    'tcpdump',
    '-i', listenDevice, // listen on the requested device
    '-n', // don't convert addresses to names
    '-s', '0', // snarf it all
    '-U', // flush the packets as we see them rather than waiting for buffers
    '-w', '-', // write to stdout.
    filterString,

    '|', // PIPE!

    'nc',
    localAddress.address,
    localAddress.port
  ];
  var sshArgs = [
    sshString,
    // We want a shell for PATH reasons.
    //   -l runs the login process so the path gets setup correctly
    'sh -l -c "' + remoteCommand.join(' ') + '"',
  ];
  // we want to see what tcpdump on the other end says
  childProcess.spawn('ssh', sshArgs, { stdio: 'inherit' });
}

/**
 * Run tcpdump on some remote device, funneling the data back to us here.
 *
 * Because libpcap really wants to open a file, we use mkfifo() to establish
 * a fifo/pipe on disk so that we can funnel the data to it.  We use node.js
 * streams to pipe the data from the TCP socket into the writable end of the
 * pipe.  Alternatively, we could instead just have spawned a netcat process
 * to directly listen for the TCP data and had it write to the pipe.
 */
function remotePcapMagic(args) {
  var fifoPath = '/tmp/fx-sniff-fifo';
  mkfifo(fifoPath, function() {
    var server = makeDataReceiverListener(fifoPath, function(address) {
      // now we know our local port, so we can kick off the remote
      spawnRemote(args.sshString, args.device,
                  { address: get_interface_ip(args.bindInterface),
                    port: address.port },
                  args.filter);
    });
  });
};

function get_interface_ip(name) {
  var ifaces = os.networkInterfaces();
  if (!ifaces.hasOwnProperty(name))
    throw new Error('no such interface: ' + name);
  var ip = null;
  ifaces[name].some(function (address) {
    if (address.family === 'IPv4') {
      ip = address.address;
      return true;
    }
    return false;
  });
  if (!ip)
    throw new Error('no IPV4 address for: ' + name);
  return ip;
};

function main() {
  remotePcapMagic({
    // Our goal here is to figure out how to tell the device to talk to us.
    bindInterface: 'eth0',
    sshString: 'root@192.168.1.253',
    device: 'eth1',
    filter: 'tcp port 80',
  });
}

main();
