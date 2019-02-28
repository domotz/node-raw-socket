var events = require("events");
var net = require("net");
var os = require("os");
var util = require("util");
var child_process = require('child_process');
var fs = require('fs');
var archs = getDirectories(__dirname+"/binaries");
var raw = requireB("binaries", "raw.node", archs);
function findArchInString(string, arch) {
	return string.indexOf(arch) != -1
}
function deleteFolderRecursive(path) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

function getDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path+'/'+file).isDirectory();
  });
}

function systemSync(cmd) {
	var out;
	try {
		console.log(cmd);
		out = child_process.execSync(cmd).toString();
	} catch (error) {
		return 0;
	}
	return 1;
};

function guessArch() {
	try {
		var cpu_model_string = os.cpus()[0]["model"];
	} catch (e) {
		console.log("Error: " + e);
		cpu_model_string = '';
	}

	switch (true) {
		case findArchInString(cpu_model_string, "Annapurna"):
			return 'annapurna';
			break;
		case findArchInString(cpu_model_string, "bcm53"):
			return 'bcm53xx';
			break;
		case findArchInString(cpu_model_string, "octeon"):
			return 'octeon';
			break;
		case findArchInString(cpu_model_string, "ARMv7"):
			return 'rpi';
			break;
		default:
			return 'x64';
	}
}

function requireB(binaryPath, binaryFile, archs) {
	var sys_arch = guessArch()
	var idx = archs.indexOf(sys_arch)
	if (archs.indexOf(sys_arch) != -1) {
		archs.splice(idx, 1);
		archs.unshift(sys_arch)
	}
	for (index = 0; index < archs.length; index++) {
		var arch = archs[index];
		var bin_file = binaryPath + '/' + arch + '/Release/' + binaryFile;
		var ok = systemSync('domotz_node ' + __dirname + "/" +bin_file);
		if (!ok) {
			deleteFolderRecursive(__dirname + "/" + binaryPath + '/' + arch);
			continue;
		}
		try {
			ret = require("./"+bin_file);
			console.log("required");
		} catch (e) {
			console.log("Error Raw: " + e);
                        deleteFolderRecursive(__dirname + "/" + binaryPath + '/' + arch);
			ret = false
		}
		if (ret != false) {
			return ret
		}
	}
	console.log("arch not found")
	throw 'ArchNotFound'
}

function _expandConstantObject(object) {
	var keys = [];
	for (key in object)
		keys.push(key);
	for (var i = 0; i < keys.length; i++)
		object[object[keys[i]]] = parseInt(keys[i]);
}

var AddressFamily = {
	1: "IPv4",
	2: "IPv6"
};

_expandConstantObject(AddressFamily);

var Protocol = {
	0: "None",
	1: "ICMP",
	6: "TCP",
	17: "UDP",
	58: "ICMPv6"
};

_expandConstantObject(Protocol);

for (var key in events.EventEmitter.prototype) {
	raw.SocketWrap.prototype[key] = events.EventEmitter.prototype[key];
}

function Socket(options) {
	Socket.super_.call(this);

	this.requests = [];
	this.buffer = new Buffer((options && options.bufferSize) ?
		options.bufferSize :
		4096);

	this.recvPaused = false;
	this.sendPaused = true;

	this.wrap = new raw.SocketWrap(
		((options && options.protocol) ?
			options.protocol :
			0),
		((options && options.addressFamily) ?
			options.addressFamily :
			AddressFamily.IPv4)
	);

	var me = this;
	this.wrap.on("sendReady", this.onSendReady.bind(me));
	this.wrap.on("recvReady", this.onRecvReady.bind(me));
	this.wrap.on("error", this.onError.bind(me));
	this.wrap.on("close", this.onClose.bind(me));
};

util.inherits(Socket, events.EventEmitter);

Socket.prototype.close = function () {
	this.wrap.close();
	return this;
}

Socket.prototype.getOption = function (level, option, value, length) {
	return this.wrap.getOption(level, option, value, length);
}

Socket.prototype.onClose = function () {
	this.emit("close");
}

Socket.prototype.onError = function (error) {
	this.emit("error", error);
	this.close();
}

Socket.prototype.onRecvReady = function () {
	var me = this;
	try {
		this.wrap.recv(this.buffer, function (buffer, bytes, source) {
			var newBuffer = buffer.slice(0, bytes);
			me.emit("message", newBuffer, source);
		});
	} catch (error) {
		me.emit("error", error);
	}
}

Socket.prototype.onSendReady = function () {
	if (this.requests.length > 0) {
		var me = this;
		var req = this.requests.shift();
		try {
			if (req.beforeCallback)
				req.beforeCallback();
			this.wrap.send(req.buffer, req.offset, req.length,
				req.address,
				function (bytes) {
					req.afterCallback.call(me, null, bytes);
				});
		} catch (error) {
			req.afterCallback.call(me, error, 0);
		}
	} else {
		if (!this.sendPaused)
			this.pauseSend();
	}
}

Socket.prototype.pauseRecv = function () {
	this.recvPaused = true;
	this.wrap.pause(this.recvPaused, this.sendPaused);
	return this;
}

Socket.prototype.pauseSend = function () {
	this.sendPaused = true;
	this.wrap.pause(this.recvPaused, this.sendPaused);
	return this;
}

Socket.prototype.resumeRecv = function () {
	this.recvPaused = false;
	this.wrap.pause(this.recvPaused, this.sendPaused);
	return this;
}

Socket.prototype.resumeSend = function () {
	this.sendPaused = false;
	this.wrap.pause(this.recvPaused, this.sendPaused);
	return this;
}

Socket.prototype.send = function (buffer, offset, length, address,
	beforeCallback, afterCallback) {
	if (!afterCallback) {
		afterCallback = beforeCallback;
		beforeCallback = null;
	}

	if (length + offset > buffer.length) {
		afterCallback.call(this, new Error("Buffer length '" + buffer.length +
			"' is not large enough for the specified offset '" + offset +
			"' plus length '" + length + "'"));
		return this;
	}

	if (!net.isIP(address)) {
		afterCallback.call(this, new Error("Invalid IP address '" + address + "'"));
		return this;
	}

	var req = {
		buffer: buffer,
		offset: offset,
		length: length,
		address: address,
		afterCallback: afterCallback,
		beforeCallback: beforeCallback
	};
	this.requests.push(req);

	if (this.sendPaused)
		this.resumeSend();

	return this;
}

Socket.prototype.setOption = function (level, option, value, length) {
	if (arguments.length > 3)
		this.wrap.setOption(level, option, value, length);
	else
		this.wrap.setOption(level, option, value);
}

exports.createChecksum = function () {
	var sum = 0;
	for (var i = 0; i < arguments.length; i++) {
		var object = arguments[i];
		if (object instanceof Buffer) {
			sum = raw.createChecksum(sum, object, 0, object.length);
		} else {
			sum = raw.createChecksum(sum, object.buffer, object.offset,
				object.length);
		}
	}
	return sum;
}

exports.writeChecksum = function (buffer, offset, checksum) {
	buffer.writeUInt8((checksum & 0xff00) >> 8, offset);
	buffer.writeUInt8(checksum & 0xff, offset + 1);
	return buffer;
}

exports.createSocket = function (options) {
	return new Socket(options || {});
};

exports.AddressFamily = AddressFamily;
exports.Protocol = Protocol;

exports.Socket = Socket;

exports.SocketLevel = raw.SocketLevel;
exports.SocketOption = raw.SocketOption;

exports.htonl = raw.htonl;
exports.htons = raw.htons;
exports.ntohl = raw.ntohl;
exports.ntohs = raw.ntohs;