/** Content manager is managing all media contents other than text, such as images, files.
 *  Users can upload and download contents interacting with content manager events */
var rbTree = require('./RBTree');
var dbManager = require('./dbManager');
var fs = require('fs');
var crypto = require('crypto');

var uploadJobs = rbTree.createRBTree();
var downloadJobs = rbTree.createRBTree();

var uploadId = 1;
var downloadId = 1;

// Content type configuration
var contentType = {
	image: {
		exts: ['jpeg', 'jpg', 'png'],
		dir: './imageContents',
	},
	binary: {
		exts: ['', 'zip'],
		dir: './binaryContents'
	}
};

var types = {
	image: 'image',
	binary: 'binary'
}

var init = function(user) {
	// Add user job list
	user.uploadJobs = [];
	user.downloadJobs = [];
	
	user.on('startUpload', function(data) {
		if (!session.validateRequest('startUpload', user, true, data)) {
			return;
		}
		
		var id = parseInt(data.id);
		var size = parseInt(data.size);
		var ext = data.extension;
		
		lib.debug('start upload id ' + id + ' size, ' + size);
		
		// id and size should be integer
		if (id !== id || size !== size || typeof(ext) != 'string') {
			return user.emitter.pushEvent('startUpload', 
					{status:'fail', errorMsg: 'invalid input'}).fireEvent();
		}
		
		// Get job
		var job = uploadJobs.get(id);
		
		// Job should exist
		if (!job) {
			return user.emitter.pushEvent('startUpload', 
					{status:'fail', errorMsg: 'invalid id'}).fireEvent();
		}
		
		// The user shoud match
		if (job.user != user) {
			return user.emitter.pushEvent('startUpload', 
					{status:'fail', errorMsg: 'authorization failed'}).fireEvent();
		}
		
		// Set content size
		job.size = size;
		
		// Create upload file
		var contentName = crypto.randomBytes(8).toString('hex');
		var typeStr = job.contentType;
		lib.debug('upload type str ' + typeStr);
		var type = contentType[typeStr];
		lib.debug('upload type ' + type);
		if (type) {
			var dir = type.dir;
			var exts = type.exts;
			
			// Check if extension is valid
			if (exts.indexOf(ext) < 0) {
				return user.emitter.pushEvent('startUpload', 
						{status:'fail', errorMsg: 'invalid extension'}).fireEvent();
			}
			
			// Add extension to content name
			contentName += '.' + ext;
			
			async.waterfall([
				function(callback) {
					// Make sure directory exists
					fs.stat(dir, function(err, stats) {
						if (err) {
							// Create directory
							fs.mkdir(dir, function(err) {
								callback(err);
							});
						} else {
							if (stats.isDirectory()) {
								// Directory exists
								callback(null);
							} else {
								callback(new Error('Failed to initialize'));
							}
						}
					});
				},
				function(callback) {
					// Create file
					fs.open(dir + '/' + contentName, 'wx', callback);
				},
				function(fd, callback) {
					// Set file descriptor
					job.file = fd;
					job.contentName = contentName;
					
					lib.debug('upload file descriptor ' + fd);
					
					callback(null);
				}
			],
			function(err) {
				if (err) {
					user.emitter.pushEvent('startUpload', 
							{status: 'fail', errorMsg: 'server erorr'}).fireEvent();
				} else {
					// From now on user can upload data;
					user.emitter.pushEvent('startUpload', 
							{status:'success', uploadId: id}).fireEvent();
				}
			});
		}
	});
	
	user.on('upload', function(data) {
		if (!session.validateRequest('upload', user, true, data))
			return;
		
		// Get user input
		var id = parseInt(data.id);
		var buf = data.buf;
		
		lib.debug('upload id ' + id + ' size ' + buf.length);
		
		// Check data validity
		if (id !== id || !buf) {
			return user.emitter.pushEvent('upload', 
					{status:'fail', errorMsg: 'invalid input'}).fireEvent();
		}
		
		// Get job
		var job = uploadJobs.get(id);
		
		// Job should exist
		if (!job) {
			return;
		}
		
		// The user shoud match
		if (job.user != user) {
			return user.emitter.pushEvent('upload', 
					{status:'fail', errorMsg: 'authorization failed'}).fireEvent();
		}
	
		var file = job.file;
		
		if (!file) {
			return user.emitter.pushEvent('upload', 
					{status:'fail', errorMsg: 'emit startUpload event first'}).fireEvent();
		}
		
		fs.writeFile(file, buf, function(writeErr) {
			if (writeErr) {
				lib.debug(writeErr);
				user.emitter.pushEvent('upload', 
						{status:'fail', errorMsg: 'failed to write'}).fireEvent();
			}
			
			fs.close(file, function(err) {
				if (err) {
					lib.debug(err);
				} else if (!writeErr) {
					// Done, remove the job
					uploadJobs.remove(job.id);
					
					// Remove from user job list
					user.uploadJobs = user.uploadJobs.filter(function(value, index, arr) {
						return value != job;
					});
					
					user.emitter.pushEvent('upload', {status:'success'}).fireEvent();
				}
				
				// Call callback function
				if (job.callback) {
					setTimeout(function() {
						job.callback(writeErr || err, job.contentName);
					}, 0);
				}
			});
		})
	});
	
	user.on('startDownload', function(data) {
		if (!session.validateRequest('startDownload', user, true, data))
			return;
	
		var contentName = data.name;
		var typeStr = data.type;
		var sendId = parseInt(data.sendId);
		
		if (!contentName || !typeStr || sendId !== sendId
				|| typeof(contentName) != 'string' || typeof(typeStr) != 'string') {
			return user.emitter.pushEvent('startDownload', 
					{status:'fail', errorMsg: 'invalid input'}).fireEvent();
		}
		
		var fs, path;
		var type = contentType[typeStr];
		
		// Content extension must match
		var split = contentName.split('.');
		
		if (split.length > 1) {
			if (split[1].indexOf(type.exts) < 0) {
				return user.emitter.pushEvent('startDownload', 
						{status:'fail', errorMsg: 'invalid extension'}).fireEvent();
			}
		}
		
		if (type) {
			path = type.dir + '/' + contentName;
		} else {
			return user.emitter.pushEvent('startDownload', 
					{status:'fail', errorMsg: 'invalid type'}).fireEvent();
		}
		
		var job, file, size;
		
		// Open file
		Async.waterfall([
			function(callback) {
				// Open file
				fs.open(path, 'r', callback);
			},
			function(fd, callback) {
				file = fd;
				
				// Get file stats
				fs.fstat(fd, callback);
			},
			function(stat, callback) {
				if (!stat.isFile()) {
					return callback(new Error('content is not a file'));
				}
				
				// Get file size
				size = stat.size;
				
				// Make new download id
				var id = downloadId++;
			
				// Create download job
				job = new downloadJob(user, id, typeStr, file);
				
				// Add to global upload jobs
				if (downloadJobs.add(id, job)) {
					
					// Add to user download jobs
					user.downloadJobs.push(job);
					
					callback(null);
				} else {
					callback(new Error('job creation error'));
				}
			}
		], 
		function(err) {
			if (err) {
				lib.debug(err);
				user.emitter.pushEvent('startDownload', 
						{status:'fail', errorMsg: 'content error'}).fireEvent();
				
				// Close file if opened
				if (job && job.file) {
					file.close(function(err) {
						lib.debug(err);
					});
				}
				
				// Remove job from list
				if (job && job.id) {
					downloadJobs.remove(job.id);
					user.downloadJobs = user.downloadJobs.filter(function(value, index, arr) {
						return value != job;
					});
				}
			} else {
				// Emit the user job id and size
				user.emitter.pushEvent('startDownload', 
						{status:'success', downloadId: job.id, size: job.size}).fireEvent();
				
				// Send file data
				fs.readFile(job.file, function(err, buf) {
					if (err) {
						user.emitter.pushEvent('download', 
								{status:'fail', errorMsg: 'file error'}).fireEvent();
					} else {
						user.emitter.pushEvent('download', {status:'success', 
							downloadId: job.id, size: job.size, buffer: buf}).fireEvent();
					}
					
					// Done, remove file
					fs.close(job.file, function(err) {
						if (err) {
							lib.debug(err);
						}
						
						// Remove job from list
						downloadJobs.remove(job.id);
						user.downloadJobs = user.downloadJobs.filter(function(value, index, arr) {
							return value != job;
						});
					});
				});
			}
		});
	});
	
	user.on('downloadAck', function(data) {
		if (!session.validateRequest('downloadAck', user, true, data))
			return;
		
		// Parse user input
		var id = parseInt(data.id);
		var size = parseInt(data.size);
		
		// Validata user input
		if (id !== id || size !== size) {
			return user.emitter.pushEvent('downloadAck', 
					{status:'fail', errorMsg: 'invalid input'}).fireEvent();
		}
		
		// Get job
		var job = downloadJobs.get(id);
		
		// Job must exist
		if (!job) {
			return user.emitter.pushEvent('downloadAck', 
					{status:'fail', errorMsg: 'no such job'}).fireEvent();
		}
		
		// The user shoud match
		if (job.user != user) {
			return user.emitter.pushEvent('downloadAck', 
					{status:'fail', errorMsg: 'authorization failed'}).fireEvent();
		}
		
		// Update job size
		job.doneSize += size;
		
		// Send more data if needed
		if (job.doneSize >= jb.size) {
			// Done, remove job
		} else {
			var left = job.size - job.donezSize;
			
			// Send more data
		}
	});
};


