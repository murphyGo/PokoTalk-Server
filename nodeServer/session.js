/**
 * User login management
 * users at first must send their session id to login
 */
var rbTree = require('./RBTree');
var dbManager = require('./dbManager');
var bcrypt = require('bcrypt');
var crypto = require('crypto');

var users;

var userState = {
	LOGOUT: 0,
	LOGING: 1,
	LOGIN: 2,
	LOGINGOUT: 3,
};

var hashRound = 10;

function init(user) {
	// Initialize user state
	user.state = userState.LOGOUT;
	
	// Add event emitter for user
	var emitter = eventEmitterGen(user);
	user.emitter = emitter;
	
	user.emitFail = function(eventName, errMsg) {
		user.emit(eventName, {status: 'fail', errorMsg: errMsg});
	};
	
	// User creates account
	user.on('registerAccount', function(data) {
		if (!logouted(user)) {
			lib.debug('user ' + user.email + ' is already logined');
			return;
		}
		
		var name = data.name;
		var email = data.email;
		var password = data.password;
		
		if (typeof name != 'string' || name.length == 0) {
			user.emit('registerAccount', {status: 'fail', errorMsg: 'invalid name'});
			return;
		}
		if (!ValidateEmail(email)) {
			user.emit('registerAccount', {status: 'fail', errorMsg: 'invalid email'});
			return;
		}
		if (typeof password != 'string' || password.length < 7 ||
				!password.match(/[0-9]/) || !password.match(/[a-zA-Z]/) || 
				!password.match(/[$&~`+{},:;=\\?@#|/'<>.^*()%!-]/)) {
			user.emit('registerAccount', {status: 'fail', errorMsg: 'invalid password'});
			return;
		}
		
		dbManager.trxPattern([
			function(callback) {
				// get bcrypt hash value of password
				bcrypt.hash(password, hashRound, callback);
			},
			function(hash, callback) {
				// save in database;
				this.db.addUser({nickname: name, email: email, password: hash}, callback);
			},
			function(result, fields, callback) {	
				if (result.affectedRows == 0) 
					return callback(new Error('Failed'));
				
				var event = user.emitter.pushEvent('registerAccount', {status: 'success'});
				
				callback(null, event);
			}
		], function(err, event){
			if (err) {
				if (event) {
					event.cancelEvent();
				}
				user.emit('registerAccount', {status: 'fail', errorMsg: 'failed to register'});
			} else {
				event.fireEvent();
			}
		});
	});
	
	//TODO: vulnerability, attacker may send big amount of this event to attack database
	user.on('passwordLogin', function(data) {
		if (!logouted(user)) {
			lib.debug('user ' + user.email + ' is already logined');
			return;
		}
		
		var email = data.email;
		var password = data.password;
		
		dbManager.trxPattern([
			function(callback) {
				if (logined(user)) {
					lib.debug('user ' + user.email + ' is already logined');
					return callback(new Error('already logined'));
				}
				
				this.db.getUserByEmail({email: email}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('no such user'));
				
				this.data.userInfo = result[0];
				
				// check if the password is correct 
				bcrypt.compare(password, this.data.userInfo.password, callback);
			},
			function(correct, callback) {
				if (!correct)
					return callback(new Error('password wrong'));
				
				this.db.updateLastSeen({userId: this.data.userInfo.id}, callback);
			},
			function(result, fields, callback){
				if (result.affectedRows == 0)
					return callback(new Error('Failed to update last seen date'));
				
				// create session id for the user
				var sessionId = crypto.randomBytes(20).toString('hex');
				// create session expire time
				var date = new Date();
				date.setHours(date.getHours() + 1);
				var timestamp = date.valueOf();
				
				this.data.userInfo.sessionExpire = timestamp;
				this.data.userInfo.sessionId = sessionId;
				this.db.addSession({sessionId: sessionId, userId: this.data.userInfo.id, expire: date}, callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0)
					return callback(new Error('Failed to create session id'));
				
				var data = {status: 'success', sessionId: this.data.userInfo.sessionId, 
						sessionExpire: this.data.userInfo.sessionExpire};
				
				var event = user.emitter.pushEvent('passwordLogin', data);
				
				callback(null, event);
			}
		], function(err, event) {
			if (err) {
				if (event) {
					event.cancelEvent();
				}
				user.emit('passwordLogin', {status: 'fail', errorMsg: 'failed to login'});
			} else {
				event.fireEvent();
			}
		});
	});
	
	user.on('sessionLogin', function(data) {
		if (user.state == userState.LOGING)
			return user.emit('sessionLogin', {status:'fail', errorMsg: 'you\'re trying to login'});
		if (user.state == userState.LOGIN)
			return user.emit('sessionLogin', {status:'fail', errorMsg: 'you\'d logined already'});
		if (user.state == userState.LOGINGOUT)
			return user.emit('sessionLogin', {status:'fail', errorMsg: 'you\'re trying to logout'});
		
		var sessionId = data.sessionId;
		user.state = userState.LOGING;
		lib.debug('user try to login with session id ' + sessionId);
		
		dbManager.trxPattern([
			function(callback) {
				lib.debug(this.data);
				if (logined(user)) {
					user.emit('sessionLogin', {status: 'fail', errorMsg: 'already logined'});
					return;
				}
				
				this.db.getUserBySession({sessionId: sessionId, update: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('no such session'));
				
				this.data.userInfo = result[0];
				this.data.sessionId = result[0].sessionId;
				
				this.db.updateLastSeen({userId: this.data.userInfo.id}, callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0)
					return callback(new Error('Failed to update last seen date'));
				
				// create session expire time
				var date = new Date();
				date.setHours(date.getHours() + 1);
				var timestamp = date.valueOf();
				
				this.data.userInfo.sessionExpire = timestamp;
				this.data.userInfo.sessionId = this.data.sessionId;
				this.db.updateSessionExpire({sessionId: this.data.sessionId, expire: date}, callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0)
					return callback(new Error('Failed to update session expire date'));
				
				var data = {user: lib.filterUserData(this.data.userInfo),
						sessionId: this.data.userInfo.sessionId, 
						sessionExpire: this.data.userInfo.sessionExpire};
				
				this.pushEvent(user, 'sessionLogin', data);
				
				loginUser({user: user, userInfo: this.data.userInfo, db: this.db}, callback);
			},
		], function(err) {
			if (err) {
				user.state = userState.LOGOUT;
				user.emitFail('sessionLogin', 'failed to login');
			} else {
				user.state = userState.LOGIN;
				lib.debug('user logined with sessionId ' + sessionId);
			}
		},	
		null,
		// Deadlock rollback
		function() {
			// User must leave every chat
			chatManager.leaveAllGroupChat({user: user});
		});
	});
	
	user.on('logout', function() {
		if (!logined(user)) {
			user.emit('logout', {status: 'fail', errorMsg: 'login first'});
			return;
		}
		
		// User is now not allowed to emit any event that is handled when logined
		user.state = userState.LOGINGOUT;
		
		dbManager.trxPattern([
			function(callback) {
				// Logout user
				logoutUser({db: this.db, user: user}, callback);
			}
		], function(err, event) {
			if (err) {
				if (event) {
					event.cancelEvent();
				}
				
				lib.debug('user ' + user.email + ' failed to logout, disconnect');
			} else if (event) {
				event.fireEvent();
			}
			
			user.state = userState.LOGOUT;
			// Logout, so disconnect, regardless of success or fail.
			// When user want to login again, user should reconnect.
			user.disconnect();
		})
	});
	
	user.on('disconnect', function() {
		if (!logined(user)) {
			user.state = userState.LOGOUT;
			lib.debug('anonymous user ' + user.id + ' disconnected');
		} else {
			var email = user.email;
			
			dbManager.trxPattern([
				function(callback) {
					// Logout user
					logoutUser({db: this.db, user: user}, callback);
				}
			], function(err) {
				user.state = userState.LOGOUT;
				if (err) {
					lib.debug('user ' + email + ' failed to logout');
				} else {
					lib.debug('user ' + email + ' disconnected');
				}
			});
		}
	});
	
	user.on('updateProfileImage', function(data) {
		if (!validateRequest('updateProfileImage', user, true, data))
			return;
		
		var sendId = parseInt(data.sendId);
		
		if (sendId !== sendId) {
			return;
		}
		
		var uploadId;
		
		// Enroll update job
		contentManager.enrollUploadJob(user, contentManager.types.image,
		function(err, contentName) {
			if (err) {
				lib.debug(err);
				user.emitter.pushEvent('updateProfileImage', 
						{status: 'fail', errorMsg: 'failed to upload', uploadId: uploadId}).fireEvent();
			} else {
				dbManager.trxPattern([
					function(callback) {
						// Update user profile image
						this.db.updatePicture({userId: user.userId, picture: contentName}, callback);
					},
					function(result, fields, callback) {
						if (result.affectedRows == 0) {
							lib.debug('update fail');
							return callback(new Error('Failed to update picture'));
						}
						
						lib.debug('update success ' + result.affectedRows);
						
						// Get user sessions
						var sessions = getUserSessions(user);
						
						// Notify to sessions of the user
						for (var i in sessions) {
							this.pushEvent(sessions[i], 'updateProfileImage', {contentName: contentName});
						}
						
						callback(null);
					}
				],
				function(err) {
					if (err) {
						user.emitter.pushEvent('updateProfileImage', 
								{status: 'fail', errorMsg: 'server error', 
									contentName: contentName}).fireEvent();
					}
				});
			}
		},
		function(err, id) {
			if (err) {
				user.emitter.pushEvent('updateProfileImage', 
						{status: 'fail', errorMsg: 'failed to get ready', sendId: sendId}).fireEvent();
			} else {
				uploadId = id;
				
				lib.debug('update profile start ' + sendId + ', upload Id ' + id);
				user.emitter.pushEvent('updateProfileImage', 
						{status: 'success', uploadId: uploadId, sendId: sendId}).fireEvent();
			}
		});
	});
}

// Data: user, userInfo
var loginUser = dbManager.composablePattern(function(pattern, oCallback) {
	var user = this.data.user;
	var userInfo = this.data.userInfo;
	var db = this.data.db;
	
	// Set user data
	user.userId = userInfo.id;
	user.email = userInfo.email;
	user.nickname = userInfo.nickname;
	user.picture = userInfo.picture;
	user.lastSeen = userInfo.lastSeen;
	user.sessionId = userInfo.sessionId;
	user.sessionExpire = userInfo.sessionExpire;
	
	// Set functoin that returns object of data only available to other contacts
	user.getUserInfo = function() {return lib.filterUserData(this);};

	// Add the user to session pool
	if (!addUserSession(user)) {
		return oCallback(new Error('Failed to add user session'));
	}
	
	lib.debug('user ' + user.email + ' logined');
	
	pattern([
		function(callback) {
			// join every active group the user belongs to
			chatManager.initUser({user: user, db: db}, callback);
		},
		/*function(callback) {
			var err = new Error('waef');
			err.code ='ER_LOCK_DEADLOCK';
			err.errno = 1213;
			err.sqlState='40001';
			
			callback(err);
		},*/
	], 
	function(err) {
		if (err) {
			return oCallback(err);
		} else {
			lib.debug(user.email + ' joined groups');
			return oCallback(null);
		}
	}, {db: db});
});

var logoutUser = dbManager.composablePattern(function(pattern, oCallback) {
	var user = this.data.user;
	var db = this.data.db;
	var email = user.email;
	
	//TODO: leaving group chat and removing user session should work in callback pattern
	
	// NOTE: Even though we clear event queue and remove user from session pool and chat,
	// server might try to send some event to this connection which is being handled concurrently.
	chatManager.leaveAllGroupChat({user: user});
	removeUserSession(user);
	user.emitter.clear();
	
	var event = user.emitter.pushEvent('logout', {status:'success'});
	
	lib.debug('user ' + email + ' logout');
	
	pattern([
		function(callback) {
			// logout
			user.userId = null;
			user.email = null;
			user.nickname = null;
			user.picture = null;
			user.lastSeen = null;
			user.sessionId = null;
			user.sessionExpire = null;
			user.getUserInfo = null;
			
			callback(null, event);
		}
	], 
	function(err) {
		if (err) {
			return oCallback(err);
		} else {
			return oCallback(null);
		}
	}, {db: db});
});

function logined(user) {
	if (user.state == userState.LOGIN) {
		return true;
	}
	return false;
}

function logouted(user) {
	if (user.state == userState.LOGOUT) {
		return true;
	}
	return false;
}


function validateData(data) {
	if (data === undefined ||
			data === null)
		return false;
	return true;
}

// check if user is logined, then if user provided data if needed
function validateRequest(name, user, needData, data) {
	if (!logined(user)) {
		user.emit(name, {status: 'fail', errorMsg: 'login before request'});
		return false;
	}
	if (needData && !validateData(data)) {
		user.emit(name, {status: 'fail', errorMsg: 'no argument'});
		return false;
	}
	return true;
}

// User session pool management
// store list of user sessions with user id as a key
// it's because a user can access with multiple devices at the same time
function addUserSession(user) {
	var userSessions = users.get(user.userId);

	if (!userSessions &&
			!users.add(user.userId, (userSessions = []))) {
		return false;
	}

	userSessions.push(user);

	return true;
}

// get sessions of a user or users
// users are assumed to be logined so must have session
// mustExist : user should have at least one session
function getUserSessions(user, mustExist) {
	var sessions = users.get(user.userId);
	
	if (!user) {
		return [];
	}
	
	if (mustExist && (!sessions || sessions.indexOf(user) < 0))
		throw Error('user session get failed, but user is alive');
	
	return sessions ? sessions : [];
}

//mustExist : every user should have at least one session
function getUsersSessions(users, mustExist) {
	var sessionSum = [];
	
	if (!users) {
		return sessionSum;
	}
	
	for (var i = 0; i < users.length; i++) {
		var user = users[i];
		var sessions = getUserSessions(user, mustExist);
		
		if (sessions && sessions.length > 0) {
			for (var j = 0; j < sessions.length; j++) {
				var session = sessions[j];
				
				// don't make duplicate entries
				if (sessionSum.indexOf(session) >= 0)
					continue;
				
				sessionSum.push(session);
			}
		}
	}
	
	return sessionSum;
}

function removeUserSession(user) {
	var userSessions = users.get(user.userId);

	if (!userSessions)
		return false;

	// remove user session from list
	userSessions.splice(userSessions.indexOf(user), 1);

	// if no sessions, remove from tree
	if (userSessions.length == 0 &&
			!users.remove(user.userId))
		throw Error('failed to remove user session');

	return true;
}

function removeAllUserSession(user) {
	if (users.remove(user.userId))
		return true;

	return false;
}

function initSession() {
	// Create user session data structure implemeted by Red-Black tree
	users = rbTree.createRBTree();
}

// from www.w3resource.com
function ValidateEmail(mail) 
{
	 if (/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(mail))
	    return true;
	return false;
}

var eventProto = {
	user: null,
	eventName: null,
	data: null,
	ready: false,
	setData: function(data) {
		this.data = data;
	},
	fireEvent: function() {
		this.user.emitter.fireEvent(this);
	},
	cancelEvent: function() {
		this.user.emitter.cancelEvent(this);
	}
};

var eventConstructor = function(user, eventName, data) {
	this.user = user;
	this.eventName = eventName;
	this.data = data;
	this.ready = false;
}

eventConstructor.prototype = eventProto;


var eventEmitterProto = {
	user: null,
	eventQueue: null,
	pushEvent: function(eventName, data) {
		// Create event and push into event queue
		var event = new eventConstructor(this.user, eventName, data);
		this.eventQueue.push(event);
		return event;
	},
	fireEvent: function(event) {
		if (this.eventQueue.length == 0) {
			return;
		}
		
		var firstEvent = this.eventQueue[0];
		if (firstEvent == event) {
			// If the event is first, emit and remove from queue.
			this.user.emit(event.eventName, event.data);
			this.eventQueue.shift();
			
			// If next event is ready to be fired, fire also next message asynchronously.
			var nextEvent = this.eventQueue[0];
			if (nextEvent != undefined && nextEvent.ready) {
				var emitter = this;
				setTimeout(function() {emitter.fireEvent(nextEvent)}, 0);
			}
		} else {
			// The event is not the first, set it to ready. 
			event.ready = true;
		}
	},
	cancelEvent: function(event) {
		if (this.eventQueue.length == 0) {
			return;
		}
		
		// Find index of event in queue
		var index = this.eventQueue.indexOf(event);
		if (index > 0) {
			// Remove event from queue
			this.eventQueue.splice(index, 1);
			
			// If next event is ready to be fired, fire also next message asynchronously.
			var nextEvent = this.eventQueue[index];
			if (nextEvent != undefined && nextEvent.ready) {
				var emitter = this;
				setTimeout(function() {emitter.fireEvent(nextEvent)}, 0);
			}
		}
	},
	clear: function() {
		// Clear event queue
		this.eventQueue.length = 0;
	}
};

var eventEmitterGen = function(user) {
	var eventEmitter = function(user) {
		this.eventQueue = [];
		this.user = user;
	};
	
	eventEmitter.prototype = eventEmitterProto;
	
	return new eventEmitter(user);
};

initSession();

module.exports = {init: init,
		userState: userState,
		logined: logined,
		validateData: validateData,
		validateRequest: validateRequest,
		addUserSession: addUserSession,
		getUserSessions: getUserSessions,
		getUsersSessions: getUsersSessions,
		removeUserSession: removeUserSession,
		removeAllUserSession: removeAllUserSession};

var contact = require('./contact');
var chatManager = require('./chatManager');
var contentManager = require('./contentManager');
var event = require('./event');
var lib = require('./lib');
var async = require('async');

if (require.main == module) {
	console.log('file: ' + __filename + '\ndir: ' + __dirname);

	/**
	 * Shuffles array in place.
	 * @param {Array} a items An array containing the items.
	 */
	function shuffle(a) {
	    var j, x, i;
	    for (i = a.length - 1; i > 0; i--) {
	        j = Math.floor(Math.random() * (i + 1));
	        x = a[i];
	        a[i] = a[j];
	        a[j] = x;
	    }
	    return a;
	}
	
	test1();
	// event emitter test
	function test1() {
		var user = {emit: (name, data) => {console.log("SEND TO USER : " + name + ", " + data)}};
		var emitter = eventEmitterGen(user);
		
		console.log("push 1 event and fire 1 event");
		var event = emitter.pushEvent("testEvent", "testData");
		emitter.fireEvent(event);
		
		console.log("push 2 event and fire 2 event");
		var event = emitter.pushEvent("testEvent", "testData");
		var event2 = emitter.pushEvent("testEvent2", "testData2");
		emitter.fireEvent(event);
		emitter.fireEvent(event2);
		
		console.log("push 1 event and fire 2 event");
		var event = emitter.pushEvent("testEvent", "testData");
		emitter.fireEvent(event);
		emitter.fireEvent(event2);
		
		console.log("push 4 event and fire 4 event at random order");
		var events = [];
		for (var i = 0; i < 100; i++) {
			events.push(emitter.pushEvent("testEvent" + i, "testData"));
		}
		shuffle(events);
		for (var i = 0; i < 100; i++) {
			var event = events[i];
			emitter.fireEvent(event);
		}
		
	}
}