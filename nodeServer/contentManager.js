/** Content manager is managing all media contents other than text, such as images, files.
 *  Users can upload and download contents interacting with content manager events */
const rbTree = require('./RBTree');
const dbManager = require('./dbManager');
const fs = require('fs');
const crypto = require('crypto');

const uploadJobs = rbTree.createRBTree();
const downloadJobs = rbTree.createRBTree();

var uploadId = 1;
var downloadId = 1;

const uploadJobTimeout = 5000;
const downloadJobTimeout = 5000;

// Content type configuration
const contentType = {
	image: {
		exts: ['jpeg', 'jpg', 'png'],
		dir: './imageContents',
		maximumSize: 1024 * 1024
	},
	binary: {
		exts: ['*',],
		dir: './binaryContents',
		maximumSize: 1024 * 1024 * 100
	}
};

const types = {
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
		
		var uploadId = parseInt(data.uploadId);
		var size = parseInt(data.size);
		var ext = data.extension;
		
		lib.debug('start upload id ' + uploadId + ' size, ' + size);
		
		// id and size should be integer
		if (uploadId !== uploadId || size !== size || typeof(ext) != 'string') {
			return user.emitter.pushEvent('startUpload', 
					{status:'fail', errorMsg: 'invalid input'}).fireEvent();
		}
		
		// Get job
		var job = uploadJobs.get(uploadId);
		
		// Job should exist
		if (!job) {
			return user.emitter.pushEvent('startUpload', 
					{status:'fail', errorMsg: 'invalid id'}).fireEvent();
		}
		
		// The user should match
		if (job.user != user) {
			return user.emitter.pushEvent('startUpload', 
					{status:'fail', errorMsg: 'authorization failed'}).fireEvent();
		}
		
		// Set content size
		job.size = size;
		job.left = size;
		
		// Create upload file name
		var contentName = crypto.randomBytes(8).toString('hex');
		
		// Get type of content file
		var typeStr = job.contentType;
		var type = contentType[typeStr];
		
		if (!type) {
			return user.emitter.pushEvent('startUpload', 
					{status:'fail', errorMsg: 'server error'}).fireEvent();
		}
		
		var dir = type.dir;
		var exts = type.exts;
		
		// Check if extension is valid
		if (exts.indexOf('*') < 0 && exts.indexOf(ext) < 0) {
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
				// Set file path
				job.path = dir + '/' + contentName;
				
				// Create file
				fs.open(job.path, 'wx', callback);
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
			// Clear timer
			if (job.timer) {
				clearTimeout(job.timer);
			}
			
			// Set timer again
			job.timer = setTimeout(function() {
				job.finish(new Error('Timeout'));
			}, uploadJobTimeout);
			
			if (err) {
				lib.debug(err);
				user.emitter.pushEvent('startUpload', 
						{status: 'fail', errorMsg: 'server erorr', uploadId: uploadId}).fireEvent();
			} else {
				// From now on user can upload data;
				user.emitter.pushEvent('startUpload', 
						{status:'success', uploadId: uploadId, contentName: job.contentName}).fireEvent();
			}
		});
	});
	
	user.on('upload', function(data) {
		if (!session.validateRequest('upload', user, true, data))
			return;
		
		// Get user input
		var uploadId = parseInt(data.uploadId);
		var buf = data.buf;
		
		lib.debug('upload id ' + uploadId + ' size ' + buf.length);
		
		// Check data validity
		if (uploadId !== uploadId || !buf) {
			return user.emitter.pushEvent('upload', 
					{status:'fail', errorMsg: 'invalid input'}).fireEvent();
		}
		
		// Get job
		var job = uploadJobs.get(uploadId);
		
		// Job should exist
		if (!job) {
			return;
		}
		
		// The user should match
		if (job.user != user) {
			return user.emitter.pushEvent('upload', 
					{status:'fail', errorMsg: 'authorization failed'}).fireEvent();
		}
	
		var file = job.file;
		
		if (!file) {
			return user.emitter.pushEvent('upload', 
					{status:'fail', errorMsg: 'emit startUpload event first'}).fireEvent();
		}
		
		// Compute valid size of upload
		var bufSize = buf.length;
		var leftSize = job.left;
		var validSize = leftSize < bufSize ? leftSize : bufSize;
		
		// Cut buffer if buffer size is too big
		if (leftSize < bufSize) {
			buf = buf.slice(0, validSize);
		}
		
		// Subtract left size
		job.left -= validSize;
		
		// Write to file
		fs.writeFile(file, buf, function(writeErr) {
			// Clear timer
			if (job.timer) {
				clearTimeout(job.timer);
			}
			
			// Set timer again
			job.timer = setTimeout(function() {
				job.finish(new Error('Timeout'));
			}, uploadJobTimeout);
			
			// Emit message
			if (writeErr) {
				lib.debug(writeErr);
				user.emitter.pushEvent('upload', 
						{status:'fail', errorMsg: 'failed to write', uploadId: uploadId}).fireEvent();
			} else {
				user.emitter.pushEvent('upload', 
						{status:'success', uploadId: uploadId, ack: job.size - job.left}).fireEvent();
			}
			
			// Check if i is an error
			if (writeErr) {
				// Finish upload job
				job.finish(writeErr);
			}
			// Check if job is done
			else if (job.left == 0) {
				if (job.contentType == types.image) {
					// Create thumbnail image
					image.createThumbnailImage(job.contentName, function(err) {
						if (err) {
							lib.debug(err);
						} else {
							lib.debug('created thumbnail image');
						}
						
						// Finish upload job
						job.finish(null);
					});
				} else {
					// Finish upload job
					job.finish(null);
				}
			}
		})
	});
	
	user.on('startDownload', function(data) {
		if (!session.validateRequest('startDownload', user, true, data))
			return;
	
		var contentName = data.contentName;
		var typeStr = data.type;
		var sendId = parseInt(data.sendId);
		
		if (!contentName || !typeStr || sendId !== sendId
				|| typeof(contentName) != 'string' || typeof(typeStr) != 'string') {
			return user.emitter.pushEvent('startDownload', 
					{status:'fail', errorMsg: 'invalid input'}).fireEvent();
		}
		
		lib.debug('start downlaod ' +contentName + ' sendId ' + sendId + ' type ' + typeStr);
		
		var path;
		var type = contentType[typeStr];
		
		// Content extension must match
		var split = contentName.split('.');
		
		if (split.length > 1) {
			if (type.exts.indexOf(split[split.length - 1]) < 0) {
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
		async.waterfall([
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
				
				lib.debug('content exsits');
				
				// Get file size
				size = stat.size;
				
				// Make new download id
				var id = downloadId++;
			
				// Create download job
				job = new downloadJob(user, id, contentName, typeStr, file);
				job.size = size;
				job.sendId = sendId;
				
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
						{status:'fail', errorMsg: 'content error', sendId: sendId}).fireEvent();
				
				// Close file if opened
				if (file) {
					fs.close(file, function(err) {
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
						{status:'success', downloadId: job.id, sendId: sendId, size: job.size}).fireEvent();
				
				// Create timer
				job.timer = setTimeout(function() {
					job.finish(new Error('Timeout'));
				}, downloadJobTimeout);
				
				// Send file data
				fs.readFile(job.file, function(err, buf) {
					if (err) {
						user.emitter.pushEvent('download', 
								{status:'fail', errorMsg: 'file error', 
							downloadId: job.id, sendId: job.sendId}).fireEvent();
					} else {
						user.emitter.pushEvent('download', {status:'success', 
							downloadId: job.id, sendId: job.sendId, size: job.size, buffer: buf}).fireEvent();
					}
					
					// Finish download job
					job.finish(err);
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
		
		// Validate user input
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
	contentName: null,	// File name
	contentType: null,	// Content type
	path: null,			// File path
	size: null,			// Total size of content
	left: null,			// Size of content not delivered yet
	file: null,			// File
	callback: null,		// Callback function
	timer: null 		// Timeout callback
};

var downloadJobProto = {
	user: null,			// user
	id: null,			// Job id
	sendId: null,		// Send id
	contentName: null,	// File name
	contentType: null,	// Content type
	size: null,			// Total size of content
	doneSize: 0,		// Transfered size of content
	file: null,			// File
	timer: null 		// Timeout callback
};

var uploadJob = function(user, id, type, callback) {
	this.user = user;
	this.id = id;
	this.contentType = type;
	this.callback = callback;
	
	this.finish = function(givenError) {
		var job = this;
		
		lib.debug('Finish content ' + job.contentName + ' upload');
		
		// Done, remove the job
		uploadJobs.remove(job.id);
		
		// Remove from user job list
		if (job.user) {
			job.user.uploadJobs = job.user.uploadJobs.filter(function(value, index, arr) {
				return value != job;
			});
		}
		
		// Call callback function
		if (job.callback) {
			setTimeout(function() {
				job.callback(givenError, job.contentName);
			}, 0);
		}
		
		// Cancel timer
		if (job.timer) {
			clearTimeout(job.timer);
		}
		
		if (job.file) {
			// Close file
			fs.close(job.file, function(err) {
				if (err) {
					lib.debug(err);
				}

				// If error occurred, remove the file
				if (givenError) {
					fs.unlink(job.path, function(err) {
						if (err) {
							lib.debug(err);
						} 
						
						lib.debug('File ' + job.path + ' was deleted');
					});
				}
			});
		}
	}
};

var downloadJob = function(user, id, contentName, type, file, callback) {
	this.user = user;
	this.id = id;
	this.contentName = contentName;
	this.contentType = type;
	this.file = file;
	
	this.finish = function(givenError) {
		var job = this;
		
		lib.debug('Finish downlaod job ' + job.contentName);
		
		// Remove job from list
		downloadJobs.remove(job.id);
		if (job.user) {
			job.user.downloadJobs = job.user.downloadJobs.filter(function(value, index, arr) {
				return value != job;
			});
		}
		
		// Cancel timer
		if (job.timer) {
			clearTimeout(job.timer);
		}
		
		if (job.file) {
			// Close file
			fs.close(job.file, function(err) {
				if (err) {
					lib.debug(err);
				}
				lib.debug('Closed file ' + job.contentName);
			});
		}
	}
};

uploadJob.prototype = uploadJob;
downloadJob.prototype = downloadJob;

var enrollUploadJob = function(user, type, jobCallback, callback) {
	// Make upload id
	var id = uploadId++;
	
	// Create upload job
	var job = new uploadJob(user, id, type, jobCallback);
	
	// Create timer
	job.timer = setTimeout(function() {
		job.finish(new Error('Timeout'));
	}, uploadJobTimeout);
	
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
	var userDownloadJobs = user.downloadJobs;
	
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
	
	if (userDownloadJobs) {
		for (var i in userDownloadJobs) {
			var job = userDownloadJobs[i];
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
	contentType: contentType,
	types: types,
	enrollUploadJob: enrollUploadJob,
	clearAllJobOfUser: clearAllJobOfUser};

var session = require('./session');
var lib = require('./lib');
var async = require('async');
const image = require('./imageProcessor');