var uploadJobProto = {
	user: null,			// user
	id: null,			// Job id
	contentName: null,		// File name
	contentType: null,	// Content type
	size: null,			// Total size of content
	doneSize: 0,		// Transfered size of content
	file: null,			// File
	callback: null,		// Callback function
};

var downloadJobProto = {
	user: null,			// user
	id: null,			// Job id
	contentName: null,		// File name
	contentType: null,	// Content type
	size: null,			// Total size of content
	doneSize: 0,		// Transfered size of content
	file: null,			// File
};

var uploadJob = function(user, id, type, callback) {
	this.user = user;
	this.id = id;
	this.contentType = type;
	this.callback = callback;
};

var downloadJob = function(user, id, type, file, callback) {
	this.user = user;
	this.id = id;
	
};

uploadJob.prototype = uploadJob;
downloadJob.prototype = downloadJob;

var enrollUploadJob = function(user, type, jobCallback, callback) {
	// Make upload id
	var id = uploadId++;
	
	// Create upload job
	var job = new uploadJob(user, id, type, jobCallback);
	
	// Add upload job
	if (uploadJobs.add(job.id, job)) {
		if (callback) {
			callback(null, job.id);
		} else {
			return true;
		}
	} else if (callback) {
		callback(new Error("Duplicate upload job id"));
	} else {
		return false;
	}
};

var clearAllJobOfUser = function(user) {
	var userUploadJobs = user.uploadJobs;
	var userDownploadJobs = user.downloadJobs;
	
	if (userUploadJobs) {
		for (var i in userUploadJobs) {
			var job = userUploadJobs[i];
			uploadJobs.remove(job.id);
			if (job.file) {
				fs.close(job.file, function(err) {
					lib.debug(err);
				});
			}
		}
	}
	
	if (userDownploadJobs) {
		for (var i in userDownploadJobs) {
			var job = userDownploadJobs[i];
			downloadJobs.remove(job.id);
			if (job.file) {
				fs.close(job.file, function(err) {
					lib.debug(err);
				});
			}
		}
	}

	user.uploadJobs = null;
	user.downloadJobs = null;
};

module.exports = {init: init,
	types: types,
	enrollUploadJob: enrollUploadJob,
	clearAllJobOfUser: clearAllJobOfUser};

var session = require('./session');
var lib = require('./lib');
var async = require('async');