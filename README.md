Firefox OS / B2G debugging and analysis through use of libpcap/tcpdump.

## Overview ##

The idea is that you:

- Have an access point running DD-WRT or something similar that you can install
  and run tcpdump on.

- Tell your Firefox OS device to use the given access point.

- Run the commands locally on this machine, it ssh's into the router, passes
  tcpdump raw data back over the connection to this machine which saves it and
  displays it.

The best idea is if:

- You only use the access point for your testing devices.  That way you don't
  need to worry about load from real users interfering with testing use and
  vice versa.  Also, you can be a lot lazier with the filterspec if everything
  on the device is interesting.

- The machine you are running this script on is connected to the access point
  via the wire.  Obviously horrible problems happen if the pcap filter matches
  the sniffing traffic.

## Setup ##

### Installing this ###

I used a git submodule for pcap because I am actively developing some TLS
decoding logic.  This means you had better do the following:

```
git submodule update --init --recursive
```

And then you probably want to make sure you have pcap and the dev headers:

```
sudo apt-get install libpcap-dev
```

And then to top it all off, we want our other npm deps installed and pcap
built:

```
npm install
```

If you did npm install before you did the submodule thing, you are in for
a bad time and want to nuke node_modules/pcap and then start over.


### Getting tcpdump on your router ###

I followed these instructions:
http://www.dd-wrt.com/phpBB2/viewtopic.php?p=488089#488089

The helpful author then created a simpler approach if you want to operate
outside of ipkg:
http://www.dd-wrt.com/phpBB2/viewtopic.php?p=508172#508172

Instructions and binaries are directly available from his site at:
http://www.seanster.com/dd-wrt/

He pasted the following md5's in the post and I have validated them to the
extent that you and I are probably getting the same compromised binaries (if
we pretend that MD5 is fine and dandy.)
```
35db18c0b9567d080a6f4e49a43b14db libpcap_0.9.4-1_mipsel.ipk
10549f8bb40b2b6fb7f30026deda7e98 tcpdump-wrt.tgz
21c51e7fdc437d74380badfda0adc5a2 tcpdump_3.9.4-1_mipsel.ipk
9cf3f943c931c39100c547f3e61d5dcf tcpdump_3.9.4-1_mipsel.ipk.ORIG
```

### Other router stuff ###

You want to setup ssh so you can login without typing passwords.  The standard
ssh key installation mechanism using ssh-copy-id should work.  For example,
pretending your router is awesome like mine and lives at 192.168.1.253 and you
are using root because that's basically the only way for tcpdump to work:

```
ssh-copy-id root@192.168.1.253
```

## How To Use It ##

Key points:
- All the defaults are set-up exactly for me
- I am using "commander" so you can use --help to actually figure out how to do
  things.

### Running Live ###

```
node fx-sniff.js live
```

### Running against an existing pcap dump ###

```
node fx-sniff.js parse
```
