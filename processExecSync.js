module.exports = {
	execSync: function(command, options) {
		var child, error, fs, timeout, tmpdir;
		console.log("run execSync");
		fs = require('fs');
		options = options || {};
		timeout = Date.now() + options.timeout;
		tmpdir = '/tmp/processExecSync.' + Date.now() + Math.random();
		fs.mkdirSync(tmpdir);
		command = '(' + command + ' > ' + tmpdir + '/stdout 2> ' + tmpdir +
		'/stderr); echo $? > ' + tmpdir + '/status';
		child = require('child_process').exec(command, options, function () {
			return;
		});
		while (true) {
			try {
				fs.readFileSync(tmpdir + '/status');
				break;
			} catch (ignore) {
			}
			if (Date.now() > timeout) {
				error = child;
				break;
			}
		}
		['stdout', 'stderr', 'status'].forEach(function (file) {
			child[file] = fs.readFileSync(tmpdir + '/' + file, options.encoding);
			fs.unlinkSync(tmpdir + '/' + file);
		});
		child.status = Number(child.status);
		if (child.status !== 0) {
			error = child;
		}
		try {
			fs.rmdirSync(tmpdir);
		} catch (ignore) {
		}
		if (error) {
			throw error;
		}
		return child.stdout;
	}
}