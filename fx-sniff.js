/*
 *
 * Current implementation:
 *
 * - We have accepted node_pcap really wants to block if you give it a file,
 *   even if it's a fifo that could be non-blocking.  We could potentially
 *   simplify things if we made node_pcap change its logic again, but I'm not
 *   sure that ever really worked and it's just not worth the hassle.
 *
 * - We create a subprocess that listens on a port and copies what comes in on
 *   the port into a fifo we create with mkfifo.  We do this because since we
 *   can't run the server in the same process that does the copying because it
 *   will block.  (if pipe() worked entirely on the libuv threads, we could
 *   maybe avoid this.)  This is basically what netcat does, we're doing it
 *   ourself because deps/command line hassles.
 *
 * - We currently do the blocking pcap processing in this, the main process.
 *   At some point in the future it may move into its own subprocess too.
 *
 * ## History ##
 *
 * So this script went through several hacky iterations, several intermediary
 * steps having been interesting but not checkpointed.  I think the steps were
 * something like:
 * - Try and feed pcap a network socket directly, discover it was particularly
 *   difficult to tell it an fd outright.
 * - Use mkfifo to create a fifo so we could point pcap at an actual fifo.
 * - Various contortions to make sure the fifo got created in a non-blocking
 *   mode.  This apparently involved adding extra error handling to either pcap
 *   or node_pcap to figure out what was going on)
 * - (project shelved for a while after work week travel and more, new machine
 *    adopted, local build of pcap possibly abandoned on last machine.  sorta
 *    remember things working-ish...)
 * - (node_pcap advances)
 * - Things aren't working when trying to run again, getting a magic error code
 *   I clearly inserted.  npm install, etc. etc.
 * - Upgrade node_pcap, things sorta working now, but
 * https://github.com/mranney/node_pcap/commit/584ee107f17440fef1c8d10a4e821877a78a0540
 *   most definition has changed non-live mode to not bother entering non-blocking
 *   mode.  Not sure I care right now.  Probably easiest to create a subprocess
 *   that receives things and sends them up to the main process so the blocking
 *   doesn't matter.  This may in fact be what I resigned myself to previously.
 */

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

var netcatKid = null;

/**
 * Spin up the server to listen for and receive data from the dd-wrt box in
 * a sub-process.  Invokes callback once the server is operational and we know
 * the port so the callback can spin up the pcap/sender on the dd-wrt box.
 */
function makeDataReceiverListener(fifoPath, callback) {
  netcatKid = childProcess.fork(__dirname + '/child_netcatty.js');
  netcatKid.once('message', function(msg) {
    console.log(': server understood ready, next step');
    callback(msg);
  });
  netcatKid.send({ fifoPath: fifoPath });
}

var liveRemotes = [];

function spawnRemote(sshString, listenDevice, localAddress, filterString) {
  console.log(': invoking remote, telling it we are at',
              localAddress.address, localAddress.port);

  var remoteCommand = [
    // kill those that preceded us.
    'killall tcpdump;',
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
    // (dropbear will nominally run this command just with "sh -c")
    'sh -l -c "' + remoteCommand.join(' ') + '"',
  ];
  // we want to see what tcpdump on the other end says
  var kid = childProcess.spawn(
    'ssh',
    sshArgs,
    // Use a pipe for stdin so we can send a control-c, inherit stdout/stderr
    // so we can see anything interesting said by the server.
    { stdio: ['pipe', process.stdout, process.stderr] });

  liveRemotes.push(kid);

  // Remove the subprocess when it dies so we don't try and kill it later
  kid.stdin.on('end', function() {
    console.log('kid', kid.pid, 'died per stdin closure');
    var idx = liveRemotes.indexOf(kid);
    if (idx !== -1)
      liveRemotes.splice(idx, 1);
  });
}

/**
 * Send a control-C to all known remotes to try and help the tcpdump process
 * help in the process of dying.
 *
 * THIS DOES NOT WORK.  we keep getting an EPIPE and I must confess it's not
 * entirely clear to me why this is happening.  Presumably ssh notices it's not
 * in a pty and so doesn't listen on stdin.  I think I've dealt with this in
 * the past... or perhaps there's a nice node library that wraps this silliness.
 */
function killLiveRemotes() {
  liveRemotes.forEach(function(kid) {
    // Send a control-C over the SSH connection
    // If we were really thorough, we could wait for the write to complete.
    try {
      kid.stdin.write('\x03');
    }
    catch(ex) {
      console.warn('Problem writing to kid', kid.pid, 'stdin');
    }
  });
  liveRemotes = [];
}

function startSession(fifoPath) {
  console.log('creating session');
  var session = pcap.createOfflineSession(fifoPath);
  console.log('created, wish we were nonblocking');

  session.on('packet', function (raw) {
    var packet = pcap.decode.packet(raw);
    util.puts(pcap.print.packet(packet));
  });
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
      startSession(fifoPath);
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
    filter: 'tcp port 993',
  });
}

function cleanCleanup() {
  console.log('-- Killing remotes, exiting after 1 sec');
  killLiveRemotes();
  setTimeout(function() {
    console.log('-- Exiting');
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', cleanCleanup);
process.on('uncaughtException', function(err) {
  console.warn('Unhandled error', err, '\n', err.stack);
  console.warn('shutting down');
  cleanCleanup();
});


main();
